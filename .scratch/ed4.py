def rep(s,a,b):
    assert a in s, a[:70]
    return s.replace(a,b)
p='src/editor/view3d.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""import { loadObjectModels, objKey } from '../cgfx/loader';
""","""import { loadComposite, loadObjectModels, objKey } from '../cgfx/loader';
import { fixGroup, KIND_BOSS, readStages } from '../game/boss';
import { MONSTER_MODEL_ARCHIVE } from '../game/monsters';
import type { EventTable } from '../game/events';
""")
s=rep(s,"""  private syncMarkers(doc: MapDoc): void {""","""  /** Idle-posed monster models of boss ranges by monster row (a template to clone; null = none / loading). */
  private readonly bossModels = new Map<number, THREE.Object3D | null>();
  private readonly bossRequest = new Set<number>();

  /** Monster fought first in a boss range (EventObject kind 0x31), or 0. */
  private bossMonster(events: EventTable | null, section: number, raw: Uint8Array): number {
    if (section !== 8 || !events) return 0;
    const row = raw[0]! | (raw[1]! << 8) | (raw[2]! << 16) | (raw[3]! << 24);
    if (!events.has(row) || events.kind(row) !== KIND_BOSS) return 0;
    const first = readStages(events.table.row(row))[0];
    return (first && fixGroup(this.st.game.master, first.fix)?.slots[0]?.monster) || 0;
  }

  private bossModel(monster: number): THREE.Object3D | null {
    if (!this.bossModels.has(monster)) {
      this.bossRequest.add(monster);
      return null;
    }
    return this.bossModels.get(monster)?.clone() ?? null;
  }

  /**
   * Load the monster models asked for by the last sync: the idle motion ("001_", the museum's 0x41) at its first
   * frame, scaled to about a cell (the game shows nothing in the range; this is where the battle happens).
   */
  private loadRequestedBosses(): void {
    const todo = [...this.bossRequest].filter((m) => !this.bossModels.has(m));
    this.bossRequest.clear();
    if (!todo.length) return;
    for (const m of todo) this.bossModels.set(m, null);
    const game = this.st.game;
    game.monsters().then((book) =>
      Promise.all(todo.map(async (row) => {
        const mon = book.monster(row);
        const ref = mon ? book.modelOf(mon) : null;
        if (!ref) return;
        const set = await loadComposite(game, MONSTER_MODEL_ARCHIVE, ref.model, ref.texture);
        const f = new ModelFactory(set);
        if (!set.models.has(ref.model)) return;
        const m = new AnimatedModel(f, ref.model);
        const idle = m.motions.find((a) => animationKey(a.name) === '001_');
        if (idle) m.select(idle.name);
        const box = new THREE.Box3().setFromObject(m.group);
        const size = box.getSize(new THREE.Vector3());
        const scale = size.y > 0 ? BOSS_HEIGHT / Math.max(size.y, size.x * 0.6, size.z * 0.6) : 1;
        m.group.scale.setScalar(scale);
        m.group.position.y = -box.min.y * scale;
        this.bossModels.set(row, new THREE.Group().add(m.group));
      })),
    ).then(() => this.syncSelection(), (err) => console.warn('boss models', err));
  }

  private syncMarkers(doc: MapDoc): void {""")
s=rep(s,"""        const row = ctx ? recordObjectRow(k, r, ctx) : 0;
        const model = row && row !== OBJ_INVISIBLE ? this.objectModel(row) : null;""","""        const row = ctx ? recordObjectRow(k, r, ctx) : 0;
        const boss = ctx ? this.bossMonster(events, k, r.raw) : 0;
        const model = boss ? this.bossModel(boss) : row && row !== OBJ_INVISIBLE ? this.objectModel(row) : null;""")
s=rep(s,"""    this.loadRequestedObjects();
  }""","""    this.loadRequestedObjects();
    this.loadRequestedBosses();
  }""")
s=rep(s,"""const MARKER_Y = 40;
""","""const MARKER_Y = 40;
/** Height of the monster shown in a boss range (a cell is 500). */
const BOSS_HEIGHT = 420;
""")
open(p,'w',encoding='utf-8').write(s)
