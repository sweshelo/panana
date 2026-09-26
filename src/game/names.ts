// Human-friendly map names. Map codes are {type}{2-digit dungeon}{B|F}{2-digit floor}{3-char id} (e.g.
// D01B02001 = dungeon 1, basement 2, map 001) or {type}{2 digits}OUT{...} for outdoor maps.
import type { MapInfo } from './codebin';
import type { Master } from './master';

const SUFFIX: Record<string, string> = {
  ENT: '入口',
  ELV: 'エレベーター',
  SHP: '店',
  INN: '宿屋',
  WRP: 'ワープ',
  HOME: 'ホーム',
};

export interface MapName {
  /** "地下2階" / "3階" / "屋外" */
  floor: string;
  /** Distinguishes maps on the same floor: "(2)", "入口", "EX1" … ('' when unique). */
  part: string;
}

export function parseMapCode(code: string): { floor: number | null; outdoor: boolean; id: string } | null {
  const m = /^[A-Z]\d{2}(?:([BF])(\d{2})(.+)|OUT(.*))$/.exec(code);
  if (!m) return null;
  if (m[4] !== undefined || !m[1]) return { floor: null, outdoor: true, id: m[4] ?? '' };
  const n = Number(m[2]);
  return { floor: m[1] === 'B' ? -n : n, outdoor: false, id: m[3]! };
}

export function floorLabel(floor: number): string {
  if (floor < 0) return `地下${-floor}階`;
  if (floor > 0) return `${floor}階`;
  return '屋外';
}

export function mapName(info: MapInfo, all: MapInfo[]): MapName {
  const p = parseMapCode(info.name);
  if (!p) return { floor: info.floor ? floorLabel(info.floor) : '', part: info.name };
  const floor = p.outdoor ? '屋外' : floorLabel(p.floor!);
  const same = all.filter((m) => m.dungeon === info.dungeon && m.hash !== info.hash).filter((m) => {
    const q = parseMapCode(m.name);
    return q && q.outdoor === p.outdoor && q.floor === p.floor;
  });
  let part = '';
  if (/^\d+$/.test(p.id)) part = same.length ? `(${Number(p.id)})` : '';
  else part = SUFFIX[p.id] ?? p.id;
  return { floor, part };
}

/** "山のどうくつ 地下2階" (+ " (2)" when the floor has several maps). */
export function mapTitle(info: MapInfo, all: MapInfo[], master: Master): string {
  const n = mapName(info, all);
  const d = master.dungeonName(info.dungeon) || info.dungeonCode;
  return [d, n.floor, n.part].filter(Boolean).join(' ');
}

/** Short label inside a dungeon group: "地下2階 (2)". */
export function mapShortTitle(info: MapInfo, all: MapInfo[]): string {
  const n = mapName(info, all);
  return [n.floor, n.part].filter(Boolean).join(' ') || info.name;
}
