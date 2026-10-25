// The models of RPG3's monsters. A monster row names its design (monsterParameter +0x48, low 8 bits); a row of
// monsterDesign.bin (402F0000, 163 × 0x78) holds the hashes of the model (+0x0C), its colour's textures (+0x10) and its
// skill motion (+0x14), all entries of the root archive 28480000. Monsters of one species share a model and differ by
// the texture entry (はなもぐら, ネズミはなもぐら and はなざかりもぐら are all enemy_66).
import { findByName, parseArchive, rebuildArchive, type Archive, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { BchEntryIndex, bchLookSet } from '../bch/models';
import type { ModelRef } from '../pages/modelview';
import type { Dump } from '../rom/dump';
import { equalBytes, u32 } from '../util/bytes';

export const OAHU_MONSTER_MODEL_ARCHIVE = '28480000';
export const OAHU_DESIGN_ARCHIVE = '402F0000';
/** monsterDesign +0x77: the size class of the camera (RPG2's MonsterDesign +0x6E). */
export const OAHU_CAMERA_SIZE = 0x77;

/**
 * The size classes of monsterDesign +0x77 and the column of actionCamera they pick (FUN_004CB2E4, FUN_0029CB98): an
 * enemy's 10 / 16 / 20 all take column 3, a caught monster (a 仲間) takes 4 for 10 and 5 for 16.
 */
export const OAHU_CAMERA_SIZES: [number, string][] = [
  [1, '1: 小さい (列 0)'],
  [2, '2: 小さい (列 0)'],
  [4, '4: 中くらい (列 1)'],
  [6, '6: 大きい (列 2)'],
  [10, '10: とても大きい (敵は列 3、仲間は列 4)'],
  [16, '16: 巨大 (敵は列 3、仲間は列 5)'],
  [20, '20: 巨大 (列 3)'],
];

export interface OahuMonsterDesign {
  model: number;
  texture: number;
  motion: number;
}

/** monsterDesign.bin as read, with the rows a port added (#100); exported in 402F0000. */
interface DesignTable {
  arc: Archive;
  entry: ArcEntry;
  table: GsTable;
  original: Uint8Array;
}

export class OahuMonsterModels {
  private table: Promise<DesignTable | null> | null = null;
  private loaded: DesignTable | null = null;
  /** The table read before the designs were (a saved one to put back once they are). */
  private pending: Uint8Array | null = null;
  /** The entries of 28480000 (read once for every model, as FREE!'s are). */
  private index: Promise<BchEntryIndex> | null = null;

  constructor(readonly dump: Dump) {}

  private load(): Promise<DesignTable | null> {
    this.table ??= this.dump.readRomfs(OAHU_DESIGN_ARCHIVE).then((b) => {
      const arc = parseArchive(b);
      const f = findByName(arc, 'monsterDesign.bin');
      if (!f) return null;
      const t: DesignTable = { arc, entry: f.entry, table: new GsTable(f.body.slice()), original: f.body };
      if (this.pending) t.table.data = this.pending.slice();
      this.loaded = t;
      return t;
    }, () => null);
    return this.table;
  }

  private async designs(): Promise<GsTable | null> {
    return (await this.load())?.table ?? null;
  }

  /** Number of design rows and a row's bytes (a copy). */
  async rows(): Promise<number> {
    return (await this.designs())?.rows ?? 0;
  }
  async rowBytes(row: number): Promise<Uint8Array | null> {
    const t = await this.designs();
    return t && row >= 0 && row < t.rows ? t.row(row).slice() : null;
  }

  /** Appends a design row (a monster's +0x48 keeps the row in 8 bits: 256 rows at most). Returns its number. */
  async addRow(bytes: Uint8Array): Promise<number> {
    const t = await this.designs();
    if (!t) throw new Error(`${OAHU_DESIGN_ARCHIVE} に monsterDesign.bin がありません`);
    if (t.rows >= 0x100) throw new Error('モンスターのデザインはこれ以上増やせません (256 行まで)');
    return t.append(bytes.slice());
  }

  /** The edited table (null when unchanged), for saving; and putting a saved one back. */
  saved(): Uint8Array | null {
    const t = this.loaded;
    if (!t) return this.pending;
    return !equalBytes(t.table.data, t.original) ? t.table.data.slice() : null;
  }
  async restore(bytes: Uint8Array): Promise<void> {
    this.pending = bytes;
    const t = await this.load();
    if (t) t.table.data = bytes.slice();
  }

  /**
   * 402F0000 with the edited monsterDesign.bin and the other entries given (directData of the performances), or null
   * when nothing changed.
   */
  async archive(more: Map<number, Uint8Array> = new Map()): Promise<Uint8Array | null> {
    const t = await this.load();
    if (!t) return null;
    const entries = new Map(more);
    if (!equalBytes(t.table.data, t.original)) entries.set(t.entry.index, t.table.data);
    return entries.size ? rebuildArchive(t.arc, entries) : null;
  }

  /**
   * monsterDesign +0x77: the size class the battle's camera picks its column of actionCamera by (FUN_004CB2E4; naauao
   * oahu/actions.md §5.5). null while the table is not read or the row is past it.
   */
  cameraSize(row: number): number | null {
    const t = this.loaded?.table;
    return t && row >= 0 && row < t.rows && t.rowSize > OAHU_CAMERA_SIZE ? t.row(row)[OAHU_CAMERA_SIZE]! : null;
  }
  originalCameraSize(row: number): number | null {
    const t = this.loaded;
    if (!t) return null;
    const o = new GsTable(t.original);
    return row >= 0 && row < o.rows && o.rowSize > OAHU_CAMERA_SIZE ? o.row(row)[OAHU_CAMERA_SIZE]! : null;
  }
  setCameraSize(row: number, v: number): void {
    const t = this.loaded?.table;
    if (!t || row < 0 || row >= t.rows) throw new Error(`monsterDesign の行 ${row} はありません`);
    t.row(row)[OAHU_CAMERA_SIZE] = v & 0xff;
  }

  /** The model archive by hash (read once; again after forgetModels). */
  modelIndex(): Promise<BchEntryIndex> {
    if (!this.index) {
      const p = BchEntryIndex.of([OAHU_MONSTER_MODEL_ARCHIVE], (n) => this.dump.readRomfs(n).then(parseArchive));
      p.catch(() => {
        if (this.index === p) this.index = null;
      });
      this.index = p;
    }
    return this.index;
  }

  /** The model archive is read again next time (a port added entries to it). */
  forgetModels(): void {
    this.index = null;
  }

  async design(row: number): Promise<OahuMonsterDesign | null> {
    const t = await this.designs();
    if (!t || row < 0 || row >= t.rows) return null;
    const r = t.row(row);
    const u32 = (o: number): number => new DataView(r.buffer, r.byteOffset, r.length).getUint32(o, true);
    return { model: u32(0x0c), texture: u32(0x10), motion: u32(0x14) };
  }

  /** The model of a design row with its colour's textures (for the photos), and its skill motions for the viewers. */
  ref(design: number, motions = false): ModelRef {
    // A row is named by its files: the photos are cached by the key, and a row may be another look (one a port added
    // (#100) after the edits are discarded and redone, any one on a base MOD).
    const t = this.loaded;
    const added = !t ? `/r${Math.random()}` : design >= 0 && design < t.table.rows ? `/${[0x0c, 0x10, 0x14].map((o) => u32(t.table.row(design), o).toString(16)).join('-')}` : '';
    return {
      key: `oahu-monster/${this.dump.title.key}/${design}${added}${motions ? '/motions' : ''}`,
      load: async () => {
        const d = await this.design(design);
        if (!d?.model) return null;
        const index = await this.modelIndex();
        return index.get(d.model) ? { set: bchLookSet(index, d, motions), hash: 0 } : null;
      },
    };
  }
}
