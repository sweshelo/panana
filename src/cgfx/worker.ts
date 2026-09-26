// Web Worker: CGFX -> plain geometry / RGBA data (docs/map-editor-design.md §5).
import { parseArchive, type Archive } from '../archive/gsarc';
import { buildComposite, buildObjects, buildTileset, transferables, type TilesetModels } from './tileset';

export type WorkerRequest =
  | { id: number; kind: 'tileset'; modelArchive: Uint8Array; textureArchive: Uint8Array | null; textureEntry: number }
  | { id: number; kind: 'objects'; archive: Uint8Array; entries: number[] }
  /** Model + texture pairs of one archive; the archive bytes are sent once and kept here. */
  | { id: number; kind: 'composite'; name: string; archive: Uint8Array | null; pairs: [number, number][] };

const kept = new Map<string, Archive>();

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const post = (msg: unknown, transfer: ArrayBuffer[] = []): void => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    if (req.kind === 'tileset') {
      const t = buildTileset(req.modelArchive, req.textureArchive, req.textureEntry);
      post({ id: req.id, result: t }, transferables(t));
    } else if (req.kind === 'composite') {
      if (req.archive) kept.set(req.name, parseArchive(req.archive));
      const arc = kept.get(req.name);
      if (!arc) throw new Error(`アーカイブ ${req.name} を受け取っていません`);
      const m = new Map<string, TilesetModels>();
      const transfer: ArrayBuffer[] = [];
      for (const [model, tex] of req.pairs) {
        const t = buildComposite(arc, model, tex);
        m.set(`${model}/${tex}`, t);
        for (const b of transferables(t)) if (!transfer.includes(b)) transfer.push(b);
      }
      post({ id: req.id, result: m }, transfer);
    } else {
      const m = buildObjects(req.archive, req.entries);
      const transfer: ArrayBuffer[] = [];
      for (const t of m.values()) for (const b of transferables(t as TilesetModels)) if (!transfer.includes(b)) transfer.push(b);
      post({ id: req.id, result: m }, transfer);
    }
  } catch (err) {
    post({ id: req.id, error: (err as Error).message });
  }
};
