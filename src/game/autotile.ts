import type { AutoProfile } from '../editor/autotile';
/** Kahara outdoor dungeon parts, verified against the base ROM's placed tiles.
 * Corner bits NE,SE,SW,NW describe inward wall corners. Keep these IDs out of the solver.
 */
export const KAHARA_AUTO: AutoProfile = {
  isolated: 1,
  parts: [
    { kind: 0, wide: 0, narrow: 15 },
    { kind: 1, wide: 0, narrow: 10 },
    { kind: 2, wide: 0, narrow: 6 },
    { kind: 3, wide: 0, narrow: 14 },
    { kind: 4, wide: 0, narrow: 2 },
    { kind: 5, wide: 15, narrow: 0, variation: 'floor' },
    { kind: 7, wide: 14, narrow: 0, variation: 'edge' },
    { kind: 8, wide: 15, narrow: 0, corners: 1, variation: 'corner' },
    { kind: 9, wide: 14, narrow: 1 },
    { kind: 10, wide: 12, narrow: 3 },
    { kind: 11, wide: 6, narrow: 8 },
    { kind: 12, wide: 12, narrow: 2 },
    { kind: 13, wide: 15, narrow: 0, corners: 10, variation: 'corner' },
    { kind: 14, wide: 6, narrow: 0, variation: 'corner' },
  ],
};

/** RPG FREE! dungeon parts: the same shapes as RPG2's outdoor parts. Checked against the 507 outdoor maps of the ROM
 * (facings decoded by LANAI_ROT_CODEC; test/lanai-autotile.test.ts): each part's neighbours fill its wide | narrow
 * edges for most placed tiles and better than under any other turn, and 8 / 13 lack room tiles on their inward
 * diagonals. Kind 6 (a floor that is never turned) and 33 (empty) are not parts: the brush keeps them as they are.
 */
export const LANAI_AUTO: AutoProfile = KAHARA_AUTO;
