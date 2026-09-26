// Loads models: memory -> IndexedDB cache -> worker conversion.
import type { Game } from '../game/game';
import { hex8 } from '../util/bytes';
import { idbGet, idbSet } from '../util/idb';
import type { TilesetModels } from './tileset';
import type { WorkerRequest } from './worker';

const CACHE_VERSION = 5;
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (t: unknown) => void; reject: (e: Error) => void }>();

type Body<T> = T extends unknown ? Omit<T, 'id'> : never;

function run<T>(req: Body<WorkerRequest>, transfer: ArrayBuffer[]): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.result);
    };
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (t: unknown) => void, reject });
    worker!.postMessage({ ...req, id }, transfer);
  });
}

const memory = new Map<string, Promise<TilesetModels>>();

export function loadTilesetModels(game: Game, dungeon: number): Promise<TilesetModels> {
  const src = game.tilesetSource(dungeon);
  const key = `tileset/${src.modelArchive}/${hex8(src.textureEntry)}/v${CACHE_VERSION}`;
  let p = memory.get(key);
  if (!p) {
    p = (async () => {
      const cached = await idbGet<TilesetModels>(key);
      if (cached && cached.models instanceof Map) return cached;
      const [modelArchive, textureArchive] = await Promise.all([
        game.dump.readRomfs(src.modelArchive).then((b) => b.slice()),
        src.textureArchive !== '00000000' ? game.dump.readRomfs(src.textureArchive).then((b) => b.slice()).catch(() => null) : null,
      ]);
      const result = await run<TilesetModels>(
        { kind: 'tileset', modelArchive, textureArchive, textureEntry: src.textureEntry },
        [modelArchive.buffer as ArrayBuffer, ...(textureArchive ? [textureArchive.buffer as ArrayBuffer] : [])],
      );
      await idbSet(key, result);
      return result;
    })();
    memory.set(key, p);
    p.catch(() => memory.delete(key));
  }
  return p;
}

const objKey = (archive: number, entry: number): string => `object/${hex8(archive)}/${hex8(entry)}/v${CACHE_VERSION}`;

/** Models of object files (mapObject rows). Files of the same archive are converted in one request. */
export async function loadObjectModels(
  game: Game,
  refs: { archive: number; entry: number }[],
): Promise<Map<string, TilesetModels>> {
  const out = new Map<string, TilesetModels>();
  const todo = new Map<number, number[]>();
  const waits: Promise<void>[] = [];
  for (const { archive, entry } of refs) {
    const key = objKey(archive, entry);
    if (out.has(key)) continue;
    const m = memory.get(key);
    if (m) {
      waits.push(m.then((t) => void out.set(key, t)).catch(() => {}));
      continue;
    }
    const list = todo.get(archive) ?? [];
    if (!list.includes(entry)) list.push(entry);
    todo.set(archive, list);
  }
  for (const [archive, entries] of todo) {
    const job = (async () => {
      const found = new Map<number, TilesetModels>();
      const missing: number[] = [];
      for (const e of entries) {
        const c = await idbGet<TilesetModels>(objKey(archive, e));
        if (c && c.models instanceof Map) found.set(e, c);
        else missing.push(e);
      }
      if (missing.length) {
        const bytes = (await game.dump.readRomfs(hex8(archive))).slice();
        const res = await run<Map<number, TilesetModels>>({ kind: 'objects', archive: bytes, entries: missing }, [bytes.buffer as ArrayBuffer]);
        for (const [e, t] of res) {
          found.set(e, t);
          await idbSet(objKey(archive, e), t);
        }
      }
      return found;
    })();
    for (const e of entries) {
      const p = job.then((f) => f.get(e)!);
      memory.set(objKey(archive, e), p);
      p.catch(() => memory.delete(objKey(archive, e)));
      waits.push(p.then((t) => void out.set(objKey(archive, e), t)).catch(() => {}));
    }
  }
  await Promise.all(waits);
  return out;
}

export { objKey };

// ---- model + texture pairs of one archive (monsters)

const compositeKey = (name: string, model: number, tex: number): string => `composite/${name}/${hex8(model)}/${hex8(tex)}/v${CACHE_VERSION}`;
/** Archives the worker already keeps. */
const sentArchives = new Set<string>();
const queues = new Map<string, Map<string, { model: number; tex: number; resolve: (t: TilesetModels) => void; reject: (e: Error) => void }>>();

/** A model of an archive with the textures of another entry (0 = its own); batched per archive. */
export function loadComposite(game: Game, name: string, model: number, tex: number): Promise<TilesetModels> {
  const key = compositeKey(name, model, tex);
  let p = memory.get(key);
  if (!p) {
    p = (async () => {
      const cached = await idbGet<TilesetModels>(key).catch(() => undefined);
      if (cached && cached.models instanceof Map) return cached;
      return new Promise<TilesetModels>((resolve, reject) => {
        let q = queues.get(name);
        if (!q) {
          q = new Map();
          queues.set(name, q);
          setTimeout(() => flush(game, name), 0);
        }
        q.set(`${model}/${tex}`, { model, tex, resolve, reject });
      });
    })();
    memory.set(key, p);
    p.catch(() => memory.delete(key));
  }
  return p;
}

async function flush(game: Game, name: string): Promise<void> {
  const q = queues.get(name);
  queues.delete(name);
  if (!q?.size) return;
  try {
    const archive = sentArchives.has(name) ? null : (await game.dump.readRomfs(name)).slice();
    const res = await run<Map<string, TilesetModels>>(
      { kind: 'composite', name, archive, pairs: [...q.values()].map((x) => [x.model, x.tex] as [number, number]) },
      archive ? [archive.buffer as ArrayBuffer] : [],
    );
    sentArchives.add(name);
    for (const [k, w] of q) {
      const t = res.get(k);
      if (!t) {
        w.reject(new Error('変換できませんでした'));
        continue;
      }
      w.resolve(t);
      idbSet(compositeKey(name, w.model, w.tex), t).catch(() => {});
    }
  } catch (err) {
    for (const w of q.values()) w.reject(err as Error);
  }
}
