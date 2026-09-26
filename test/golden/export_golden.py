"""Export golden data from the Python reference implementation (elpulse/tools) for the TypeScript tests.

    python test/golden/export_golden.py [ELPULSE_ROOT]      -> test/golden/golden.json

Needs the extracted dump of the elpulse repository (extracted/exefs/code.bin, extracted/romfs,
extracted/romfs_unpacked). The JSON is derived from ROM data, so it is git-ignored.
"""
import glob, hashlib, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('ELPULSE_ROOT', os.path.join(HERE, '..', '..', '..', 'elpulse'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
os.chdir(ROOT)
import gsarc, gstable, mapdump  # noqa: E402

db, names = mapdump.load_db(), mapdump.map_names()
maps = []
for h, secs in mapdump.maps():
    name, gid, floor = names.get(h, ('?', -1, 0))
    maps.append({'hash': h, 'name': name, 'dungeon': gid, 'floor': floor, 'sections': secs,
                 'sizes': [len(db.get(s, b'')) for s in secs]})


def points(name):
    h = [k for k, (n, _, _) in names.items() if n == name][0]
    secs = dict(mapdump.maps())[h]
    return {
        'tiles': [list(t) for t in mapdump.tiles(db[secs[0]])],
        'placements': [{'section': k, 'ident': ident, 'x': x, 'y': y, 'raw': raw.hex()}
                       for k, ident, x, y, raw in mapdump.placements(db, secs)],
    }


arc_path = os.path.join('extracted', 'romfs', 'A90C8038')
arc = open(arc_path, 'rb').read()
_, _, ents = gsarc.parse(arc)
dbbytes = open(glob.glob(os.path.join('extracted', 'romfs_unpacked', 'A90C8038', '0002_*'))[0], 'rb').read()


def table(n):
    return gstable.Table(open(glob.glob(os.path.join('extracted', 'romfs_unpacked', '56562135', '*_%s.bin' % n))[0], 'rb').read())


mp = table('mapParts')
out = {
    'maps': maps,
    'D01B02001': points('D01B02001'),
    'D02B02002': points('D02B02002'),
    'archive': {'sha1': hashlib.sha1(arc).hexdigest(),
                'entries': [{k: e[k] for k in ('hash', 'type', 'size', 'comp', 'raw')} for e in ents]},
    'mapdb': {'sha1': hashlib.sha1(dbbytes).hexdigest(), 'count': struct.unpack_from('<I', dbbytes, 0)[0],
              'lz10_sha1': hashlib.sha1(gsarc.lz10_compress(dbbytes)).hexdigest()},
    'mapParts': {'rows': mp.rows, 'rowsize': mp.rowsize,
                 'tileset0': [[struct.unpack_from('<I', mp.row(k + 1), 8 + l * 4)[0] for l in range(8)] for k in range(15)]},
    'code_sha1': hashlib.sha1(open(os.path.join('extracted', 'exefs', 'code.bin'), 'rb').read()).hexdigest(),
}
json.dump(out, open(os.path.join(HERE, 'golden.json'), 'w'), indent=1)
print('wrote', os.path.join(HERE, 'golden.json'))
