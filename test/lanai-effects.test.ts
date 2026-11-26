// 電波人間のRPG FREE! (lanai) effects (src/lanai/effects.ts): EffectData rows name .ptcl files of 90ED0000 / F0F40000,
// whose first texture is read; MapObject rows put an effect with their model (the lit torches; with the dumps).
import { beforeAll, describe, expect, test } from 'bun:test';
import { lanaiEffect, lanaiEffectRef } from '../src/lanai/effects';
import { lanaiObjectEffect } from '../src/lanai/mapObjects';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! effects', () => {
  let s: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump);
  }, 300000);

  test('EffectData rows name their .ptcl in either archive', async () => {
    const t = s.table('EffectData')!;
    expect(t.rows).toBe(1578);
    const archives = new Map<string, number>();
    for (let r = 1; r < t.rows; r++) {
      const ref = lanaiEffectRef(t, r);
      if (ref) archives.set(ref.archive, (archives.get(ref.archive) ?? 0) + 1);
    }
    expect(Object.fromEntries(archives)).toEqual({ '90ED0000': 1097, F0F40000: 477 });
    const names = await Promise.all([0x22, 0x23, 0x24, 0x26, 0x27].map(async (r) => (await lanaiEffect(s, r))?.name));
    expect(names).toEqual([
      'fx_bg_f_warpzone_goal.ptcl',
      'fx_bg_f_torch.ptcl',
      'fx_bg_bonfire.ptcl',
      'fx_bg_repair_field.ptcl',
      'fx_bg_repair_point.ptcl',
    ]);
  });

  test("a torch's flame: its first texture is a 64 × 64 ETC1", async () => {
    const torch = (await lanaiEffect(s, 0x23))!.texture!;
    expect([torch.width, torch.height, torch.format, torch.rgba.length]).toEqual([64, 64, 12, 64 * 64 * 4]);
    // not blank: the flame is there
    expect(torch.rgba.some((v, i) => i % 4 === 0 && v > 128)).toBe(true);
  });

  test('the lit torches put an effect with their model, the unlit ones none (same model)', () => {
    const mo = s.table('MapObject');
    // gimk_09_lamp_09: 520 lit (fx_bg_f_torch), 530 unlit; obj_torch_1: 521 lit (fx_bg_bonfire), 531 unlit
    expect(lanaiObjectEffect(mo, 520)?.effect).toBe(0x23);
    expect(lanaiObjectEffect(mo, 530)).toBeNull();
    expect(lanaiObjectEffect(mo, 520)).toEqual({ effect: 0x23, offset: [0, 0, 0], lift: 0 });
    expect(lanaiObjectEffect(mo, 521)).toEqual({ effect: 0x24, offset: [-50, 70, -43], lift: 0 });
    expect(lanaiObjectEffect(mo, 531)).toBeNull();
    expect(mo!.u32(520, 0)).toBe(mo!.u32(530, 0));
    expect(mo!.u32(520, 4)).toBe(mo!.u32(530, 4));
  });
});
