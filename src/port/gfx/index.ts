// CGFX (NW4C .bcres / .bcmdl) object model with a byte-identical reader and writer (port of SPICA's CtrGfx).
export * from './types';
export { readGfx, GFX_TYPE, GFX_MAGIC, KEY_FORMATS, bakedCount, boolCount } from './read';
export { writeGfx } from './write';
export { buildDictTree, dictFind, type GfxDictNode } from './dict';
export * from './pica';
export * from './util';
