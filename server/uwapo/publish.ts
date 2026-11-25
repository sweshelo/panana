// Ported from lanai-custom-stages web/publish.ts (99304a5); the uwapo there is kept in parallel.
// Publishing stages to the 3DS: POST /api/publish cuts the stages out of the chosen uploaded ZIPs into a new revision
// (data/published/rev-NNNNNN/), and the 3DS reads the manifest (/api/stages.bin, LCSM) and each stage's archive, crr and
// rows. Formats: ../docs/stage-distribution.md §4. The stages of several ZIPs are renumbered so they do not collide
// (renumber.ts, merge.ts); what renumbering cannot resolve is refused (409).
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extractMerged, MergeError, type MergeInput } from './merge';
import type { PackageStore, StoredPackage } from './packages';
import { TITLE_ID, type MasterBaseline } from './panana-zip';
import type { RowRecord, StageConditions } from './stage-files';

export const MANIFEST_MAGIC = 'LCSM';
export const MANIFEST_VERSION = 1;
export const MANIFEST_HEADER = 0x10;
export const MANIFEST_STAGE = 0x100;
export const STAGE_FILES = ['archive', 'crr', 'rows'] as const;
export type StageFileName = (typeof STAGE_FILES)[number];
const NAME_UNITS = 32;

export interface PublishedStage {
  /** u32 as 8 hex digits: the start of the SHA-256 of the content archive. */
  id: string;
  /** The manifest revision in which this stage's files last changed. */
  revision: number;
  name: string;
  content: number;
  archive: string;
  slots: number[];
  package: { id: string; fileName: string };
  files: { name: StageFileName; size: number; sha256: string }[];
  rows: RowRecord[];
  /** From lanai-stage.json; null = script state is private for one visit only (not saved). */
  stageKey: string | null;
  /** The conditions of the stage's list row in the ZIP (null: none found), and whether the delivered rows cleared them. */
  conditions?: StageConditions | null;
  conditionsCleared?: boolean;
  signature: null;
}

export interface Manifest {
  format: 1;
  titleId: string;
  titleVersion: number;
  revision: number;
  publishedAt: string;
  stages: PublishedStage[];
  warnings: string[];
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Collisions renumbering cannot resolve, with the packages named by ID (the 409 body's `conflicts`). */
function problemsOf(error: MergeError, chosen: StoredPackage[]) {
  return error.problems.map((p) => ({ ...p, packages: p.packages.map((i) => chosen[i]?.id ?? String(i)) }));
}

const sha256 = (b: Uint8Array) => new Bun.CryptoHasher('sha256').update(b).digest('hex');

/** The LCSM binary manifest: a 0x10-byte header and 0x100 bytes per stage, little-endian. */
export function manifestBinary(m: Pick<Manifest, 'revision' | 'titleVersion' | 'stages'>): Uint8Array {
  const out = new Uint8Array(MANIFEST_HEADER + m.stages.length * MANIFEST_STAGE);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MANIFEST_MAGIC), 0);
  v.setUint16(4, MANIFEST_VERSION, true);
  v.setUint16(6, m.stages.length, true);
  v.setUint32(8, m.revision, true);
  v.setUint32(0x0c, m.titleVersion, true);
  m.stages.forEach((s, i) => {
    const o = MANIFEST_HEADER + i * MANIFEST_STAGE;
    v.setUint32(o, parseInt(s.id, 16), true);
    v.setUint32(o + 4, s.revision, true);
    v.setUint16(o + 8, s.content, true);
    v.setUint16(o + 0x0a, s.slots[0] ?? 0, true);
    v.setUint32(o + 0x0c, parseInt(s.archive, 16), true);
    STAGE_FILES.forEach((name, k) => {
      const f = s.files.find((x) => x.name === name)!;
      const at = o + 0x10 + k * 0x28;
      v.setUint32(at, f.size, true);
      out.set(
        Uint8Array.from(f.sha256.match(/../g)!, (h) => parseInt(h, 16)),
        at + 4,
      );
      // +0x24: reserved (0)
    });
    // +0x88: name, UTF-16LE, at most 31 units + NUL
    const name = s.name.slice(0, NAME_UNITS - 1);
    for (let k = 0; k < name.length; k++) v.setUint16(o + 0x88 + k * 2, name.charCodeAt(k), true);
    // +0xC8 signature method, +0xD0 key ID, +0xD8 / +0xDC signature offset / length, +0xE0 reserved: all 0 in v1
  });
  return out;
}

/**
 * The 3DS applies the master rows of all stages as one patch, in manifest order, and an added row must be the next
 * row of its table (3ds/runtime/master-rows.inc). Returns the first added row that does not continue the rows of the
 * ROM and of the stages before it, or null.
 */
/** 3ds/runtime/lanai.c MAX_STAGES (a longer manifest is refused whole) and master-rows.inc MASTER_ROWS / MASTER_EDITS. */
export const DELIVERY_LIMITS = { stages: 8, rows: 64, tables: 16 } as const;

/** What the 3DS cannot take of a manifest: too many stages, master rows or tables, or null. */
export function deliveryLimitProblem(stages: Pick<PublishedStage, 'rows'>[]): string | null {
  const rows = stages.flatMap((s) => s.rows);
  if (stages.length > DELIVERY_LIMITS.stages)
    return `ステージが ${stages.length} 件あります。3DS が受け取れるのは ${DELIVERY_LIMITS.stages} 件までです`;
  if (rows.length > DELIVERY_LIMITS.rows)
    return `master の行が全ステージで ${rows.length} 行あります。3DS が足せるのは ${DELIVERY_LIMITS.rows} 行までです`;
  const tables = new Set(rows.map((r) => r.entry)).size;
  if (tables > DELIVERY_LIMITS.tables)
    return `master の表が ${tables} 個あります。3DS が書き換えられるのは ${DELIVERY_LIMITS.tables} 個までです`;
  return null;
}

export function rowOrderProblem(
  stages: Pick<PublishedStage, 'id' | 'content' | 'rows'>[],
  baseline: MasterBaseline,
): string | null {
  const counts = new Map(baseline.tables.map((t) => [t.entry, t.rows]));
  for (const s of stages)
    for (const r of s.rows) {
      if (r.op !== 'add') continue;
      const next = counts.get(r.entry);
      if (next !== r.row)
        return `コンテンツ ${s.content} の master の追加行 ${r.table} 行 ${r.row} が、前のステージまでの行数 ${next ?? '?'} に続いていません`;
      counts.set(r.entry, next + 1);
    }
  return null;
}

export function createPublisher(dir: string, packages: PackageStore) {
  let pending = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const run = pending.then(f);
    pending = run.then(
      () => {},
      () => {},
    );
    return run;
  };

  async function current(): Promise<{ manifest: Manifest; path: string } | null> {
    const pointer = Bun.file(join(dir, 'current.json'));
    if (!(await pointer.exists())) return null;
    const { revision } = (await pointer.json()) as { revision: number };
    const path = join(dir, revName(revision));
    return { manifest: (await Bun.file(join(path, 'manifest.json')).json()) as Manifest, path };
  }

  const revName = (n: number) => `rev-${String(n).padStart(6, '0')}`;

  /**
   * Publishes the stages of the given packages as a new revision ([] publishes an empty list). clearConditions
   * delivers every stage's list row without its enable/disable conditions (always shown in the custom tab).
   */
  function publish(ids: string[], options: { clearConditions?: boolean } = {}): Promise<Manifest> {
    return serial(async () => {
      if (new Set(ids).size !== ids.length) throw new PublishError('同じパッケージが重複しています', 400);
      const chosen: StoredPackage[] = [];
      for (const id of ids) {
        const p = await packages.read(id);
        if (!p) throw new PublishError(`パッケージ ${id} がありません`, 404);
        chosen.push(p);
      }
      const baseline = await packages.baseline();
      const inputs: MergeInput[] = [];
      for (const p of chosen)
        inputs.push({ name: p.fileName, bytes: new Uint8Array(await Bun.file(packages.zipPath(p.id)).arrayBuffer()) });
      let merged;
      try {
        merged = await extractMerged(inputs, baseline, options);
      } catch (error) {
        if (error instanceof MergeError && error.problems.length)
          throw new PublishError(error.message, 409, problemsOf(error, chosen));
        throw new PublishError((error as Error).message);
      }
      const previous = await current();
      const revision = (previous?.manifest.revision ?? 0) + 1;
      const warnings = merged.warnings;
      const stages: { meta: PublishedStage; bytes: Record<StageFileName, Uint8Array> }[] = [];
      for (const [k, extracted] of merged.packages.entries()) {
        const p = chosen[k]!;
        for (const s of [...extracted.stages].sort((a, b) => a.stage.content - b.stage.content)) {
          const bytes = { archive: s.archive, crr: s.crr, rows: s.rows };
          const files = STAGE_FILES.map((name) => ({ name, size: bytes[name].length, sha256: sha256(bytes[name]) }));
          const id = files[0]!.sha256.slice(0, 8).toUpperCase();
          if (stages.some((x) => x.meta.id === id)) throw new PublishError(`同じステージ ${id} が複数あります`, 409);
          const old = previous?.manifest.stages.find((x) => x.id === id);
          const same = old && old.files.every((f, k) => f.sha256 === files[k]!.sha256);
          stages.push({
            bytes,
            meta: {
              id,
              revision: same ? old.revision : revision,
              name: s.stage.name,
              content: s.stage.content,
              archive: s.stage.archive,
              slots: s.stage.stages.map((r) => r.slot),
              package: { id: p.id, fileName: p.fileName },
              files,
              rows: s.rowRecords,
              stageKey: s.events?.stageKey.toLowerCase() ?? null,
              conditions: s.conditions,
              conditionsCleared: s.conditionsCleared,
              signature: null,
            },
          });
        }
      }
      // delivery order = numbering order (package, then content): the added rows continue each other in it
      const limit = deliveryLimitProblem(stages.map((s) => s.meta));
      if (limit) throw new PublishError(limit);
      const order =
        baseline &&
        rowOrderProblem(
          stages.map((s) => s.meta),
          baseline,
        );
      if (order) throw new PublishError(`${order} (3DS はステージの master 行を順に重ねて適用します)`);
      const manifest: Manifest = {
        format: 1,
        titleId: TITLE_ID,
        titleVersion: baseline?.titleVersion ?? 17408,
        revision,
        publishedAt: new Date().toISOString(),
        stages: stages.map((s) => s.meta),
        warnings,
      };
      await mkdir(dir, { recursive: true });
      const temporary = join(dir, `${revName(revision)}.tmp-${crypto.randomUUID()}`);
      try {
        for (const s of stages)
          for (const name of STAGE_FILES) await Bun.write(join(temporary, 'stages', s.meta.id, name), s.bytes[name]);
        await Bun.write(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2));
        await Bun.write(join(temporary, 'stages.bin'), manifestBinary(manifest));
        await rename(temporary, join(dir, revName(revision)));
      } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
      const pointer = join(dir, `current.json.tmp-${crypto.randomUUID()}`);
      await Bun.write(pointer, JSON.stringify({ revision }));
      await rename(pointer, join(dir, 'current.json'));
      // keep the last 3 revisions (a 3DS may be downloading from the previous one)
      const old = (await readdir(dir))
        .filter((n) => /^rev-\d{6}$/.test(n))
        .sort()
        .slice(0, -3);
      for (const n of old) await rm(join(dir, n), { recursive: true, force: true });
      return manifest;
    });
  }

  const json = (value: unknown, status = 200): Response =>
    Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

  function bytesResponse(request: Request, bytes: Uint8Array, type: string, etag?: string): Response {
    const headers: Record<string, string> = {
      'content-type': type,
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
    };
    if (etag) {
      headers.etag = `"${etag}"`;
      if (request.headers.get('if-none-match') === headers.etag)
        return new Response(null, { status: 304, headers: { etag: headers.etag, 'cache-control': 'no-store' } });
    }
    return new Response(request.method === 'HEAD' ? null : (bytes as Uint8Array<ArrayBuffer>), { headers });
  }

  async function handle(request: Request, url: URL): Promise<Response | null> {
    const path = url.pathname;
    try {
      if (path === '/api/publish') {
        if (request.method !== 'POST')
          return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'JSON形式の本文を送ってください。' }, 400);
        }
        const ids = (body as { packages?: unknown } | null)?.packages;
        if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))
          return json({ error: 'packages はパッケージ ID の配列にしてください。' }, 400);
        const clear = (body as { clearConditions?: unknown }).clearConditions;
        if (clear !== undefined && typeof clear !== 'boolean')
          return json({ error: 'clearConditions は true か false にしてください。' }, 400);
        try {
          return json({ manifest: await publish(ids, { clearConditions: clear }) }, 201);
        } catch (error) {
          if (error instanceof PublishError)
            return json({ error: error.message, ...(error.details ? { conflicts: error.details } : {}) }, error.status);
          throw error;
        }
      }
      if (path !== '/api/stages' && !path.startsWith('/api/stages.') && !path.startsWith('/api/stages/')) return null;
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      const now = await current();
      if (path === '/api/stages')
        return json(
          now?.manifest ?? {
            format: 1,
            titleId: TITLE_ID,
            titleVersion: 17408,
            revision: 0,
            publishedAt: null,
            stages: [],
            warnings: [],
          },
        );
      if (path === '/api/stages.bin')
        return bytesResponse(
          request,
          now
            ? new Uint8Array(await Bun.file(join(now.path, 'stages.bin')).arrayBuffer())
            : manifestBinary({ revision: 0, titleVersion: 17408, stages: [] }),
          'application/octet-stream',
        );
      const m = /^\/api\/stages\/([0-9A-Fa-f]{8})\/(archive|crr|rows)$/.exec(path);
      const stage = m && now?.manifest.stages.find((s) => s.id === m[1]!.toUpperCase());
      if (!m || !stage || !now) return json({ error: 'ステージが見つかりません。' }, 404);
      const name = m[2] as StageFileName;
      const bytes = new Uint8Array(await Bun.file(join(now.path, 'stages', stage.id, name)).arrayBuffer());
      return bytesResponse(
        request,
        bytes,
        'application/octet-stream',
        stage.files.find((f) => f.name === name)!.sha256,
      );
    } catch (error) {
      console.error('Lanai stage request failed:', error);
      return json({ error: 'ステージの配信に失敗しました。サーバーのログを確認してください。' }, 500);
    }
  }

  return { handle, publish, current };
}
