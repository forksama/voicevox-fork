import { z } from "zod";
import path from "@/helpers/path";
import { readGeneratedOrdersFromMapping } from "@/helpers/voicePortraitMapping";

export const D_DRIVEN_MANIFEST_FILENAME = "pr-subtitles-D.json";

export const dDrivenCueSchema = z
  .object({
    order: z.number().int().min(1),
    role: z.string().trim().min(1),
    jaText: z.string().min(1),
    jaBlocks: z.array(z.string()).optional(),
    source: z.string().optional(),
  })
  .passthrough();
export type DDrivenCue = z.infer<typeof dDrivenCueSchema>;

export const dDrivenManifestSchema = z
  .object({
    schema: z.string().min(1),
    cues: z.array(dDrivenCueSchema),
  })
  .passthrough();
export type DDrivenManifest = z.infer<typeof dDrivenManifestSchema>;

export type DDrivenRoleSummary = {
  role: string;
  total: number;
  generated: number;
  pending: number;
  firstOrder: number;
  sampleText: string;
};

export type LoadedDDrivenManifest = {
  workingDir: string;
  manifestPath: string;
  manifest: DDrivenManifest;
  generatedOrders: number[];
  roleSummaries: DDrivenRoleSummary[];
};

export function resolveManifestPath(workingDir: string): string {
  return path.join(workingDir, D_DRIVEN_MANIFEST_FILENAME);
}

function normalizeManifest(manifest: DDrivenManifest): DDrivenManifest {
  const duplicatedOrders = new Set<number>();
  const seenOrders = new Set<number>();

  for (const cue of manifest.cues) {
    if (seenOrders.has(cue.order)) {
      duplicatedOrders.add(cue.order);
    }
    seenOrders.add(cue.order);
  }

  if (duplicatedOrders.size > 0) {
    throw new Error(
      `D manifest 中存在重复的 order: ${[...duplicatedOrders].sort((a, b) => a - b).join(", ")}`,
    );
  }

  return {
    ...manifest,
    cues: [...manifest.cues].sort((a, b) => a.order - b.order),
  };
}

export async function readManifestFile(
  manifestPath: string,
): Promise<DDrivenManifest> {
  const readResult = await window.backend.readFile({ filePath: manifestPath });
  if (!readResult.ok) {
    throw new Error(`读取 D manifest 失败: ${manifestPath}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(readResult.value));
  } catch {
    throw new Error(`D manifest 不是合法 JSON: ${manifestPath}`);
  }

  return normalizeManifest(dDrivenManifestSchema.parse(parsedJson));
}

export async function loadManifestFromWorkdir(workingDir: string): Promise<{
  manifestPath: string;
  manifest: DDrivenManifest;
}> {
  if (!workingDir) {
    throw new Error(
      "还没有设置 D 驱动工作目录。请先在设置中填写 VPM 工作目录。",
    );
  }

  const manifestPath = resolveManifestPath(workingDir);
  const exists = await window.backend.checkFileExists(manifestPath);
  if (!exists) {
    throw new Error(`未找到 D manifest: ${manifestPath}`);
  }

  return {
    manifestPath,
    manifest: await readManifestFile(manifestPath),
  };
}

export function getCuesByRoles(
  manifest: DDrivenManifest,
  roles: string[] = [],
): DDrivenCue[] {
  if (roles.length === 0) {
    return [...manifest.cues];
  }

  const selectedRoles = new Set(roles);
  return manifest.cues.filter((cue) => selectedRoles.has(cue.role));
}

export function getPendingCues(
  manifest: DDrivenManifest,
  generatedOrders: Set<number>,
  roles: string[] = [],
): DDrivenCue[] {
  return getCuesByRoles(manifest, roles).filter(
    (cue) => !generatedOrders.has(cue.order),
  );
}

export function buildRoleSummaries(
  manifest: DDrivenManifest,
  generatedOrders: Set<number>,
): DDrivenRoleSummary[] {
  const roleMap = new Map<string, DDrivenCue[]>();

  for (const cue of manifest.cues) {
    const bucket = roleMap.get(cue.role) ?? [];
    bucket.push(cue);
    roleMap.set(cue.role, bucket);
  }

  return [...roleMap.entries()].map(([role, cues]) => {
    const generated = cues.filter((cue) =>
      generatedOrders.has(cue.order),
    ).length;
    return {
      role,
      total: cues.length,
      generated,
      pending: cues.length - generated,
      firstOrder: cues[0]?.order ?? 0,
      sampleText: cues[0]?.jaText ?? "",
    };
  });
}

export async function loadManifestContextFromWorkdir(
  workingDir: string,
): Promise<LoadedDDrivenManifest> {
  const { manifestPath, manifest } = await loadManifestFromWorkdir(workingDir);
  const generatedOrders = [
    ...(await readGeneratedOrdersFromMapping(workingDir)),
  ].sort((a, b) => a - b);

  return {
    workingDir,
    manifestPath,
    manifest,
    generatedOrders,
    roleSummaries: buildRoleSummaries(manifest, new Set(generatedOrders)),
  };
}
