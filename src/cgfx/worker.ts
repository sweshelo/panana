// Web Worker: CGFX -> plain geometry / RGBA data (docs/map-editor-design.md §5).
import { buildTileset, transferables } from './tileset';

export interface TilesetRequest {
  id: number;
  modelArchive: Uint8Array;
  textureArchive: Uint8Array | null;
  textureEntry: number;
}

self.onmessage = (ev: MessageEvent<TilesetRequest>) => {
  const { id, modelArchive, textureArchive, textureEntry } = ev.data;
  try {
    const t = buildTileset(modelArchive, textureArchive, textureEntry);
    (self as unknown as Worker).postMessage({ id, result: t }, transferables(t));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
