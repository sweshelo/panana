// Paths of the local dump used by the tests. ROM data is never committed; tests skip when it is missing.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ELPULSE = process.env.ELPULSE_ROOT ?? join(import.meta.dir, '..', '..', 'elpulse');
export const CIA = process.env.ROM_CIA ?? join(ELPULSE, '00040000000A7900.cia');
export const GOLDEN = join(import.meta.dir, 'golden', 'golden.json');
export const hasCia = existsSync(CIA);
export const hasGolden = existsSync(GOLDEN);
