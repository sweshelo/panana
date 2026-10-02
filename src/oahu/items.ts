// The items of 電波人間のRPG3 (itemData.bin of the master, 1191 rows × 0x40): read and written through the field
// definitions of tables.ts, with their name and description messages, the action a tool uses and what an equipment
// gives.
import type { GsTable } from '../archive/gstable';
import type { MessageStore } from '../game/gmsg';
import { field, readField, writeField, type FieldDef } from '../game/tabledef';
import { equalBytes, u32 } from '../util/bytes';
import type { OahuMaster } from './master';
import {
  OAHU_ACTION_DATA,
  OAHU_EFFECT_SUBS,
  OAHU_EQUIP_EFFECTS,
  OAHU_ITEM_CATEGORY,
  OAHU_ITEM_DATA,
  OAHU_ITEM_KIND,
  OAHU_ITEM_TEXTS,
} from './tables';

export const OAHU_ITEM_FILE = OAHU_ITEM_DATA.file;

/** The message fields of a row: the name, then the descriptions. */
export const OAHU_ITEM_MESSAGE_KEYS = ['name', ...OAHU_ITEM_TEXTS.map(([key]) => key)];

/** Keys of the fields the book edits as numbers. */
export type OahuItemNumber = 'price' | 'sell' | 'rarity' | 'limit' | 'action' | 'effect1' | 'effect1Sub' | 'amount1' | 'effect2' | 'effect2Sub' | 'amount2';

export interface OahuEquipEffect {
  /** 1 or 2. */
  slot: number;
  kind: number;
  sub: number;
  value: number;
}

export interface OahuItem {
  id: number;
  name: string;
  /** The name and the descriptions joined (for searching). */
  text: string;
  categoryByte: number;
  /** Main category (low 4 bits). */
  kind: number;
  category: string;
  price: number;
  sell: number;
  rarity: number;
  /** Items one can hold (+0x3F; 0 = 99). */
  limit: number;
  action: number;
  model: number;
  effects: OahuEquipEffect[];
}

const F = (key: string): FieldDef => field(OAHU_ITEM_DATA, key);

/** Deco characters (0x118..0x124, a colored ●) in item names, e.g. the paints. */
const decoText = (s: string): string => s.replace(/[Ę-Ĥ]/g, (c) => `(色${c.charCodeAt(0) - 0x117})`);

export function oahuCategoryLabel(b: number): string {
  return OAHU_ITEM_CATEGORY[b] ?? `${OAHU_ITEM_KIND[b & 0xf] ?? `分類 ${b & 0xf}`} (0x${b.toString(16).toUpperCase().padStart(2, '0')})`;
}

/** "能力アップ: こうげき +20", "経験値増加 120%", "アクション (打撃): #233 どくこうげき". */
export function oahuEffectText(e: OahuEquipEffect, actionName: (row: number) => string = (r) => `#${r}`): string {
  const k = OAHU_EQUIP_EFFECTS[e.kind];
  if (!k) return `効果 0x${e.kind.toString(16).toUpperCase().padStart(2, '0')}${e.sub ? ` (${e.sub})` : ''}: ${e.value}`;
  const target = k.sub ? OAHU_EFFECT_SUBS[k.sub][e.sub] ?? `${e.sub}` : '';
  const head = target ? `${k.label}: ${target}` : k.label;
  switch (k.value) {
    case 'plus': return `${head} ${e.value < 0 ? '' : '+'}${e.value}`;
    case 'percent': return `${head} ${e.value}%`;
    case 'element': return `${head}: ${OAHU_EFFECT_SUBS.element[e.value] ?? e.value}`;
    case 'action': return `${head}: ${actionName(e.value)}`;
    case 'number': return `${head} ${e.value}`;
    case 'flag': return e.value === 1 ? head : `${head} (${e.value})`;
  }
}

export class OahuItems {
  readonly items: OahuItem[] = [];
  private readonly byId = new Map<number, OahuItem>();
  readonly table: GsTable;
  private readonly actions: GsTable;

  constructor(
    private readonly master: OahuMaster,
    readonly texts: MessageStore,
  ) {
    this.table = master.table(OAHU_ITEM_FILE);
    this.actions = master.table(OAHU_ACTION_DATA.file);
    for (let id = 1; id < this.table.rows; id++) this.insert(id);
  }

  /** A message as one line of plain text. */
  message(id: number): string {
    if (!id) return '';
    const u = this.texts.units(id);
    return u ? decoText(this.texts.plain(id) ?? '') : '';
  }

  private row(id: number): Uint8Array {
    return this.table.row(id);
  }

  get(id: number, key: string): number {
    return readField(this.row(id), F(key));
  }

  /** The value of a field as it is in the archive. */
  original(id: number, key: string): number {
    return readField(this.master.originalRow(OAHU_ITEM_FILE, id), F(key));
  }

  private build(id: number): OahuItem | null {
    const r = this.row(id);
    const nameId = readField(r, F('name'));
    if (!nameId) return null;
    const cat = readField(r, F('category'));
    const kind = cat & 0xf;
    const effects: OahuEquipEffect[] = [];
    if (kind === 3) {
      for (const slot of [1, 2]) {
        const k = readField(r, F(`effect${slot}`));
        if (k) effects.push({ slot, kind: k, sub: readField(r, F(`effect${slot}Sub`)), value: readField(r, F(`amount${slot}`)) });
      }
    }
    return {
      id,
      name: this.message(nameId) || `#${id}`,
      text: OAHU_ITEM_MESSAGE_KEYS.map((k) => this.message(readField(r, F(k)))).join(' '),
      categoryByte: cat,
      kind,
      category: oahuCategoryLabel(cat),
      price: readField(r, F('price')),
      sell: readField(r, F('sell')),
      rarity: readField(r, F('rarity')),
      limit: readField(r, F('limit')) || 99,
      action: kind === 3 ? 0 : readField(r, F('action')),
      model: readField(r, F('model')),
      effects,
    };
  }

  private insert(id: number): void {
    const it = this.build(id);
    if (!it) return;
    this.byId.set(id, it);
    const i = this.items.findIndex((x) => x.id > id);
    if (i < 0) this.items.push(it);
    else this.items.splice(i, 0, it);
  }

  private refresh(id: number): void {
    const it = this.byId.get(id);
    const next = this.build(id);
    if (it && next) Object.assign(it, next);
  }

  item(id: number): OahuItem | undefined {
    return this.byId.get(id);
  }

  /**
   * Write a field of an item. A limit of 99 keeps the row's byte when it already means 99 (0 or 99), so setting the
   * shown value back is no change.
   */
  set(id: number, key: OahuItemNumber, v: number): void {
    if (!this.byId.has(id)) return;
    const r = this.row(id);
    if (key === 'limit' && v === 99 && (r[0x3f] === 0 || r[0x3f] === 99)) return;
    writeField(r, F(key), v);
    this.refresh(id);
  }

  /** The message ID of a message field ('name', 'menu', 'shop0'…). */
  messageId(id: number, key: string): number {
    return this.get(id, key);
  }

  setText(id: number, key: string, text: string): void {
    const m = this.messageId(id, key);
    if (!m) return;
    this.texts.setText(m, text);
    for (const it of this.items) if (OAHU_ITEM_MESSAGE_KEYS.some((k) => this.get(it.id, k) === m)) this.refresh(it.id);
  }

  changed(id: number): boolean {
    if (this.added(id)) return true;
    if (!this.byId.has(id)) return false;
    if (!equalBytes(this.row(id), this.master.originalRow(OAHU_ITEM_FILE, id))) return true;
    return OAHU_ITEM_MESSAGE_KEYS.some((k) => this.texts.isEdited(this.get(id, k)));
  }

  /** Put the row and its messages back as they are in the archive. */
  revert(id: number): void {
    if (!this.byId.has(id) || this.added(id)) return;
    this.row(id).set(this.master.originalRow(OAHU_ITEM_FILE, id));
    for (const k of OAHU_ITEM_MESSAGE_KEYS) {
      const m = this.get(id, k);
      if (m) this.texts.revert(m);
    }
    for (const it of this.items) this.refresh(it.id);
  }

  /** Whether an item fills a row that is empty in the archive (copyItem). */
  added(id: number): boolean {
    return id > 0 && id < this.table.rows && !u32(this.master.originalRow(OAHU_ITEM_FILE, id), 0x14) && !!u32(this.row(id), 0x14);
  }

  /** The row a copy goes to: the first empty row after the item (each category has some), else the first one; -1 = none. */
  freeRow(id: number): number {
    const empty = (i: number): boolean => i > 0 && !u32(this.row(i), 0x14);
    for (let i = id + 1; i < this.table.rows; i++) if (empty(i)) return i;
    for (let i = 1; i < id; i++) if (empty(i)) return i;
    return -1;
  }

  /** Messages a copy needs: one per distinct message of the row. */
  private messagesOf(id: number): number[] {
    return [...new Set(OAHU_ITEM_MESSAGE_KEYS.map((k) => this.get(id, k)).filter(Boolean))];
  }

  canCopy(id: number): boolean {
    return this.byId.has(id) && this.freeRow(id) > 0 && this.texts.canAdd(this.messagesOf(id).length);
  }

  /** The next free number of an order field (the largest in use + 1). */
  private nextOrder(key: 'order' | 'order2'): number {
    let max = 0;
    for (let i = 1; i < this.table.rows; i++) max = Math.max(max, this.get(i, key));
    return max + 1;
  }

  /**
   * Copy an item into an empty row as a new item: the same values, with messages of its own (same texts) so they can
   * change alone, and the next order numbers. Returns the new ID.
   */
  copyItem(id: number): number {
    const n = this.freeRow(id);
    if (!this.canCopy(id) || n < 0) throw new Error('アイテムを追加できる空きの行か、メッセージの空きがありません');
    const r = this.row(id).slice();
    const copied = new Map<number, number>();
    for (const m of this.messagesOf(id)) copied.set(m, this.texts.add(this.texts.units(m)!));
    for (const k of OAHU_ITEM_MESSAGE_KEYS) {
      const m = readField(r, F(k));
      if (m) writeField(r, F(k), copied.get(m)!);
    }
    writeField(r, F('order'), this.nextOrder('order'));
    if (readField(r, F('order2'))) writeField(r, F('order2'), this.nextOrder('order2'));
    this.row(n).set(r);
    this.insert(n);
    return n;
  }

  /** Put an added item's row back to the empty row, dropping its messages when they are the last added. */
  removeItem(id: number): void {
    if (!this.added(id)) throw new Error('消せるのは追加したアイテムだけです');
    const mine = this.messagesOf(id).filter((m) => this.texts.isAdded(m));
    this.row(id).set(this.master.originalRow(OAHU_ITEM_FILE, id));
    const used = new Set<number>();
    for (let i = 1; i < this.table.rows; i++) for (const k of OAHU_ITEM_MESSAGE_KEYS) used.add(this.get(i, k));
    for (const m of mine.sort((a, b) => b - a)) if (m === this.texts.addedIds().at(-1) && !used.has(m)) this.texts.removeAdded(m);
    const i = this.items.findIndex((x) => x.id === id);
    if (i >= 0) this.items.splice(i, 1);
    this.byId.delete(id);
  }

  /** Items whose rows were restored or changed outside (a reload): read every row again. */
  reload(): void {
    this.items.length = 0;
    this.byId.clear();
    for (let id = 1; id < this.table.rows; id++) this.insert(id);
  }

  /** "#267 どくこうげき", or the items that use a tool's action (its name is the "used" message). */
  actionName(row: number): string {
    if (row <= 0 || row >= this.actions.rows) return `#${row}`;
    const users = this.items.filter((it) => it.kind !== 3 && it.action === row).map((it) => it.name);
    if (users.length) return `#${row} ${[...new Set(users)].slice(0, 3).join('・')}${users.length > 3 ? ' ほか' : ''} のアクション`;
    const name = this.message(readField(this.actions.row(row), field(OAHU_ACTION_DATA, 'name')));
    return name && !name.includes('使') ? `#${row} ${name}` : `#${row}`;
  }

  /** Rows of actionData that are item actions (kind 2), for the effect picker. */
  itemActions(): { row: number; label: string }[] {
    const kind = field(OAHU_ACTION_DATA, 'kind');
    const out: { row: number; label: string }[] = [];
    for (let row = 1; row < this.actions.rows; row++) if (readField(this.actions.row(row), kind) === 2) out.push({ row, label: this.actionName(row) });
    return out;
  }

  effectText(e: OahuEquipEffect): string {
    return oahuEffectText(e, (r) => this.actionName(r));
  }
}
