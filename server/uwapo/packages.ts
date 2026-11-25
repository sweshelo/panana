// Ported from lanai-custom-stages web/packages.ts (99304a5); the uwapo there is kept in parallel.
// Uploaded Panana MOD ZIPs: each is stored as data/packages/<id>/package.zip with the summary parsed from it
// (summary.json). The id is the start of the ZIP's SHA-256, so the same ZIP uploaded twice is stored once.
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePananaZip, type MasterBaseline, type PackageSummary } from './panana-zip';

export const maxPackageBytes = 64 * 1024 * 1024;
const idPattern = /^[0-9a-f]{16}$/;

export interface StoredPackage {
  id: string;
  fileName: string;
  uploadedAt: string;
  size: number;
  sha256: string;
  summary: PackageSummary;
}

export interface Conflict {
  /** What collides: content number, archive, stage slot, MessageMapStage ID, Integration ID, script, code.ips. */
  kind:
    | 'content'
    | 'archive'
    | 'crr'
    | 'slot'
    | 'message'
    | 'integration'
    | 'script'
    | 'codeIps'
    | 'masterRow'
    | 'rowId';
  value: string;
  packages: string[];
  /** Renumbering resolves it when the ZIPs are published or merged together (renumber.ts). */
  resolvable: boolean;
}

/** Values that two stage packages must not share when they are merged (docs/stage-distribution.md). */
export function findConflicts(list: StoredPackage[]): Conflict[] {
  const seen = new Map<string, Set<string>>();
  const fixed = new Set<string>(); // keys renumbering cannot resolve
  const add = (kind: Conflict['kind'], value: string | number | null, id: string, resolvable = true) => {
    if (value === null) return;
    const key = `${kind}\0${value}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(id);
    if (!resolvable) fixed.add(key);
  };
  for (const p of list) {
    for (const s of p.summary.stages) {
      // an existing content replaced by two ZIPs keeps its number and archive
      add('content', s.content, p.id, s.kind === 'added');
      add('archive', s.archive, p.id, s.kind === 'added');
      add('crr', s.crr, p.id);
      for (const r of s.stages) {
        add('slot', r.slot, p.id);
        add('message', r.messageId, p.id);
        add('integration', r.integrationId, p.id);
      }
    }
    for (const n of p.summary.conditionScripts) add('script', n, p.id, false);
    // code.ips is not delivered nor merged; it only matters with condition scripts
    if (p.summary.codeIps) add('codeIps', 'exefs/code.ips', p.id);
    // the same master row added or changed by both: added rows get new row numbers, a changed ROM row cannot be shared;
    // an added row other than the stage's own list rows keeps its ID (contents and CROs may hold it)
    for (const d of p.summary.masterDiff ?? []) {
      for (const r of d.added) {
        add('masterRow', `${d.name} ${r.row}`, p.id);
        if (r.id && r.owner && !(r.owner.by === 'own' && ['MapStageIntegration', 'MessageMapStage'].includes(d.name)))
          add('rowId', `${d.name} ${r.id}`, p.id, false);
      }
      for (const r of d.changed) add('masterRow', `${d.name} ${r.row}`, p.id, false);
    }
  }
  return [...seen]
    .filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => {
      const [kind, value] = key.split('\0') as [Conflict['kind'], string];
      return { kind, value, packages: [...ids], resolvable: !fixed.has(key) };
    });
}

export class InvalidPackage extends Error {}

export type PackageStore = ReturnType<typeof createPackageStore>;

export function createPackageStore(dir: string, baselinePath?: string) {
  // ROM master row hashes (tools/master-baseline.ts); read on each upload so a baseline made later is used
  async function baseline(): Promise<MasterBaseline | null> {
    if (!baselinePath) return null;
    const file = Bun.file(baselinePath);
    return (await file.exists()) ? ((await file.json()) as MasterBaseline) : null;
  }
  let pending = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const run = pending.then(f);
    pending = run.then(
      () => {},
      () => {},
    );
    return run;
  };

  const json = (value: unknown, status = 200): Response =>
    Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

  async function read(id: string): Promise<StoredPackage | null> {
    const file = Bun.file(join(dir, id, 'summary.json'));
    if (!(await file.exists())) return null;
    return (await file.json()) as StoredPackage;
  }

  async function list(): Promise<StoredPackage[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw error;
    }
    const out: StoredPackage[] = [];
    for (const name of names.filter((n) => idPattern.test(n))) {
      const p = await read(name).catch(() => null);
      if (p) out.push(p);
    }
    return out.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id));
  }

  async function upload(request: Request, url: URL): Promise<Response> {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > maxPackageBytes) return json({ error: 'ZIP が大きすぎます (最大 64 MiB)。' }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return json({ error: 'ZIP ファイルを送ってください。' }, 400);
    if (bytes.length > maxPackageBytes) return json({ error: 'ZIP が大きすぎます (最大 64 MiB)。' }, 413);
    let result: { package: StoredPackage; duplicate: boolean };
    try {
      result = await importZip(bytes, url.searchParams.get('name') ?? '');
    } catch (error) {
      if (error instanceof InvalidPackage) return json({ error: error.message }, 422);
      throw error;
    }
    return json(result, result.duplicate ? 200 : 201);
  }

  /** Parses and stores a ZIP (the same ZIP is stored once). Throws InvalidPackage when it is not a Panana ZIP. */
  async function importZip(bytes: Uint8Array, name: string): Promise<{ package: StoredPackage; duplicate: boolean }> {
    let summary: PackageSummary;
    try {
      summary = await parsePananaZip(bytes, await baseline());
    } catch (error) {
      throw new InvalidPackage((error as Error).message);
    }
    const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const id = digest.slice(0, 16);
    // oxlint-disable-next-line no-control-regex -- control characters are what the file name must not keep
    const fileName = name.replace(/[\u0000-\u001f\\/]/g, '').slice(0, 200) || 'package.zip';
    return serial(async () => {
      const existing = await read(id);
      if (existing) return { package: existing, duplicate: true };
      const stored: StoredPackage = {
        id,
        fileName,
        uploadedAt: new Date().toISOString(),
        size: bytes.length,
        sha256: digest,
        summary,
      };
      await mkdir(dir, { recursive: true });
      const temporary = join(dir, `${id}.tmp-${crypto.randomUUID()}`);
      await mkdir(temporary);
      try {
        await Bun.write(join(temporary, 'package.zip'), bytes);
        await Bun.write(join(temporary, 'summary.json'), JSON.stringify(stored, null, 2));
        await rename(temporary, join(dir, id));
      } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
      return { package: stored, duplicate: false };
    });
  }

  async function handle(request: Request, url: URL): Promise<Response> {
    try {
      if (url.pathname === '/api/packages') {
        if (request.method === 'GET') {
          const packages = await list();
          return json({ packages, conflicts: findConflicts(packages) });
        }
        if (request.method === 'POST') return await upload(request, url);
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
      }
      const id = url.pathname.slice('/api/packages/'.length);
      if (!idPattern.test(id)) return json({ error: 'パッケージが見つかりません。' }, 404);
      if (request.method === 'GET') {
        const p = await read(id);
        return p ? json({ package: p }) : json({ error: 'パッケージが見つかりません。' }, 404);
      }
      if (request.method === 'DELETE')
        return serial(async () => {
          if (!(await read(id))) return json({ error: 'パッケージが見つかりません。' }, 404);
          await rm(join(dir, id), { recursive: true, force: true });
          return new Response(null, { status: 204 });
        });
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, DELETE' } });
    } catch (error) {
      console.error('Lanai package request failed:', error);
      return json({ error: 'パッケージの処理に失敗しました。サーバーのログを確認してください。' }, 500);
    }
  }

  return {
    handle,
    list,
    read,
    importZip,
    baseline,
    zipPath: (id: string) => join(dir, id, 'package.zip'),
  };
}
