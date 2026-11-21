// Field characters' BCH motions and the AnimData IDs used by ScriptChara/ScriptPlayer::StartAnimation.
import { findEntry, entryBlob, unpackEntry } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import { bchAnimations, parseBch, unwrapBch } from '../bch/bch';
import type { CgfxModel, CgfxTexture } from '../cgfx/cgfx';
import type { CgfxAnimation } from '../cgfx/anim';
import type { TilesetModels } from '../cgfx/tileset';
import { attach, faceMaterials, type DenpaAppearance } from '../oahu/denpaModels';
import type { ModelRef } from '../pages/modelview';
import { f32, hex8, u16, u32 } from '../util/bytes';
import { lanaiObjectModels } from './mapModels';
import { lanaiObjectRef } from './mapObjects';
import type { LanaiSession } from './session';

export interface LanaiNpcModel {
  row: number;
  name: string;
}

const npcLists = new WeakMap<LanaiSession, { revision: number; promise: Promise<LanaiNpcModel[]> }>();
const sessionIds = new WeakMap<LanaiSession, number>();
let nextSessionId = 1;
function sessionKey(session: LanaiSession): string {
  let id = sessionIds.get(session);
  if (!id) sessionIds.set(session, (id = nextSessionId++));
  return `${id}/${session.revision}`;
}

/** MapObject rows whose BCH file is an NPC; the ZIP names are read without inflating the models. */
export function lanaiNpcModels(session: LanaiSession): Promise<LanaiNpcModel[]> {
  let cached = npcLists.get(session);
  if (!cached || cached.revision !== session.revision) {
    const promise = (async () => {
      const objects = session.need('MapObject');
      const rows: LanaiNpcModel[] = [];
      for (let row = 1; row < objects.rows; row++) {
        const ref = lanaiObjectRef(objects, row);
        if (!ref) continue;
        const arc = await session.archive(hex8(ref.archive));
        const entry = findEntry(arc, ref.entry);
        const name = entry ? zipEntryName(entryBlob(arc, entry)) : null;
        if (name?.startsWith('npc_') && name.endsWith('.bch')) rows.push({ row, name: name.slice(0, -4) });
      }
      return rows;
    })();
    cached = { revision: session.revision, promise };
    npcLists.set(session, cached);
    promise.catch(() => {
      if (npcLists.get(session)?.promise === promise) npcLists.delete(session);
    });
  }
  return cached.promise;
}

export function lanaiNpcModel(session: LanaiSession, row: number): ModelRef | null {
  const ref = lanaiObjectRef(session.table('MapObject'), row);
  return ref
    ? {
        key: `lanai-npc/${sessionKey(session)}/${hex8(ref.archive)}/${hex8(ref.entry)}`,
        load: async () => ({ set: await lanaiObjectModels(session, ref), hash: ref.entry }),
      }
    : null;
}

export interface LanaiAnimationId {
  id: number;
  prefix: string;
  blend: number;
  defaultType: number;
}

/** AnimData +0x00 gives the BCH motion-name prefix; the row ID is StartAnimation's first argument. */
export function lanaiAnimationIds(session: LanaiSession): LanaiAnimationId[] {
  const table = session.need('AnimData');
  const view = new DataView(table.data.buffer, table.data.byteOffset);
  return Array.from({ length: table.rows }, (_, row) => {
    let prefix = '';
    for (let p = table.u32(row, 0); p > 0 && p < table.data.length && table.data[p] && prefix.length < 32; p++)
      prefix += String.fromCharCode(table.data[p]!);
    return {
      id: table.rowId(row),
      prefix,
      blend: view.getFloat32(table.at(row, 4), true),
      defaultType: table.u8(row, 8),
    };
  });
}

/** Match the AnimData prefix to a playable skeletal motion, or a material-only animation. */
export function lanaiAnimationName(animations: readonly CgfxAnimation[], prefix: string): string | null {
  const key = (name: string): boolean => name.slice(0, 4) === prefix;
  return (
    animations.find((a) => a.kind === 'skeletal' && a.skeletal.length && key(a.name))?.name ??
    animations.find((a) => a.kind === 'material' && a.material.length && key(a.name))?.name ??
    null
  );
}

async function bch(session: LanaiSession, archive: string, hash: number) {
  const arc = await session.archive(archive);
  const entry = findEntry(arc, hash);
  if (!entry) throw new Error(`${archive}/${hex8(hash)} がありません`);
  return parseBch(unwrapBch(unpackEntry(arc, entry).body));
}

async function motionBch(session: LanaiSession, hash: number) {
  const arc = await session.archive('F48B0000');
  const entry = findEntry(arc, hash);
  if (!entry) throw new Error(`F48B0000/${hex8(hash)} がありません`);
  return bchAnimations(unwrapBch(unpackEntry(arc, entry).body));
}

/**
 * What a Denpa person looks like, as DenpaCustom (master, 209 × 0x50) gives it (Update v17408: 0x2DE3A4..0x2DE444,
 * analysed by Codex 2026-11-21). The face parts are zero-based like RPG3's (oahu/denpaModels.ts DenpaAppearance).
 */
export interface LanaiDenpaLook {
  appearance: DenpaAppearance;
  /** HeadData row (+0x41 − 1). */
  headRow: number;
  /** BodyData row (+0x43 − 1): the body's scale / height / width. */
  bodyRow: number;
  /** BodyPattern row (+0x0C): the body's texture. */
  pattern: number;
  /** ColorData rows of the body's main and second colours, as the game resolves them (-1: the model's own). */
  colors: [number, number];
  /** SkillData row whose antenna is on the head (-1: none drawn). */
  antennaSkill: number;
}

/**
 * The body's pattern and colours as the field resolves DenpaCustom +0x0C / +0x10 / +0x14 (0x2DABBC〜0x2DAC10, 0x2D3C8C;
 * Codex 2026-11-21): the same two colours drop the pattern; with a pattern a second colour 0 / 2 is 3 (black), without
 * one a second colour 2 is 0; a second colour 0 is the main one.
 */
export function lanaiDenpaColors(
  pattern: number,
  main: number,
  sub: number,
): { pattern: number; colors: [number, number] } {
  if (main === sub) pattern = 0;
  if (pattern && (sub === 0 || sub === 2)) sub = 3;
  else if (!pattern && sub === 2) sub = 0;
  return { pattern, colors: [main, sub > 0 ? sub : main] };
}

/** SkillData row 0 (アンテナなし, AntennaGroup 0) and 1 (アンテナのねっこ, below the first level of a group). */
const SKILL_NONE = 0,
  SKILL_ROOT = 1;

/**
 * The antenna a Denpa person of `level` shows (0x2B69CC〜0x2B6A3C): the levels of AntennaGroup +0x22 (u16 × 6) are
 * compared in order and the skill (+0x04 + 4k) of the last one reached is taken; none reached is the root, group 0 none.
 */
export function lanaiAntennaSkill(session: LanaiSession, group: number, level: number): number {
  const ag = session.need('AntennaGroup'),
    sk = session.need('SkillData');
  if (group <= 0 || group >= ag.rows) return SKILL_NONE;
  let reached = 0;
  while (reached < 6 && level >= ag.u16(group, 0x22 + 2 * reached)) reached++;
  if (!reached) return SKILL_ROOT;
  const row = sk.find(ag.u32(group, 4 * reached));
  return row >= 0 ? row : SKILL_NONE;
}

/** The look of the sample (and of the hero in the preview): row 0 of every table and the model's own colours. */
const SAMPLE_LOOK: LanaiDenpaLook = {
  appearance: {
    antennaGroup: 0,
    level: 1,
    bodyColor: 0,
    head: 0,
    body: 0,
    hair: 0,
    face: 0,
    skinColor: 0,
    hairColor: 0,
    brow: 0,
    eye: 0,
    nose: 0,
    mouth: 0,
    cheek: 0,
    glasses: 0,
  },
  headRow: 0,
  bodyRow: 0,
  pattern: 0,
  colors: [-1, -1],
  antennaSkill: -1,
};

/**
 * A DenpaCustom row's look: +0x0C / +0x10 / +0x14 the pattern and the two colours (row IDs), +0x38 the level, +0x3A the
 * AntennaGroup row, +0x41 the head, +0x43 the body (BodyData), +0x44 the face, +0x45 the hair (zero-based), +0x46 /
 * +0x47 the skin and hair colours, +0x48〜+0x4C brow / eye / nose / mouth / cheek (one-based but the hair). No glasses.
 */
export function lanaiDenpaCustomLook(session: LanaiSession, row: number): LanaiDenpaLook {
  const t = session.need('DenpaCustom');
  const r = t.row(row >= 0 && row < t.rows ? row : 0);
  const one = (o: number): number => Math.max(0, r[o]! - 1);
  const find = (table: string, o: number): number => session.need(table).find(u32(r, o));
  const body = lanaiDenpaColors(
    Math.max(0, find('BodyPattern', 0x0c)),
    find('ColorData', 0x10),
    find('ColorData', 0x14),
  );
  // a level of 0 or below is taken at run time (the save); the preview shows the first level
  const level = Math.min(999, Math.max(1, (u16(r, 0x38) << 16) >> 16));
  return {
    appearance: {
      antennaGroup: u16(r, 0x3a),
      level,
      bodyColor: 0,
      head: one(0x41),
      body: one(0x43),
      face: one(0x44),
      hair: r[0x45]!,
      skinColor: one(0x46),
      hairColor: one(0x47),
      brow: one(0x48),
      eye: one(0x49),
      nose: one(0x4a),
      mouth: one(0x4b),
      cheek: one(0x4c),
      glasses: 0,
    },
    headRow: one(0x41),
    bodyRow: one(0x43),
    ...body,
    antennaSkill: lanaiAntennaSkill(session, u16(r, 0x3a), level),
  };
}

/** A ColorData row's RGB (+0x06〜+0x08) as an RGBA constant, null when the row is not there. */
function colorOf(session: LanaiSession, row: number): number[] | null {
  const t = session.need('ColorData');
  if (row < 0 || row >= t.rows) return null;
  const r = t.row(row);
  return [r[6]! / 255, r[7]! / 255, r[8]! / 255, 1];
}

/**
 * The textures named antenna_01 by AntennaModel +0x00 & 3 (0x49B070): 75F22000 the icon atlas (ETC1A4; the models
 * 0x340 that take an icon), 33945C00 the sheet of the models with their own look (ETC1, no alpha; 0x341). SkillData
 * +0x10 & 3 does not pick it (an earlier reading): it is 1 on 173 of the 190 skills with an icon, and the sheet has no
 * icons, so those antennas showed another skill's picture on an opaque cell.
 */
const ANTENNA_ATLASES = [0x75f22000, 0x33945c00, 0x75f22000, 0x75f22000];

/** The texture (a master entry) the antenna of SkillData row `skill` takes. */
export function lanaiAntennaAtlas(session: LanaiSession, skill: number): number {
  const am = session.need('AntennaModel');
  return ANTENNA_ATLASES[am.u32(Math.min(session.need('SkillData').u8(skill, 0x15), am.rows - 1), 0) & 3]!;
}
/** The antenna's scale by SkillData +0x10 bits 2..5 (0x2CF780); 5 and above are 1. */
const ANTENNA_SCALES = [0.8, 1, 1.2, 1.4, 1.6];

/**
 * The antenna of SkillData row `skill` (0x19055C, 0x190144, 0x190654, 0x2CF7D8; Codex 2026-11-21): the BCH of
 * AntennaModel +0x15 (rows past 133 are 133) in E50D0000, its texture (lanaiAntennaAtlas) and the icon (+0x11 & 0x3F, one-based; 8 × 8
 * cells numbered down each column) on material 0, and the scale.
 */
async function antennaPart(
  session: LanaiSession,
  skill: number,
): Promise<{ model: CgfxModel; textures: CgfxTexture[]; scale: number } | null> {
  const sk = session.need('SkillData'),
    am = session.need('AntennaModel');
  if (skill < 0 || skill >= sk.rows) return null;
  const s = sk.row(skill);
  const raw = s[0x15]!,
    modelRow = Math.min(raw, am.rows - 1);
  const icon = s[0x11]! & 0x3f;
  const atlas = lanaiAntennaAtlas(session, skill);
  const [file, atlasFile] = await Promise.all([
    bch(session, 'E50D0000', am.u32(modelRow, 4)),
    bch(session, '2135000A', atlas),
  ]);
  const model = file.models[0];
  if (!model) return null;
  const materials = model.materials.map((m, i) => {
    if (i !== 0 || !icon) return m;
    const n = icon - 1;
    const translateU = -Math.floor(n / 8) / 8,
      translateV = (n % 8) / 8;
    return {
      ...m,
      units: m.units.map((u, j) => (j === 0 ? { ...u, translateU, translateV } : u)),
      uv: { ...m.uv, translateU, translateV },
    };
  });
  return {
    model: { ...model, materials },
    textures: [...file.textures, ...atlasFile.textures],
    scale: ANTENNA_SCALES[(s[0x10]! >> 2) & 15] ?? 1,
  };
}

/**
 * A Denpa person from ROM parts as the field builds it (0x1B62B8〜): hum_body_01 of F0F40000 (sized by BodyData) with
 * the BodyPattern texture and the colours on its constants 0 (main) / 1 (second) / 2 (black) (0x26CC2C), the HeadData
 * head, hum_N_face_01 with the face atlas and the antenna on the head's ante bone. Not shown: the equipment.
 */
async function denpaSet(session: LanaiSession, look: LanaiDenpaLook, name: string): Promise<TilesetModels> {
  const heads = session.need('HeadData');
  const headRow = look.headRow >= 0 && look.headRow < heads.rows && heads.u32(look.headRow, 4) ? look.headRow : 0;
  const patterns = session.need('BodyPattern');
  const pattern = look.pattern < patterns.rows ? patterns.u32(look.pattern, 0) : 0;
  const [bodyFile, headFile, faceFile, faceTex, bodyTex, motionFiles, antenna] = await Promise.all([
    bch(session, 'F0F40000', 0x679f6c00), // hum_body_01 (the field's; 96EB0000 has another constant assignment)
    bch(session, hex8(heads.u32(headRow, 0)), heads.u32(headRow, 4)), // hum_head_NN
    bch(session, '96EB0000', 0xa038b800), // hum_N_face_01
    bch(session, '96EB0000', 0xb8b2e800), // hum_N_face_tex
    bch(session, '2135000A', pattern || 0x63829400), // body_ptn_NN (its texture is hum_base)
    Promise.all([0x6f8f7000, 0x1ed24400, 0xdf937000, 0x6ce89400].map((id) => motionBch(session, id))),
    antennaPart(session, look.antennaSkill),
  ]);
  const body = bodyFile.models[0],
    head = headFile.models[0],
    face = faceFile.models[0];
  if (!body || !head || !face) throw new Error('電波人間の体・頭・顔のモデルがありません');
  const sizes = session.need('BodyData');
  const size = sizes.row(look.bodyRow >= 0 && look.bodyRow < sizes.rows ? look.bodyRow : 0);
  const scale = f32(size, 0),
    height = f32(size, 4),
    width = f32(size, 8);
  const animations = motionFiles.flat();
  const seen = new Set<string>();
  const [main, second] = look.colors.map((row) => colorOf(session, row));
  // constants 0 / 1 / 2 = main, second, black; the sample keeps the model's own
  const tint = main ? [main, second ?? main, [0, 0, 0, 1]] : [];
  const model: CgfxModel = {
    name,
    meshes: [],
    materials: [],
    bones: [{ name: 'denpa', parent: -1, scale: [width, height, width], rotation: [0, 0, 0], translation: [0, 0, 0] }],
    animations: animations.filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true))),
  };
  const materials = body.materials.map((m) => ({
    ...m,
    tev:
      m.tev?.map((t, k) => {
        const constant = m.tevConstants?.[k];
        const c = constant === undefined ? null : tint[constant];
        return c ? { ...t, color: c } : t;
      }) ?? null,
  }));
  attach(model, { ...body, materials }, 0);
  body.bones.forEach((bone, index) => {
    model.bones[index + 1]!.name = bone.name;
  });
  const headBone = model.bones.findIndex((bone) => bone.name === 'head');
  if (headBone < 0) throw new Error('体に head ボーンがありません');
  const headOffset = attach(model, head, headBone, [scale / width, scale / height, scale / width]);
  const faceBone = head.bones.findIndex((bone) => bone.name === 'm_Face');
  if (faceBone < 0) throw new Error('頭に m_Face ボーンがありません');
  attach(model, { ...face, materials: faceMaterials(face, look.appearance) }, headOffset + faceBone);
  // the antenna takes its own scale, not the head's (attachment flag 0xB, 0x2B233C)
  const anteBone = head.bones.findIndex((bone) => bone.name === 'ante' || bone.name === 'ante1');
  if (antenna && anteBone >= 0) {
    const s = antenna.scale / scale;
    attach(model, antenna.model, headOffset + anteBone, [s, s, s]);
  }
  const set: TilesetModels = {
    models: new Map([[0, model]]),
    paths: new Map([[0, model.name]]),
    textures: new Map(),
    errors: [],
  };
  for (const texture of [...faceTex.textures, ...bodyTex.textures, ...(antenna?.textures ?? [])])
    set.textures.set(texture.name, texture);
  return set;
}

const denpaSets = new WeakMap<LanaiSession, { revision: number; sets: Map<number, Promise<TilesetModels>> }>();
/** The model of DenpaCustom row `custom` (-1: the sample), read once per session revision. */
function denpaModel(session: LanaiSession, custom: number): ModelRef {
  return {
    key: `lanai-denpa/${sessionKey(session)}/${custom < 0 ? 'sample' : custom}`,
    load: async () => {
      let cached = denpaSets.get(session);
      if (!cached || cached.revision !== session.revision) {
        cached = { revision: session.revision, sets: new Map() };
        denpaSets.set(session, cached);
      }
      const sets = cached.sets;
      let promise = sets.get(custom);
      if (!promise) {
        const name = custom < 0 ? 'denpa/sample' : `denpa/${lanaiDenpaCustomName(session, custom) || custom}`;
        promise = denpaSet(session, custom < 0 ? SAMPLE_LOOK : lanaiDenpaCustomLook(session, custom), name);
        sets.set(custom, promise);
        promise.catch(() => {
          if (sets.get(custom) === promise) sets.delete(custom);
        });
      }
      return { set: await promise, hash: 0 };
    },
  };
}

/** The name of a DenpaCustom row ("かしたろう"), '' when the row is not there. */
export function lanaiDenpaCustomName(session: LanaiSession, row: number): string {
  const t = session.table('DenpaCustom');
  return t && row >= 0 && row < t.rows ? session.plain(t, row, 'name') : '';
}

/** A ROM-only representative Denpa person for inspecting the shared field motions (and the hero in the preview). */
export function lanaiDenpaModel(session: LanaiSession): ModelRef {
  return denpaModel(session, -1);
}

/** A Denpa person of the map (MapChara kind 3): DenpaCustom row `custom`; an invalid row is row 0, as in the game. */
export function lanaiDenpaCustomModel(session: LanaiSession, custom: number): ModelRef {
  const rows = session.need('DenpaCustom').rows;
  return denpaModel(session, custom >= 0 && custom < rows ? custom : 0);
}
