// Message list: the signs, characters and doors of every dungeon with their messages (editable), the maps
// that place them, and any message by ID.
import { clear, h } from '../editor/dom';
import { hexId, MESSAGE_HELP, messageEditor } from '../editor/message';
import type { MapInfo } from '../game/codebin';
import { kindName } from '../game/eventkinds';
import type { EventTable } from '../game/events';
import type { Game } from '../game/game';
import { userKey, usersById, messageUsers, type MessageUser } from '../game/messages';
import { mapShortTitle } from '../game/names';
import type { MapDoc } from '../game/sections';

const KIND_FILTER: Record<string, (k: number) => boolean> = {
  all: () => true,
  talk: (k) => k >= 0x01 && k <= 0x0a,
  sign: (k) => k === 0x1f,
  door: (k) => k === 0x14 || k === 0x15,
  other: (k) => k === 0x21,
};

/** Which of the four lines of a conversation (kinds 0x07-0x09) is said: not decoded yet. */
const TALK_SLOTS = ['+0x08', '+0x0C', '+0x10', '+0x14'];

export class MessagePage {
  readonly el = h('div', { class: 'book' });
  private readonly list = h('div', { class: 'book-list' });
  private readonly detail = h('div', { class: 'book-detail' });
  private readonly search = h('input', { type: 'search', placeholder: '本文・マップ名・ID で検索' });
  private readonly filter = h('select', {});
  private users: MessageUser[] = [];
  private byId = new Map<number, MessageUser[]>();
  /** "dungeon.row" of an event row, or "id:N" for a single message. */
  private selected = '';

  constructor(
    private readonly game: Game,
    private readonly docOf: (m: MapInfo) => MapDoc,
    private readonly events: (d: number) => Promise<EventTable | null>,
    /** Wraps an edit (undo point + save). */
    private readonly apply: (f: () => void) => void,
  ) {
    this.filter.append(
      h('option', { value: 'all' }, 'すべて'),
      h('option', { value: 'talk' }, 'キャラクター (会話・一言)'),
      h('option', { value: 'sign' }, '看板・調べるもの'),
      h('option', { value: 'door' }, '扉'),
      h('option', { value: 'other' }, 'ワールドマップ用'),
      h('option', { value: 'edited' }, '変更したもの'),
      h('option', { value: 'shared' }, 'ほかの行と同じメッセージを使う'),
    );
    this.search.addEventListener('input', () => this.renderList());
    this.filter.addEventListener('change', () => this.renderList());
    const idInput = h('input', { type: 'text', placeholder: 'ID (10 進 / 0x…)', size: 12 });
    const openId = (): void => {
      const v = idInput.value.trim();
      const id = /^0x/i.test(v) ? parseInt(v, 16) : Number(v);
      if (Number.isInteger(id) && id >= 0) location.hash = `#/messages/${hexId(id)}`;
    };
    idInput.addEventListener('keydown', (e) => e.key === 'Enter' && openId());
    this.el.append(
      h('div', { class: 'book-side' },
        h('div', { class: 'row' }, this.search, this.filter),
        h('div', { class: 'row' }, idInput, h('button', { onclick: openId }, 'ID で開く')),
        this.list),
      this.detail);
  }

  /** Re-read the event tables (their message IDs may have been edited in the map editor). */
  async load(): Promise<void> {
    this.users = await messageUsers(this.game, this.docOf, this.events);
    this.byId = usersById(this.users);
  }

  async show(arg?: string): Promise<void> {
    await this.load();
    if (arg) this.selected = /^0x/i.test(arg) ? `id:${parseInt(arg, 16)}` : arg;
    if (!this.selected && this.users[0]) this.selected = userKey(this.users[0]);
    this.renderList();
    this.renderDetail();
  }

  private mapNames(u: MessageUser): string[] {
    return [...new Set(u.places.map((p) => mapShortTitle(p.map, this.game.code.maps)))];
  }

  private matches(u: MessageUser): boolean {
    const texts = this.game.master.texts;
    const f = this.filter.value;
    if (f === 'edited' && !u.slots.some((s) => texts.isEdited(s.id))) return false;
    if (f === 'shared' && !u.slots.some((s) => (this.byId.get(s.id)?.length ?? 0) > 1)) return false;
    if (KIND_FILTER[f] && !KIND_FILTER[f](u.kind)) return false;
    const q = this.search.value.trim();
    if (!q) return true;
    const hay = [
      this.game.master.dungeonName(u.dungeon),
      ...this.mapNames(u),
      ...u.places.map((p) => p.map.name),
      ...u.slots.flatMap((s) => [texts.preview(s.id, true) ?? '', hexId(s.id), String(s.id)]),
    ];
    return hay.some((t) => t.includes(q));
  }

  private renderList(): void {
    clear(this.list);
    const rows = this.users.filter((u) => this.matches(u));
    const body = h('tbody');
    const texts = this.game.master.texts;
    for (const u of rows) {
      const key = userKey(u);
      const first = u.slots.find((s) => s.id)?.id ?? 0;
      const edited = u.slots.some((s) => texts.isEdited(s.id));
      body.append(h('tr', { class: key === this.selected ? 'active' : '', onclick: () => (location.hash = `#/messages/${key}`) },
        h('td', { class: 'muted' }, this.game.master.dungeonName(u.dungeon) || `D${u.dungeon}`),
        h('td', { class: 'num muted' }, String(u.row)),
        h('td', { class: 'muted' }, kindName(u.kind)),
        h('td', { class: 'msg-cell' }, edited ? h('b', { class: 'edited' }, '* ') : '', first ? texts.preview(first, true) ?? '' : h('span', { class: 'muted' }, '(なし)'))));
    }
    this.list.append(h('div', { class: 'muted small' }, `${rows.length} / ${this.users.length} 行`),
      h('table', { class: 'book-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'ダンジョン'), h('th', {}, '行'), h('th', {}, '種類'), h('th', {}, 'メッセージ'))), body));
    this.list.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }

  private refresh(): void {
    this.renderList();
    this.renderDetail();
  }

  private editor(id: number): HTMLElement {
    return messageEditor(this.game.master, id, (f) => {
      this.apply(f);
      this.refresh();
    });
  }

  /** Other rows that show the same message. */
  private sharedWith(id: number, self?: MessageUser): HTMLElement | string {
    const others = (this.byId.get(id) ?? []).filter((o) => o !== self);
    if (!others.length) return '';
    return h('div', { class: 'warn-box small' }, `このメッセージはほかの ${others.length} 行でも使われています (書き換えると全部に効きます): `,
      ...others.flatMap((o, i) => [i ? '、' : '', h('a', { href: `#/messages/${userKey(o)}` }, `${this.game.master.dungeonName(o.dungeon) || `D${o.dungeon}`} 行 ${o.row}`)]));
  }

  private renderDetail(): void {
    clear(this.detail);
    const master = this.game.master;
    if (this.selected.startsWith('id:')) {
      const id = Number(this.selected.slice(3));
      this.detail.append(h('div', { class: 'book-head' }, h('h2', {}, `メッセージ ${hexId(id)}`), h('span', { class: 'muted' }, `${id}`)),
        this.editor(id), this.sharedWith(id), h('div', { class: 'muted small' }, MESSAGE_HELP));
      return;
    }
    const u = this.users.find((x) => userKey(x) === this.selected);
    if (!u) return;
    const talk = u.kind >= 0x07 && u.kind <= 0x09;
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, `${master.dungeonName(u.dungeon) || `ダンジョン ${u.dungeon}`} — イベント #${u.row}`),
        h('span', { class: 'muted' }, `${kindName(u.kind)} (種類 0x${u.kind.toString(16).toUpperCase().padStart(2, '0')})、モデル ${u.model}`)),
      h('h3', {}, '置かれている場所'),
      u.places.length
        ? h('ul', {}, ...u.places.map((p) => h('li', {},
            h('a', { href: `#/map/${encodeURIComponent(p.map.name)}` }, mapShortTitle(p.map, this.game.code.maps)),
            ' ', h('span', { class: 'muted' }, `${p.map.name} 区画 ${p.section} (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`))))
        : h('div', { class: 'muted' }, 'どのマップにも置かれていません'),
      h('h3', {}, 'メッセージ'),
      talk ? h('div', { class: 'muted small' }, '会話は 4 つのメッセージを持ちます。どれが表示されるかの条件は調査中です。') : '',
    );
    const seen = new Set<number>();
    u.slots.forEach((s, i) => {
      const label = talk ? `${TALK_SLOTS[i]} (${i + 1} つ目)` : `+0x${s.off.toString(16).toUpperCase().padStart(2, '0')}`;
      const dup = seen.has(s.id);
      seen.add(s.id);
      this.detail.append(h('div', { class: 'msg-slot' },
        h('div', { class: 'msg-slot-head' }, label, dup ? h('span', { class: 'muted' }, ' (上と同じ ID)') : ''),
        dup ? '' : this.editor(s.id),
        dup ? '' : this.sharedWith(s.id, u)));
    });
    this.detail.append(h('div', { class: 'muted small' }, MESSAGE_HELP, ' メッセージ ID を付け替えるときは、マップ編集でこの行を選んでください。'));
  }
}
