/**
 * 立絵マッピング (Voice-Portrait Mapping) 用ヘルパー。
 *
 * GPT-SoVITS 側と同一の「二基準ディレクトリ + 相対パス」設計に揃える:
 * - 作業ディレクトリ (workingDir): 音声と映射ファイルの基準。
 *   映射ファイルは <workingDir>/media/voice/voice-portrait-map.json。
 *   音声は <workingDir>/media/voice/audio/ に保存。
 * - 立絵ディレクトリ (portraitDir): 立絵の基準。三方(GPT-SoVITS/VOICEVOX/UXP)で一致させる。
 *
 * 映射ファイルには絶対パスを一切書かず、
 * audioRelPath は作業ディレクトリ相対、portraitRelPath は立絵ディレクトリ相対で保存する。
 */
import path from "@/helpers/path";

export const VPM_MAPPING_FILENAME = "voice-portrait-map.json";
export const VPM_SCHEMA_VERSION = 2;

export type VpmMappingItem = {
  order: number;
  audioFileName: string;
  audioRelPath: string;
  portraitRelPath: string;
  role: string;
  engine: "gpt-sovits" | "voicevox";
  text: string;
};

export type VpmMappingFile = {
  schemaVersion: number;
  audioPathBase: "workdir";
  portraitPathBase: "portraitDir";
  items: VpmMappingItem[];
};

export function createEmptyMapping(): VpmMappingFile {
  return {
    schemaVersion: VPM_SCHEMA_VERSION,
    audioPathBase: "workdir",
    portraitPathBase: "portraitDir",
    items: [],
  };
}

/** 映射ファイルの絶対パス (<workingDir>/media/voice/voice-portrait-map.json) */
export function mappingFilePath(workingDir: string): string {
  return path.join(workingDir, "media", "voice", VPM_MAPPING_FILENAME);
}

/** 音声出力ディレクトリ (<workingDir>/media/voice/audio) */
export function audioOutputDir(workingDir: string): string {
  return path.join(workingDir, "media", "voice", "audio");
}

/**
 * 立絵の絶対パスを立絵ディレクトリ相対に変換する。
 * 立絵ディレクトリ配下でない場合は絶対パス(スラッシュ区切り)を返す。
 */
export function toPortraitRelPath(
  portraitDir: string,
  portraitAbsPath: string,
): string {
  if (!portraitDir || !portraitAbsPath) return "";
  const rel = path.relative(portraitDir, portraitAbsPath);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.split(path.SEPARATOR).join("/");
  }
  // 立絵ディレクトリ配下でなければ絶対パスを保存 (UXP 側で解決不能だが警告扱い)
  return portraitAbsPath.split(path.SEPARATOR).join("/");
}

/** 音声絶対パスを作業ディレクトリ相対に変換する。 */
export function toAudioRelPath(
  workingDir: string,
  audioAbsPath: string,
): string {
  if (!workingDir || !audioAbsPath) return "";
  const rel = path.relative(workingDir, audioAbsPath);
  return rel.split(path.SEPARATOR).join("/");
}

/**
 * 映射に既存の order があれば上書き、なければ追加し、order 昇順で整列する。
 */
export function upsertMappingItem(
  mapping: VpmMappingFile,
  item: VpmMappingItem,
): void {
  const idx = mapping.items.findIndex((it) => it.order === item.order);
  if (idx >= 0) {
    mapping.items[idx] = item;
  } else {
    mapping.items.push(item);
  }
  mapping.items.sort((a, b) => a.order - b.order);
}

export async function readMappingFile(
  workingDir: string,
): Promise<VpmMappingFile> {
  if (!workingDir) {
    return createEmptyMapping();
  }

  const filePath = mappingFilePath(workingDir);
  const exists = await window.backend.checkFileExists(filePath);
  if (!exists) {
    return createEmptyMapping();
  }

  const readResult = await window.backend.readFile({ filePath });
  if (!readResult.ok) {
    throw new Error(`映射ファイルの読み込みに失敗しました: ${filePath}`);
  }

  const text = new TextDecoder().decode(readResult.value);
  const parsed = JSON.parse(text) as Partial<VpmMappingFile>;
  if (!parsed || !Array.isArray(parsed.items)) {
    return createEmptyMapping();
  }

  return {
    ...createEmptyMapping(),
    ...parsed,
    items: parsed.items,
  } as VpmMappingFile;
}

export async function readGeneratedOrdersFromMapping(
  workingDir: string,
): Promise<Set<number>> {
  const mapping = await readMappingFile(workingDir);
  return new Set(
    mapping.items
      .map((item) => item.order)
      .filter((order) => Number.isInteger(order) && order > 0),
  );
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

/**
 * ローカル画像ファイルを読み込み、表示用の object URL を返す。
 * 呼び出し側は不要になったら URL.revokeObjectURL で解放すること。
 */
export async function loadLocalImageObjectUrl(
  absPath: string,
): Promise<string | undefined> {
  const result = await window.backend.readFile({ filePath: absPath });
  if (!result.ok) return undefined;
  const ext = path.extname(absPath).toLowerCase();
  const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
  const blob = new Blob([result.value], { type: mime });
  return URL.createObjectURL(blob);
}
