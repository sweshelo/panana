// Names and colours used by the views and the palette.

/** Roles known from docs/map.md §3 (D01B02001 compared with the in-game minimap). */
export const KIND_NAMES: Record<number, string> = {
  0: '壁 (外周)',
  1: '通路 (直線)',
  2: '通路 (曲がり角)',
  3: '通路 (T 字)',
  4: '通路の行き止まり',
  5: '部屋の床 (中央)',
  6: '壁 (種類 6)',
  7: '部屋の辺',
  9: '部屋の出入口',
  12: '通路の特殊部品',
  14: '部屋の角',
};
export const kindName = (k: number): string => KIND_NAMES[k] ?? (k >= 15 && k <= 27 ? `屋内 ${k}` : `種類 ${k}`);

export function kindColor(k: number): string {
  if (k === 5) return '#d9c38f';
  if (k === 7) return '#c9ad73';
  if (k === 9) return '#e8d49c';
  if (k === 14) return '#b8985c';
  if (k >= 1 && k <= 4) return '#8fb3c9';
  if (k === 12) return '#6f9fbf';
  if (k === 0 || k === 6) return '#6b6b6b';
  const h = (k * 47) % 360;
  return `hsl(${h} 45% 62%)`;
}

export const SECTION_COLORS: Record<number, string> = {
  1: '#a0522d', // placed props
  2: '#ff8c1a', // gimmicks
  3: '#2f7bff', // exits / doors / warp holes
  4: '#ffd400', // treasure
  5: '#26c26b', // objects
  8: '#c04dff', // conditional objects
  9: '#9aa0a6',
};
export const ROOM_COLOR = 'rgba(80, 200, 255, 0.18)';
export const ROT_ARROW = ['↑', '→', '↓', '←'];
