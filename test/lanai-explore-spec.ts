export const SPEC = {
  max: 500,
  strings: ['ext:/arc', 'content:/0000', 'patch:/FFFFFFFF', 'rom:/FFFFFFFF', 'ext:/FFFFFFFF', 'resource.dat', 'Extdata', 'extdata'],
  callers: [0x31b540, 0x208bb4, 0x31f200, 0x2fe1d0, 0x2fe584, 0x19d700],
  refsTo: [] as [number, number][],
  hex: [[0x4eb8f0, 0xe0]] as [number, number][],
  archives: [] as string[],
  rowsOf: [] as string[],
  funcs: [0x31b540, 0x208bb4, 0x31f200, 0x2fe1d0, 0x2fe584, 0x19d700],
  ranges: [] as [number, number][],
};
