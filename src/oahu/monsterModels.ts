// The models of RPG3's monsters. A monster row names its design (monsterParameter +0x48, low 8 bits); a row of
// monsterDesign.bin (402F0000, 163 × 0x78) holds the hashes of the model (+0x0C), its colour's textures (+0x10) and its
// skill motion (+0x14), all entries of the root archive 28480000. Monsters of one species share a model and differ by
// the texture entry (はなもぐら, ネズミはなもぐら and はなざかりもぐら are all enemy_66).
import { findByName, parseArchive } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { bchEntryRef } from '../bch/models';
import type { ModelRef } from '../pages/modelview';
import type { Dump } from '../rom/dump';

export const OAHU_MONSTER_MODEL_ARCHIVE = '28480000';
const DESIGN_ARCHIVE = '402F0000';

export interface OahuMonsterDesign {
  model: number;
  texture: number;
  motion: number;
}

export class OahuMonsterModels {
  private table: Promise<GsTable | null> | null = null;

  constructor(readonly dump: Dump) {}

  private designs(): Promise<GsTable | null> {
    this.table ??= this.dump.readRomfs(DESIGN_ARCHIVE).then((b) => {
      const f = findByName(parseArchive(b), 'monsterDesign.bin');
      return f ? new GsTable(f.body) : null;
    }, () => null);
    return this.table;
  }

  async design(row: number): Promise<OahuMonsterDesign | null> {
    const t = await this.designs();
    if (!t || row < 0 || row >= t.rows) return null;
    const r = t.row(row);
    const u32 = (o: number): number => new DataView(r.buffer, r.byteOffset, r.length).getUint32(o, true);
    return { model: u32(0x0c), texture: u32(0x10), motion: u32(0x14) };
  }

  /** The model of a design row with its colour's textures, for the photos and the viewer. */
  ref(design: number): ModelRef {
    return {
      key: `oahu-monster/${this.dump.title.key}/${design}`,
      load: async () => {
        const d = await this.design(design);
        if (!d?.model) return null;
        return bchEntryRef(this.dump, OAHU_MONSTER_MODEL_ARCHIVE, d.model, 0, d.texture ? [d.texture] : []).load();
      },
    };
  }
}
