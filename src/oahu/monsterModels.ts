// The models of RPG3's monsters. A monster row names its design (monsterParameter +0x48, low 8 bits); a row of
// monsterDesign.bin (402F0000, 163 × 0x78) holds the hashes of the model (+0x0C), its colour's textures (+0x10) and its
// skill motion (+0x14), all entries of the root archive 28480000. Monsters of one species share a model and differ by
// the texture entry (はなもぐら, ネズミはなもぐら and はなざかりもぐら are all enemy_66).
import { findByName, parseArchive, rebuildArchive, type Archive, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { bchEntryRef } from '../bch/models';
import type { ModelRef } from '../pages/modelview';
import type { Dump } from '../rom/dump';
import { equalBytes, u32 } from '../util/bytes';

export const OAHU_MONSTER_MODEL_ARCHIVE = '28480000';
export const OAHU_DESIGN_ARCHIVE = '402F0000';

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

  /** 402F0000 with the edited monsterDesign.bin, or null when it is unchanged. */
  async archive(): Promise<Uint8Array | null> {
    const t = await this.load();
    if (!t || equalBytes(t.table.data, t.original)) return null;
    return rebuildArchive(t.arc, new Map([[t.entry.index, t.table.data]]));
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
    // A row a port added (#100) is named by its files (the photos are cached by the key, and the row may be another
    // look after the edits are discarded and redone).
    const t = this.loaded;
    const origRows = t ? new GsTable(t.original).rows : 0;
    const added = !t ? `/r${Math.random()}` : design >= origRows && design < t.table.rows ? `/${[0x0c, 0x10, 0x14].map((o) => u32(t.table.row(design), o).toString(16)).join('-')}` : '';
    return {
      key: `oahu-monster/${this.dump.title.key}/${design}${added}${motions ? '/motions' : ''}`,
      load: async () => {
        const d = await this.design(design);
        if (!d?.model) return null;
        return bchEntryRef(this.dump, OAHU_MONSTER_MODEL_ARCHIVE, d.model, 0, d.texture ? [d.texture] : [], motions && d.motion ? [d.motion] : []).load();
      },
    };
  }
}
