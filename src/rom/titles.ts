// The games Panana knows, told apart by the title ID of the dump. Each game has its internal name (the ExHeader
// name of its code): honolulu = 電波人間のRPG (the first one, naauao roms/honolulu.md §1), kahara = 電波人間のRPG2,
// oahu = 電波人間のRPG3 (naauao oahu/analysis.md §1), lanai = 電波人間のRPG FREE! (its ExHeader name is empty; the name is
// from its RomFS, naauao roms/lanai.md §1).
// Code that only applies to one game carries that name (KaharaXxx / OahuXxx).

export type TitleKey = 'kahara' | 'oahu' | 'lanai' | 'honolulu';

export interface TitleDef {
  key: TitleKey;
  /** Name shown to the user. */
  name: string;
  /** Title ID of the game (the Base for a game with updates); also the LayeredFS folder of a MOD. */
  titleId: string;
  /** Title ID of its update (0004000E…), when the game has one. */
  updateTitleId?: string;
  /** Root RomFS file of the master archive (GS tables, messages); tells the games apart in an extracted folder. */
  master: string;
  /**
   * Other root files the game always has, for an extracted folder whose master name another game shares (RPG2 and the
   * first game both use 56562135, naauao roms/honolulu.md §2): the folder is the game's only when they are all there.
   */
  requires?: readonly string[];
}

// the shop and item model archives the editor reads (game.ts); the first game has neither
export const KAHARA: TitleDef = { key: 'kahara', name: '電波人間のRPG2', titleId: '00040000000A7900', master: '56562135', requires: ['49A43B63', '302996EB'] };

export const OAHU: TitleDef = {
  key: 'oahu',
  name: '電波人間のRPG3',
  titleId: '00040000000EF000',
  updateTitleId: '0004000E000EF000',
  master: '21350000',
};

export const LANAI: TitleDef = {
  key: 'lanai',
  name: '電波人間のRPG FREE!',
  titleId: '0004000000125D00',
  updateTitleId: '0004000E00125D00',
  master: '2135000A',
};

// no Update is known (naauao roms/honolulu.md §1); the cloth textures and the island, which RPG2 does not have
export const HONOLULU: TitleDef = {
  key: 'honolulu',
  name: '電波人間のRPG',
  titleId: '0004000000077E00',
  master: '56562135',
  requires: ['B50A5EA9', 'FB50F315'],
};

export const TITLES: readonly TitleDef[] = [KAHARA, OAHU, LANAI, HONOLULU];

/** The game of a title ID (its Base), or undefined. */
export const titleById = (id: string): TitleDef | undefined => TITLES.find((t) => t.titleId === id.toUpperCase());

/** The game whose update has this title ID, or undefined. */
export const titleByUpdateId = (id: string): TitleDef | undefined => TITLES.find((t) => t.updateTitleId === id.toUpperCase());

/** The game of a dump given its title ID; throws a message for the user when it is not one Panana reads. */
export function identifyTitle(id: string): TitleDef {
  const t = titleById(id);
  if (t) return t;
  const u = titleByUpdateId(id);
  if (u) throw new Error(`これは『${u.name}』の Update (${id}) です。Base (${u.titleId}) の CIA を選んでください。`);
  throw new Error(`タイトル ID が ${id} です。${TITLES.map((x) => `『${x.name}』(${x.titleId})`).join('・')} のダンプを使ってください。`);
}

/**
 * The game of an extracted folder, from the name of its master archive and the files that tell apart the games sharing
 * it (undefined when none fits).
 */
export const titleByRootFiles = (names: Iterable<string>): TitleDef | undefined => {
  const have = new Set([...names].map((n) => n.toUpperCase()));
  return TITLES.find((t) => have.has(t.master) && (t.requires ?? []).every((n) => have.has(n)));
};
