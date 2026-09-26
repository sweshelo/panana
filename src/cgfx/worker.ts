// Web Worker: CGFX -> plain geometry / RGBA data (docs/map-editor-design.md §5).
import { buildObjects, buildTileset, transferables, type TilesetModels } from './tileset';

export type WorkerRequest =
  | { id: number; kind: 'tileset'; modelArchive: Uint8Array; textureArchive: Uint8Array | null; textureEntry: number }
  | { id: number; kind: 'objects'; archive: Uint8Array; entries: number[] };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const post = (msg: unknown, transfer: ArrayBuffer[] = []): void => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    if (req.kind === 'tileset') {
      const t = buildTileset(req.modelArchive, req.textureArchive, req.textureEntry);
      post({ id: req.id, result: t }, transferables(t));
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
