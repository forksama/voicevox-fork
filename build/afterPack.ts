import { execSync } from "node:child_process";
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

  // macOS: ad-hoc code signing so the app can run without a Developer ID certificate
  if (context.electronPlatformName === "darwin") {
    console.log("  • ad-hoc signing VOICEVOX.app");
    execSync(
      `codesign --force --deep -s - "${context.appOutDir}/VOICEVOX.app"`,
      { stdio: "inherit" },
    );
  }
}
