import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { FuseConfig, FuseV1Options, FuseVersion } from "@electron/fuses";
import { AfterPackContext } from "electron-builder";

export default async function afterPack(context: AfterPackContext) {
  // @electron/fusesで特定の機能や制限を有効化/無効化
  const fuses: FuseConfig = {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  };
  await context.packager.addElectronFuses(context, fuses);

  // macOS: Developer ID 証明書なしでも起動できるように ad-hoc 署名を行う。
  // 注意: `codesign --deep` は同梱エンジン内の Python メタデータ
  // ディレクトリ（例: `*.dist-info`）を bundle と誤認して
  // 「bundle format unrecognized」で失敗するため使わない。
  // 代わりに内側のバイナリから順に個別署名する。
  if (context.electronPlatformName === "darwin") {
    const appPath = path.join(context.appOutDir, "VOICEVOX.app");
    const contents = path.join(appPath, "Contents");
    const enginePath = path.join(contents, "MacOS", "vv-engine");
    console.log("  • ad-hoc signing VOICEVOX.app (inside-out)");

    // 署名に失敗しても打包全体は止めない（内部の主要コンポーネントが
    // 署名済みであれば ad-hoc 起動には十分なため）。
    const sign = (target: string, deep = false) => {
      try {
        execSync(
          `codesign --force ${deep ? "--deep " : ""}-s - "${target}"`,
          { stdio: "inherit" },
        );
      } catch {
        console.warn(`  ! codesign skipped (ignored): ${target}`);
      }
    };

    // 1. すべての .so / .dylib（エンジン内の Python 拡張モジュールを含む）
    try {
      execSync(
        `find "${appPath}" \\( -name "*.so" -o -name "*.dylib" \\) -print0 | xargs -0 codesign --force -s -`,
        { stdio: "inherit" },
      );
    } catch {
      console.warn("  ! some .so/.dylib codesign steps failed (ignored)");
    }

    // 2. Python.framework とエンジン実行ファイル run
    const pyFramework = path.join(
      enginePath,
      "engine_internal",
      "Python.framework",
    );
    if (existsSync(pyFramework)) {
      sign(path.join(pyFramework, "Versions", "3.11", "Python"));
      sign(pyFramework);
    }
    const engineRun = path.join(enginePath, "run");
    if (existsSync(engineRun)) sign(engineRun);

    // 3. 同梱した 7z バイナリ（extraFiles で Contents/MacOS 直下にコピーされる）
    for (const name of ["7zz", "7zzs"]) {
      const p = path.join(contents, "MacOS", name);
      if (existsSync(p)) sign(p);
    }

    // 4. Electron のフレームワークとヘルパーアプリ（内部に .dist-info を
    //    含まないため --deep を使ってよい）
    const frameworksDir = path.join(contents, "Frameworks");
    if (existsSync(frameworksDir)) {
      try {
        execSync(
          `find "${frameworksDir}" -maxdepth 1 \\( -name "*.framework" -o -name "*.app" \\) -print0 | xargs -0 -I{} codesign --force --deep -s - {}`,
          { stdio: "inherit" },
        );
      } catch {
        console.warn("  ! some framework/helper codesign steps failed (ignored)");
      }
    }

    // 5. 最後にアプリ本体を署名する。エンジン内の `*.dist-info` ディレクトリを
    //    codesign が bundle と誤認してエラーになる場合があるが、内部コンポーネント
    //    の署名は完了しているため無視して続行する（打包を止めない）。
    sign(appPath);
  }
}
