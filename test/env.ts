// Paths of the local dump used by the tests. ROM data is never committed; tests skip when it is missing.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ELPULSE = process.env.ELPULSE_ROOT ?? join(import.meta.dir, '..', '..', 'elpulse');
export const CIA = process.env.ROM_CIA ?? join(ELPULSE, '00040000000A7900.cia');
export const GOLDEN = process.env.ROM_GOLDEN ?? join(import.meta.dir, 'golden', 'golden.json');
export const hasCia = existsSync(CIA);
export const hasGolden = existsSync(GOLDEN);

// 電波人間のRPG3: the Base and Update CIAs (decrypted). Not in the CI bundle yet; those tests skip without them.
export const OAHU_BASE = process.env.ROM_OAHU_BASE ?? join(ELPULSE, '0004000E000EF000-v0.1.0.cia');
export const OAHU_UPDATE = process.env.ROM_OAHU_UPDATE ?? join(ELPULSE, '0004000E000EF000-v4.7.0.cia');
export const hasOahuBase = existsSync(OAHU_BASE);
export const hasOahuUpdate = existsSync(OAHU_UPDATE);

// CI の ROM ジョブ (REQUIRE_ROM=1) では、スキップして緑になるのを防ぐ
if (process.env.REQUIRE_ROM && (!hasCia || !hasGolden)) {
  throw new Error(`REQUIRE_ROM is set but the dump is missing: ${hasCia ? '' : CIA} ${hasGolden ? '' : GOLDEN}`);
}
