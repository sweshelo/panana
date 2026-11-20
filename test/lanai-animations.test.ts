import { beforeAll, describe, expect, test } from 'bun:test';
import { ModelFactory } from '../src/cgfx/three';
import { AnimatedModel } from '../src/cgfx/player';
import {
  lanaiAnimationIds,
  lanaiAnimationName,
  lanaiDenpaModel,
  lanaiNpcModel,
  lanaiNpcModels,
} from '../src/lanai/animationModels';
import { parseStageScript, scriptRowId } from '../src/lanai/eventScript';
import { lanaiMonsterModel } from '../src/lanai/monsterModels';
import { lanaiMonsterDesign, lanaiMonsters } from '../src/lanai/monsters';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! character animations', () => {
  let session: LanaiSession;
  beforeAll(async () => {
    session = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (file) => (file as File).name),
      { fresh: true },
    );
  });

  test('NPC BCH motions map to the AnimData IDs used by scripts', async () => {
    const npcs = await lanaiNpcModels(session);
    expect(npcs.length).toBeGreaterThan(100);
    const ref = lanaiNpcModel(session, npcs[0]!.row)!;
    const { set, hash } = (await ref.load())!;
    const names = set.models.get(hash)!.animations.map((motion) => motion.name);
    expect(names).toContain('000_NPC01_wait');
    expect(names).toContain('200_NPC01_talk');
    const ids = lanaiAnimationIds(session);
    expect(ids.find((item) => item.id === 0x80000075)?.prefix).toBe('000_');
    expect(ids.find((item) => item.id === 0x80000079)?.prefix).toBe('200_');
  });

  test('the shared Denpa parts form a playable preview model', async () => {
    const { set, hash } = (await lanaiDenpaModel(session).load())!;
    const model = set.models.get(hash)!;
    expect(model.meshes.length).toBeGreaterThan(5);
    expect(model.animations.some((motion) => motion.name === '001_N_Stay')).toBe(true);
    const animated = new AnimatedModel(new ModelFactory(set), hash);
    animated.select('001_N_Stay');
    animated.update(1);
    expect(animated.group.children.length).toBeGreaterThan(0);
    expect(lanaiAnimationIds(session).find((item) => item.id === 0x80000001)?.prefix).toBe('001_');
  });

  test('anim ID 0x80000003 resolves to the motion of monster #1191', async () => {
    const monster = lanaiMonsters(session)[1191]!;
    const design = lanaiMonsterDesign(session, monster.designRow)!;
    const loaded = (await lanaiMonsterModel(session, design)!.load())!;
    const animations = loaded.set.models.get(loaded.hash)!.animations;
    const node = parseStageScript('function demo() { obj(9).StartAnimation(0x80000003, 0, 1, 0) }').functions[0]!
      .body[0]!;
    const arg = node.op === 'call' ? node.call.args[0] : undefined;
    if (arg?.k !== 'i') throw new Error('StartAnimation was not parsed');
    const fullId = scriptRowId(arg.v);
    expect(fullId).toBe(0x80000003);
    const prefix = lanaiAnimationIds(session).find((item) => item.id === fullId)!.prefix;
    expect(lanaiAnimationName(animations, prefix)).toBe('003_E63_walk');
  });
});
