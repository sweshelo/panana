// Ported from lanai-custom-stages web/test-fixtures.ts (99304a5); the uwapo there is kept in parallel.
// Synthetic Panana-like data for the tests (no ROM data) and a server on temporary storage.
import { afterEach } from 'bun:test';
import { zipSync } from 'fflate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPananaServer } from '../app';

export const enc = new TextEncoder();
const align = (n: number, a = 16) => (n + a - 1) & ~(a - 1);
export const utf16 = (s: string) => {
  const b = new Uint8Array(s.length * 2 + 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) & 0xff;
    b[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return b;
};

/** A lanai table: rows of `rowSize`, row IDs, and named UTF-16 string fields (strings[row][field]). */
export function table(
  name: string,
  rowSize: number,
  rows: ((row: DataView) => void)[],
  options: { ids?: number[]; fields?: [string, number][]; strings?: Uint8Array[][] } = {},
): Uint8Array {
  const fields = options.fields ?? [];
  const ids = options.ids ?? [];
  // the pool (offsets from 0x40): the table's name, the field names, then the strings on 4 bytes
  const pool: [number, Uint8Array][] = [];
  let poolSize = 0;
  const put = (bytes: Uint8Array, a = 1) => {
    poolSize = align(poolSize, a);
    pool.push([poolSize, bytes]);
    poolSize += bytes.length;
    return poolSize - bytes.length;
  };
  put(enc.encode(`${name}\0`));
  const fieldNameAt = fields.map(([n]) => put(enc.encode(`${n}\0`)));
  const stringAt = (options.strings ?? []).map((row) => row.map((s) => put(s, 4)));
  const data = align(0x40 + poolSize);
  const idsAt = ids.length ? align(data + rows.length * rowSize) : 0;
  const schemaAt = fields.length ? align((idsAt || data + rows.length * rowSize) + ids.length * 4) : 0;
  const relocAt = align(
    (schemaAt || idsAt || data + rows.length * rowSize) + (schemaAt ? fields.length * 8 : ids.length * 4),
  );
  // relocations: the string fields of the rows that have strings, then the field names
  const relocs = [
    ...(options.strings ?? []).flatMap((row, r) => row.map((_, k) => data + r * rowSize + fields[k]![1])),
    ...fields.map((_, i) => schemaAt + i * 8),
  ];
  const end = relocAt + align(relocs.length * 4);
  const b = new Uint8Array(end);
  const v = new DataView(b.buffer);
  v.setUint32(0, rows.length, true);
  v.setUint32(4, rowSize, true);
  v.setUint32(8, 0x40, true);
  v.setUint32(0x0c, poolSize, true);
  v.setUint32(0x10, data, true);
  v.setUint32(0x14, rows.length * rowSize, true);
  if (idsAt) {
    v.setUint32(0x18, idsAt, true);
    v.setUint32(0x1c, ids.length * 4, true);
    ids.forEach((id, i) => v.setUint32(idsAt + i * 4, id, true));
  }
  if (schemaAt) {
    v.setUint32(0x20, schemaAt, true);
    v.setUint32(0x24, fields.length * 8, true);
    fields.forEach(([, off], i) => {
      v.setUint32(schemaAt + i * 8, 0x40 + fieldNameAt[i]!, true);
      v.setUint32(schemaAt + i * 8 + 4, off, true);
    });
  }
  v.setUint32(0x28, relocAt, true);
  v.setUint32(0x2c, relocs.length, true);
  relocs.forEach((o, i) => v.setUint32(relocAt + i * 4, o, true));
  v.setUint32(0x38, name.length + 1, true);
  for (const [at, bytes] of pool) b.set(bytes, 0x40 + at);
  rows.forEach((f, r) => {
    const row = new DataView(b.buffer, data + r * rowSize, rowSize);
    f(row);
    fields.forEach(([, off], k) => {
      const s = stringAt[r]?.[k];
      if (s !== undefined) row.setUint32(off, 0x40 + s, true);
    });
  });
  return b;
}

/** LZ10 with literals only. */
function lz10(body: Uint8Array): Uint8Array {
  const out = [0x10, body.length & 0xff, (body.length >> 8) & 0xff, (body.length >> 16) & 0xff];
  for (let i = 0; i < body.length; i += 8) out.push(0, ...body.subarray(i, i + 8));
  return new Uint8Array(out);
}

/** A version-10 archive of [hash, type, comp, body] entries. */
export function archive(hash: number, entries: [number, number, number, Uint8Array][]): Uint8Array {
  const head = 0x18 + entries.length * 28;
  const blobs = entries.map(([, , comp, body]) =>
    comp === 1 ? zipSync({ 'contents0127.cro': body }) : comp === 6 ? lz10(body) : body,
  );
  const total = blobs.reduce((n, b) => align(n) + b.length, head);
  const b = new Uint8Array(align(total));
  const v = new DataView(b.buffer);
  v.setUint32(0, 10, true);
  v.setUint32(4, hash, true);
  v.setUint32(0x10, entries.length, true);
  let o = head;
  entries.forEach(([h, type, comp], i) => {
    o = align(o);
    const e = 0x18 + i * 28;
    v.setUint32(e, h, true);
    v.setUint32(e + 4, type, true);
    v.setUint32(e + 8, blobs[i]!.length, true);
    v.setUint32(e + 12, o, true);
    v.setUint32(e + 16, comp, true);
    v.setUint32(e + 20, 1, true);
    v.setUint32(e + 24, entries[i]![3].length, true);
    b.set(blobs[i]!, o);
    o += blobs[i]!.length;
  });
  return b;
}

// ruby: 0x38 parent 0x39 reading 0x3A
export const ruby = (s: string) => {
  const t = (code: number) => [1, code, 0];
  const units = [
    ...t(0x38),
    ...[...'島'].map((c) => c.charCodeAt(0)),
    ...t(0x39),
    ...[...'しま'].map((c) => c.charCodeAt(0)),
    ...t(0x3a),
  ];
  const head = new Uint8Array(new Uint16Array(units).buffer);
  const tail = utf16(s);
  const b = new Uint8Array(head.length + tail.length);
  b.set(head);
  b.set(tail, head.length);
  return b;
};

export function stagePackage(options: {
  name: string;
  crr?: boolean;
  patchList?: boolean;
  ips?: boolean;
  slot?: number;
  /** false: no condition script (kind 0x72) on the stage */
  script?: boolean;
  /** false: the master as the ROM has it (without the stage's rows), for a baseline */
  added?: boolean;
  /** enable / disable condition of the master list row (MapStageIntegration +0x1C/+0x20/+0x24, +0x28/+0x2C/+0x30) */
  enable?: [kind: number, v1: number, v2: number];
  disable?: [kind: number, v1: number, v2: number];
  /** lanai-stage.json with this stageKey for content 127 */
  stageKey?: string;
}) {
  const n = options.added === false ? 0 : 1;
  const content = 127,
    hash = 0xf0000000,
    messageId = 0x800000a6,
    slot = options.slot ?? 52;
  const stageRow = (r: DataView, base: number) => {
    r.setUint32(0x0c, messageId, true);
    r.setUint32(0x1c, 1, true);
    if (options.script !== false) r.setUint8(0x24, 0x72);
    r.setUint16(base, slot, true);
    r.setUint16(base + 4, content, true);
  };
  const contentArchive = archive(hash, [
    [
      0x1dd25800,
      12,
      0,
      table(
        'ContentsDef',
        4,
        [content, content, 0xd32e7400, 1].map((x) => (r) => r.setUint32(0, x, true)),
      ),
    ],
    [
      0x3e6ec400,
      12,
      6,
      table('MapStage', 0x40, [
        (r) => {
          stageRow(r, 0x34);
          r.setUint8(0x3d, 3);
        },
      ]),
    ],
    [0xd32e7400, 1, 1, enc.encode('CRO0 test module')],
  ]);
  const contents = table(
    'Contents',
    8,
    Array.from({ length: content + n }, (_, i) => (r: DataView) => {
      r.setUint32(0, i === content ? hash : 0x5e000000 + i * 0x10000, true);
      r.setUint32(4, 0xd2490c00, true);
    }),
  );
  const integration = table(
    'MapStageIntegration',
    0x4c,
    [
      (r: DataView) => {
        stageRow(r, 0x40);
        r.setUint32(0x34, content, true);
        r.setUint32(0x38, hash, true);
        for (const [c, at] of [
          [options.enable, 0x1c],
          [options.disable, 0x28],
        ] as const)
          if (c) {
            r.setUint32(at, c[1], true);
            r.setUint32(at + 4, c[2], true);
            r.setUint8(at + 8, c[0]);
          }
      },
    ].slice(0, n),
    { ids: [0x80000085].slice(0, n) },
  );
  const messages = table('MessageMapStage', 0x14, [() => {}].slice(0, n), {
    ids: [messageId].slice(0, n),
    fields: [
      ['stage_name', 4],
      ['stage_mission', 0x0c],
    ],
    strings: [[ruby(options.name), utf16('たからを探そう')]].slice(0, n),
  });
  const master = archive(0x2135000a, [
    [0x2d8fcc00, 1, 0, contents],
    [0x9aa8d000, 1, 6, integration],
    [0xd3422400, 1, 6, messages],
  ]);
  if (!n) return master;
  const files: Record<string, Uint8Array> = {
    '0004000000125D00/romfs/F0000000': contentArchive,
    '0004000000125D00/romfs/2135000A': master,
  };
  if (options.crr !== false) files['0004000000125D00/romfs/.crr/contents0127.crr'] = enc.encode('CRR0');
  if (options.stageKey)
    files['0004000000125D00/lanai-stage.json'] = enc.encode(
      JSON.stringify({ format: 1, stages: { '127': { stageKey: options.stageKey } } }),
    );
  if (options.patchList !== false)
    files['0004000000125D00/romfs/patchList.bin'] = new Uint8Array([2, 0, 0, 0, 0x0a, 0, 0x35, 0x21, 0, 0, 0, 0xf0]);
  if (options.ips !== false)
    files['0004000000125D00/exefs/code.ips'] = new Uint8Array([
      ...enc.encode('PATCH'),
      0x1f,
      0xcd,
      0x38,
      0,
      4,
      1,
      2,
      3,
      4,
      ...enc.encode('EOF'),
    ]);
  return zipSync(files, { level: 0 });
}

// ---- server with temporary storage

const resources: { server: Awaited<ReturnType<typeof createPananaServer>>; directory: string }[] = [];
afterEach(async () => {
  for (const { server, directory } of resources.splice(0)) {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

/** Panana's server on a temporary data folder (its packages/ and published/ are the uwapo folders of the tests). */
export async function setup(options: { patch?: Uint8Array; patchInfo?: unknown } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lanai-packages-'));
  const packagesDir = join(directory, 'packages');
  const baselinePath = join(directory, 'master-baseline.json');
  const publishedDir = join(directory, 'published');
  const patchPath = options.patch ? join(directory, 'lanai-cs.ips') : null;
  if (patchPath) await Bun.write(patchPath, options.patch!);
  const patchInfoPath = options.patchInfo !== undefined ? join(directory, 'lanai-cs.json') : null;
  if (patchInfoPath) await Bun.write(patchInfoPath, JSON.stringify(options.patchInfo));
  const server = await createPananaServer({
    dataDir: directory,
    assets: () => null,
    uiPort: 0,
    baselinePath,
    patchPath,
    patchInfoPath,
    distributionHostname: '127.0.0.1',
  });
  resources.push({ server, directory });
  const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.ui.port}${path}`, init);
  const upload = (zip: Uint8Array, name = 'mod.zip') =>
    request(`/api/packages?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip as Uint8Array<ArrayBuffer>,
    });
  return { directory, packagesDir, baselinePath, publishedDir, request, upload, server };
}
