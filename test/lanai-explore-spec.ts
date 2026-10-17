// TEMPORARY: what test/lanai-explore-checkin.test.ts prints.
export const SPEC = {
  max: 450,
  strings: ['data:/', 'sdmc:/', 'patchList', '.crr/', 'lanai.crs'],
  callers: [0x27803c, 0x388b90, 0x31f0c0],
  refsTo: [[0x4dce30, 0x4dce50], [0x4e1400, 0x4e1500]] as [number, number][],
  hex: [[0x4dce20, 0x60], [0x4e1430, 0xa0], [0x4fc720, 0xc0]] as [number, number][],
  archives: ['2135000A'],
  rowsOf: ['Boss', 'TableResource'],
  funcs: [0x31f0c0, 0x1e9b9c, 0x227e64, 0x27803c],
  ranges: [] as [number, number][],
};
