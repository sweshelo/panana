// The ROM data the tests read: everything in roms/ at the top of the repository, locally and in CI (the rom job of
// .github/workflows/test.yml puts the files there). ROM data is never committed (roms/ is ignored); the tests that need
// a file skip when it is missing, except with REQUIRE_ROM (the CI rom job), where a missing file is an error.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ROMS = join(import.meta.dir, '..', 'roms');

// 電波人間のRPG2 (kahara): the decrypted CIA, the golden data of the Python reference (test/golden/export_golden.py)
// and, when there, the base MOD (elpulse mod/out)
export const CIA = join(ROMS, '00040000000A7900.cia');
export const GOLDEN = join(ROMS, 'golden.json');
export const BASE_MOD = join(ROMS, 'mod', 'out');
export const hasCia = existsSync(CIA);
export const hasGolden = existsSync(GOLDEN);

// 電波人間のRPG3 (oahu): the Base and Update CIAs (decrypted)
export const OAHU_BASE = join(ROMS, 'oahu-base.cia');
export const OAHU_UPDATE = join(ROMS, 'oahu-update.cia');
export const hasOahuBase = existsSync(OAHU_BASE);
export const hasOahuUpdate = existsSync(OAHU_UPDATE);

// 電波人間のRPG FREE! (lanai): the Base and Update CIAs (decrypted)
export const LANAI_BASE = join(ROMS, 'lanai-base.cia');
export const LANAI_UPDATE = join(ROMS, 'lanai-update.cia');
export const hasLanai = existsSync(LANAI_BASE) && existsSync(LANAI_UPDATE);

// CI の ROM ジョブ (REQUIRE_ROM=1) では、スキップして緑になるのを防ぐ
if (process.env.REQUIRE_ROM) {
  const missing = [CIA, GOLDEN, OAHU_BASE, OAHU_UPDATE, LANAI_BASE, LANAI_UPDATE].filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`REQUIRE_ROM is set but roms/ lacks: ${missing.join(' ')}`);
}
