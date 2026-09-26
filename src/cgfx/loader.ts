// Loads a dungeon's tileset models: IndexedDB cache -> worker conversion.
import type { Game } from '../game/game';
import { hex8 } from '../util/bytes';
import { idbGet, idbSet } from '../util/idb';
import type { TilesetModels } from './tileset';
import type { TilesetRequest } from './worker';

const CACHE_VERSION = 3;
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (t: TilesetModels) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.result as TilesetModels);
    };
  }
  return worker;
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
        game.dump.readRomfs(src.modelArchive),
        src.textureArchive !== '00000000' ? game.dump.readRomfs(src.textureArchive).catch(() => null) : null,
      ]);
      const id = nextId++;
      const result = await new Promise<TilesetModels>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const req: TilesetRequest = {
          id,
          modelArchive: modelArchive.slice(),
          textureArchive: textureArchive ? textureArchive.slice() : null,
          textureEntry: src.textureEntry,
        };
        getWorker().postMessage(req);
      });
      await idbSet(key, result);
      return result;
    })();
    memory.set(key, p);
    p.catch(() => memory.delete(key));
  }
  return p;
}
