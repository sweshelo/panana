// The GS tables of 電波人間のRPG3's master archive 21350000 (naauao oahu/analysis.md §4.3), kept in MasterTables.
import { parseArchive } from '../archive/gsarc';
import { MasterTables } from '../game/mastertables';
import type { Dump } from '../rom/dump';
import { OAHU } from '../rom/titles';

export type { SavedRow } from '../game/mastertables';

export const OAHU_MASTER = OAHU.master;

export class OahuMaster extends MasterTables {
  static async load(dump: Dump): Promise<OahuMaster> {
    return new OahuMaster(parseArchive(await dump.readRomfs(OAHU_MASTER)), OAHU_MASTER);
  }
}
