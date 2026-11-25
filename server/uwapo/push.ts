// Registering a stage from Panana: the distribution ZIP is imported as a package and published in place of the
// published package of the same stage (the other stages stay published). Ported from lanai-custom-stages web/dev-push.ts
// (99304a5) without its mirror into an emulator's SD.
import { unzipSync } from 'fflate';
import { InvalidPackage, maxPackageBytes, type PackageStore, type StoredPackage } from './packages';
import { PublishError, type Manifest } from './publish';

export type Publisher = {
  publish: (ids: string[], options?: { clearConditions?: boolean }) => Promise<Manifest>;
  current: () => Promise<{ manifest: Manifest; path: string } | null>;
};

/** stageKeys (lower case) of a ZIP's lanai-stage.json. */
export function stageKeysOf(zip: Uint8Array): string[] {
  const files = unzipSync(zip, { filter: (f) => f.name.split('/').at(-1)!.toLowerCase() === 'lanai-stage.json' });
  const file = Object.values(files)[0];
  if (!file) return [];
  try {
    const doc = JSON.parse(new TextDecoder().decode(file)) as { stages?: Record<string, { stageKey?: unknown }> };
    return Object.values(doc.stages ?? {})
      .map((s) => s?.stageKey)
      .filter((k): k is string => typeof k === 'string')
      .map((k) => k.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Whether a published package is the same stage as the pushed one: a shared stageKey, or (for stages without a key)
 * the same content, archive and name. The archive alone is not enough: every content Panana adds is F0000000.
 */
function sameStage(old: StoredPackage, oldKeys: Set<string>, pushed: StoredPackage, keys: string[]): boolean {
  if (keys.some((k) => oldKeys.has(k))) return true;
  return pushed.summary.stages.some((s) =>
    old.summary.stages.some((o) => o.content === s.content && o.archive === s.archive && o.name === s.name),
  );
}

export interface PushResult {
  revision: number;
  package: string;
  /** Packages taken out of the publication because they were the same stage. */
  replaced: string[];
  stages: { id: string; name: string; content: number; pushed: boolean }[];
  warnings: string[];
}

/** An error with the HTTP status to answer it with (and the conflicts of a refused publication). */
export class PushError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Imports a distribution ZIP and publishes it in place of the same stage. */
export async function pushPackage(
  packages: PackageStore,
  publisher: Publisher,
  bytes: Uint8Array,
  options: { name?: string; clearConditions?: boolean } = {},
): Promise<PushResult> {
  if (!bytes.length) throw new PushError('ZIP ファイルを送ってください。', 400);
  if (bytes.length > maxPackageBytes) throw new PushError('ZIP が大きすぎます (最大 64 MiB)。', 413);
  let pushed: StoredPackage;
  try {
    pushed = (await packages.importZip(bytes, options.name ?? 'panana-push.zip')).package;
  } catch (error) {
    if (error instanceof InvalidPackage) throw new PushError(error.message, 422);
    throw error;
  }
  const keys = stageKeysOf(bytes);
  const now = await publisher.current();
  const replaced: string[] = [];
  const ids: string[] = [];
  for (const id of new Set(now?.manifest.stages.map((s) => s.package.id) ?? [])) {
    if (id === pushed.id) continue;
    const old = await packages.read(id);
    const oldKeys = new Set(
      now!.manifest.stages.filter((s) => s.package.id === id && s.stageKey).map((s) => s.stageKey!),
    );
    if (old && sameStage(old, oldKeys, pushed, keys)) replaced.push(id);
    else if (old) ids.push(id);
  }
  ids.push(pushed.id);
  let manifest: Manifest;
  try {
    manifest = await publisher.publish(ids, { clearConditions: options.clearConditions });
  } catch (error) {
    if (error instanceof PublishError) throw new PushError(error.message, error.status, error.details);
    throw error;
  }
  return {
    revision: manifest.revision,
    package: pushed.id,
    replaced,
    stages: manifest.stages.map((s) => ({
      id: s.id,
      name: s.name,
      content: s.content,
      pushed: s.package.id === pushed.id,
    })),
    warnings: manifest.warnings,
  };
}
