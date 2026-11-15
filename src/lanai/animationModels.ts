// Field characters' BCH motions and the AnimData IDs used by ScriptChara/ScriptPlayer::StartAnimation.
import { findEntry, entryBlob, unpackEntry } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import { bchAnimations, parseBch, unwrapBch } from '../bch/bch';
import type { CgfxModel } from '../cgfx/cgfx';
import type { TilesetModels } from '../cgfx/tileset';
import { attach, faceMaterials, type DenpaAppearance } from '../oahu/denpaModels';
import type { ModelRef } from '../pages/modelview';
import { f32, hex8 } from '../util/bytes';
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

/** A ROM-only representative Denpa person for inspecting the shared field motions. */
async function denpaSet(session: LanaiSession): Promise<TilesetModels> {
  const [bodyFile, headFile, faceFile, faceTex, bodyTex, motionFiles] = await Promise.all([
    bch(session, '96EB0000', 0x679f6c00), // hum_body_01
    bch(session, '15920000', 0x77c60400), // hum_head_01
    bch(session, '96EB0000', 0xa038b800), // hum_N_face_01
    bch(session, '96EB0000', 0xb8b2e800), // hum_N_face_tex
    bch(session, '2135000A', 0x63829400), // body_ptn_01
    Promise.all([0x6f8f7000, 0x1ed24400, 0xdf937000, 0x6ce89400].map((id) => motionBch(session, id))),
  ]);
  const body = bodyFile.models[0],
    head = headFile.models[0],
    face = faceFile.models[0];
  if (!body || !head || !face) throw new Error('電波人間の体・頭・顔のモデルがありません');
  const size = session.need('BodyData').row(0);
  const scale = f32(size, 0),
    height = f32(size, 4),
    width = f32(size, 8);
  const animations = motionFiles.flat();
  const seen = new Set<string>();
  const appearance: DenpaAppearance = {
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
  };
  const model: CgfxModel = {
    name: 'denpa/sample',
    meshes: [],
    materials: [],
    bones: [{ name: 'denpa', parent: -1, scale: [width, height, width], rotation: [0, 0, 0], translation: [0, 0, 0] }],
    animations: animations.filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true))),
  };
  attach(model, body, 0);
  body.bones.forEach((bone, index) => {
    model.bones[index + 1]!.name = bone.name;
  });
  const headBone = model.bones.findIndex((bone) => bone.name === 'head');
  if (headBone < 0) throw new Error('体に head ボーンがありません');
  const headOffset = attach(model, head, headBone, [scale / width, scale / height, scale / width]);
  const faceBone = head.bones.findIndex((bone) => bone.name === 'm_Face');
  if (faceBone < 0) throw new Error('頭に m_Face ボーンがありません');
  attach(model, { ...face, materials: faceMaterials(face, appearance) }, headOffset + faceBone);
  const set: TilesetModels = {
    models: new Map([[0, model]]),
    paths: new Map([[0, model.name]]),
    textures: new Map(),
    errors: [],
  };
  for (const texture of [...faceTex.textures, ...bodyTex.textures]) set.textures.set(texture.name, texture);
  return set;
}

const denpaSets = new WeakMap<LanaiSession, { revision: number; promise: Promise<TilesetModels> }>();
export function lanaiDenpaModel(session: LanaiSession): ModelRef {
  return {
    key: `lanai-denpa/${sessionKey(session)}/sample`,
    load: async () => {
      let cached = denpaSets.get(session);
      if (!cached || cached.revision !== session.revision) {
        const promise = denpaSet(session);
        cached = { revision: session.revision, promise };
        denpaSets.set(session, cached);
        promise.catch(() => {
          if (denpaSets.get(session)?.promise === promise) denpaSets.delete(session);
        });
      }
      return { set: await cached.promise, hash: 0 };
    },
  };
}
