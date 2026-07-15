# macOS 打包完整指南（从 0 到 DMG）

本文档记录在 **macOS（Apple Silicon / arm64）** 上，从零拉取仓库到成功产出可直接运行的 `VOICEVOX.app` / DMG 的完整步骤。按顺序执行即可复现。

> Windows / Linux 的打包思路类似，但工具链不同（NSIS / AppImage），本文只覆盖 macOS。跨平台差异见文末「与 Windows 的差异」。

---

## 0. 前置要求

| 项目 | 要求 |
| --- | --- |
| 系统 | macOS 12+，Apple Silicon（arm64）。Intel 机器把下文所有 `arm64` 换成 `x64` |
| Node.js | `>=22.14.0 <23`（见 `package.json` 的 `engines`） |
| 包管理器 | pnpm 10（`corepack enable` 或 `npm i -g pnpm@10`） |
| 磁盘空间 | 至少 **10 GB** 空闲（引擎解压约 2.1 GB，app 约 2.4 GB，DMG 约 1.9 GB） |
| 命令行工具 | Xcode Command Line Tools（`xcode-select --install`，提供 `codesign` / `hdiutil`） |

---

## 1. 克隆仓库

```bash
git clone <本仓库地址> voicevox-fork
cd voicevox-fork
```

---

## 2.（中国大陆网络）配置镜像，避免下载失败

安装依赖时会下载 Electron 二进制、Chromium、7z 等，国内网络容易超时。**在 `pnpm install` 之前**先配好镜像：

```bash
# Electron 二进制镜像（关键，否则 install 卡死）
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
# npm registry 镜像（可选，加速依赖下载）
pnpm config set registry https://registry.npmmirror.com
```

> 若网络通畅（海外 / 有代理），本节可跳过。

---

## 3. 处理 pnpm safe-delete 拦截（重要）

pnpm 10 默认开启 `safe-delete` 保护，`electron-builder` 打包时清理 `dist_electron` 会被拦截并中断。**在项目根目录创建或编辑 `.npmrc`**，加入：

```ini
safe-delete-interval=0
safe-delete-threshold=999999
```

> `.npmrc` 是本地环境配置，不要提交到仓库（它同时也可用来写 registry 镜像）。

---

## 4. 安装依赖

```bash
pnpm install
```

`postinstall` 钩子会自动做这些事（见 `package.json`）：

- `electron-builder install-app-deps` — 重建原生依赖
- `playwright install chromium` — 下载测试用 Chromium
- `tsx tools/download7z.ts` — 下载 7z 二进制到 `vendored/7z/`（打包时会随 app 分发，**必须成功**）
- `tsx tools/downloadTypos.ts`、`tools/downloadAppimagetool.ts` — 拼写检查 / AppImage 工具

安装后确认 7z 已就位（macOS 应有 `7zz`）：

```bash
ls vendored/7z/        # 期望看到 7zz
```

若缺失，手动补下：`pnpm exec tsx tools/download7z.ts`

---

## 5. 下载并解压 TTS 引擎（关键，否则装完不出声）

VOICEVOX 是「Electron 编辑器外壳 + 独立 TTS 引擎」的架构。仓库本身**不含引擎**，必须单独下载后注入。

### 5.1 下载引擎

到 [VOICEVOX/voicevox_engine releases](https://github.com/VOICEVOX/voicevox_engine/releases) 找与编辑器兼容的版本（本次验证使用 **0.25.2**），下载 macOS arm64 的 CPU 版分卷压缩包，资产名形如：

```
voicevox_engine-macos-arm64-cpu-0.25.2.7z.001
```

下载到项目下的临时目录（不要提交），例如：

```bash
mkdir -p voicevox_engine_dl && cd voicevox_engine_dl
# 用 curl -L -C - 支持断点续传，1.7GB 左右
curl -L -C - -o engine.7z.001 "<引擎资产下载直链>"
cd ..
```

### 5.2 解压引擎（用仓库自带的 7z）

```bash
mkdir -p voicevox_engine_dl/extracted
./vendored/7z/7zz x voicevox_engine_dl/engine.7z.001 \
  -o voicevox_engine_dl/extracted/macos-arm64
```

解压后 `voicevox_engine_dl/extracted/macos-arm64/` 顶层应包含：

```
run                          # 引擎主可执行文件
engine_manifest.json
libvoicevox_core.dylib
libvoicevox_onnxruntime.dylib
engine_internal/             # 含 Python.framework、各种 .so/.dylib
model/  resources/  licenses.json
```

> 注意：解压后目录顶层必须直接是 `run`，而不是再套一层文件夹。若多套了一层，把 `VOICEVOX_ENGINE_DIR` 指到含 `run` 的那一层即可。

---

## 6. 让打包脚本找到引擎

`build/electronBuilderConfig.ts` 通过环境变量 `VOICEVOX_ENGINE_DIR` 决定把哪个目录复制进 `VOICEVOX.app/Contents/MacOS/vv-engine`。指向上一步解压出的目录：

```bash
export VOICEVOX_ENGINE_DIR="$(pwd)/voicevox_engine_dl/extracted/macos-arm64/"
```

### `.env.production` 的引擎路径

`.env.production` 里 `executionFilePath` 默认值是 **Windows 的 `vv-engine/run.exe`**（仓库以 Windows 为默认打包目标，保持不动）。在 macOS 上打包，本地临时改成 `run`：

```jsonc
"executionFilePath": "vv-engine/run",   // macOS: 去掉 .exe
```

> ⚠️ 这是本地临时修改，**不要提交**（提交会破坏 Windows 构建）。若不想改文件，也可在解压目录里建一个软链接兜底：`ln -s run voicevox_engine_dl/extracted/macos-arm64/run.exe`。

---

## 7. 打包

分两步：先编译前端，再用 electron-builder 打包。

### 7.1 编译（必须用 pnpm run，不要直接调 vite）

```bash
pnpm run electron:build:compile
```

> 直接 `node .../vite build` 会因为缺少 `npm_package_name` 环境变量报 `name undefined`。用 `pnpm run` 会自动注入。

### 7.2 打包 app + DMG

正常情况下一条命令即可：

```bash
pnpm run electron:build:pack
```

**如果被 pnpm safe-delete 拦截**（即使配了第 3 步仍可能触发），绕过 pnpm wrapper 直接调 electron-builder CLI：

```bash
./node_modules/.bin/node node_modules/electron-builder/out/cli/cli.js \
  --config ./build/electronBuilderConfigLoader.cjs --publish never
# 若上面的 node 路径不适用，直接用系统 node：
# node node_modules/electron-builder/out/cli/cli.js --config ./build/electronBuilderConfigLoader.cjs --publish never
```

打包过程中 `build/afterPack.ts` 会自动完成 macOS **ad-hoc 代码签名**（见下节），无需手动操作。

产物：

```
dist_electron/mac-arm64/VOICEVOX.app          # 可直接运行的 app（约 2.4 GB）
dist_electron/VOICEVOX-<version>-arm64.dmg     # 分发用 DMG（约 1.9 GB，含引擎）
```

---

## 8. 代码签名说明（已自动化，了解即可）

macOS 不允许运行未签名的 app（否则 SIGKILL / “Code Signature Invalid”）。本仓库用 **ad-hoc 签名**（`codesign -s -`，无需 Apple Developer ID）解决，逻辑写在 `build/afterPack.ts`，打包时自动执行。

**为什么不用 `codesign --deep`**：引擎内含 Python，目录里有 `*.dist-info`、`python3.11` 等带点号的文件夹，`--deep` 会把它们误判成 bundle，报 `bundle format unrecognized` 并中断打包。因此 `afterPack.ts` 改为**从内到外逐个签名**：

1. 所有 `.so` / `.dylib`（含引擎 Python 扩展）
2. `Python.framework` 与引擎 `run`
3. 同梱的 `7zz`
4. Electron 的 `*.framework` / Helper `*.app`（这些不含 `.dist-info`，可安全用 `--deep`）
5. 最后签 app 本体（即使 `.dist-info` 误判也**容错跳过**，不中断）

因为是 ad-hoc 而非 Developer ID 签名，别人首次打开可能提示「无法验证开发者」，**右键 →「打开」** 即可；或去掉隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/VOICEVOX.app
```

---

## 9.（可选）从现成 app 手动打 DMG

若只想把已经打好、已可用的 `VOICEVOX.app` 封装成 DMG（不重新走 electron-builder，避免它清理引擎），可用 `hdiutil`：

```bash
STAGE=$(mktemp -d)
cp -R dist_electron/mac-arm64/VOICEVOX.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "VOICEVOX" -srcfolder "$STAGE" -ov \
  -format UDZO dist_electron/VOICEVOX-arm64.dmg
rm -rf "$STAGE"
```

---

## 10. 常见错误排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `install` 卡在下载 Electron | GFW | 设 `ELECTRON_MIRROR`（第 2 步） |
| 打包中断，提示 safe-delete | pnpm 10 保护 | 配 `.npmrc`（第 3 步）或绕过 wrapper（第 7.2 步） |
| `7z binary file not found` | 未下载 7z | `pnpm exec tsx tools/download7z.ts` |
| 启动即崩溃 / SIGKILL / Code Signature Invalid | app 未签名 | 确认走了 `afterPack` 签名；或 `xattr -dr com.apple.quarantine` |
| `spawn .../vv-engine/run.exe ENOENT` | 引擎没打进去，或路径带 `.exe` | 检查第 5、6 步：`VOICEVOX_ENGINE_DIR` 是否正确、`.env.production` 改成 `run` |
| `name undefined`（编译时） | 直接调 vite | 改用 `pnpm run electron:build:compile`（第 7.1 步） |
| `bundle format unrecognized`（签名时） | `--deep` 撞到 `.dist-info` | 已在 `afterPack.ts` 修复；如手动签名请从内到外逐个签 |

---

## 与 Windows 的差异（提醒）

本仓库会**同时在 macOS 和 Windows 上打包**，两边默认配置不同，提交时务必注意：

- `.env.production` 的 `executionFilePath` 默认是 Windows 的 `vv-engine/run.exe`，**是 Windows 的正确值，不要改动/提交**。macOS 打包时本地临时改 `run` 即可。
- `build/afterPack.ts` 的签名逻辑包在 `if (context.electronPlatformName === "darwin")` 内，**不影响 Windows 构建**。
- `.npmrc`（镜像 + safe-delete）是本地环境配置，**不提交**。
- Windows 用 NSIS（`nsis-web` target），需在 Windows 上打；Linux 用 AppImage，需在 Linux 上打。单机无法跨平台打包，官方 CI 通过 GitHub Actions matrix 完成。
