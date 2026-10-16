// H3D (BCH) object model, reader and writer for porting models between RPG3 (version 8) and RPG FREE! (0x21).
export * from './types';
export { readH3D, readH3DHeader, readRelocations, vertexLayout, decodeFragment, textureLength, mipmapLength, Sec } from './read';
export type { H3DHeader, Relocation, ReadOptions, H3DTrace } from './read';
export { writeH3D, mergeSegments } from './write';
export type { WriteOptions } from './write';
export { buildPatriciaTree } from './patricia';
export { readCommands, commandState, PICACommandWriter, Reg, getFloat24, getWord24, vectorFromWords, wordsFromVector } from './pica';
export { meshCommands, subMeshCommands, textureCommands, materialTextureCommands, fragmentShaderCommands, lutSamplerCommands, lutConfigCommands, textureTransform } from './commands';
