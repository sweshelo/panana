import type { AutoProfile } from '../editor/autotile';
/** Kahara outdoor dungeon parts, verified against the base ROM's placed tiles.
 * Corner bits NE,SE,SW,NW describe inward wall corners. Keep these IDs out of the solver.
 */
export const KAHARA_AUTO: AutoProfile = {
  isolated: 1,
  parts: [
    {kind:0,wide:0,narrow:15}, {kind:1,wide:0,narrow:10},
    {kind:2,wide:0,narrow:6}, {kind:3,wide:0,narrow:14}, {kind:4,wide:0,narrow:2},
    {kind:5,wide:15,narrow:0}, {kind:7,wide:14,narrow:0},
    {kind:8,wide:15,narrow:0,corners:1}, {kind:9,wide:14,narrow:1},
    {kind:10,wide:12,narrow:3}, {kind:11,wide:6,narrow:8},
    {kind:12,wide:12,narrow:2}, {kind:13,wide:15,narrow:0,corners:10},
    {kind:14,wide:6,narrow:0},
  ],
};
