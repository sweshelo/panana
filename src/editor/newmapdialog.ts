// "マップを追加": a new floor in an existing dungeon (issue #19, docs/new-map.md).
import type { MapInfo } from '../game/codebin';
import { mapTitle } from '../game/names';
import { AUTOMAP_LIMIT, addableDungeons, hasAutomap, suggestName } from '../game/newmap';
import type { Session } from '../session';
import { clear, h } from './dom';

/** Opens the dialog; `onCreated` gets the new map. */
export function openNewMapDialog(session: Session, currentDungeon: number | null, onCreated: (m: MapInfo) => void): void {
  const game = session.game;
  const dungeons = addableDungeons(game);
  const dungeonName = (d: number, code: string): string => `${game.master.dungeonName(d) || code}  (${code})`;
  const dSel = h('select', {}, ...dungeons.map((d) => h('option', { value: d.dungeon, selected: d.dungeon === currentDungeon }, dungeonName(d.dungeon, d.code))));
  const floor = h('input', { type: 'number', min: -99, max: 99, value: -1, style: 'width:6em' });
  const name = h('input', { type: 'text', maxlength: 15, style: 'width:10em' });
  const tSel = h('select', {});
  const copyTiles = h('input', { type: 'checkbox', checked: true });
  const note = h('p', { class: 'muted small' });
  const err = h('div', { class: 'error' });
  let nameTouched = false;
  const chosen = () => dungeons.find((d) => d.dungeon === Number(dSel.value))!;

  const update = (): void => {
    const d = chosen();
    if (!nameTouched) name.value = suggestName(game, d.code, Number(floor.value) || 0);
    const keep = tSel.value;
    clear(tSel);
    for (const m of d.maps) tSel.append(h('option', { value: m.hash, selected: String(m.hash) === keep }, `${mapTitle(m, game.code.maps, game.master)}  ${m.name}`));
    const n = d.maps.length + 1;
    note.textContent = [
      '見た目 (タイルセット・BGM・敵) はこのダンジョンのものです。写す元のマップから、敵の出現の見出し (区画 6) と mapData の指定を写します。',
      hasAutomap(d.dungeon)
        ? n > AUTOMAP_LIMIT
          ? `このダンジョンは ${n} 枚になり、オートマップの枠 (${AUTOMAP_LIMIT}) を超えます。あとから入ったマップにはオートマップが付きません。`
          : `オートマップ: ${n} / ${AUTOMAP_LIMIT} 枚。`
        : 'このダンジョンにはもともとオートマップがありません。',
      '作ったあと、ほかのマップの出入口 (区画 3) の行き先をこのマップにし、このマップにも出入口を置いてください。書き出すと code.ips (マップの表) とマップ DB に入ります。',
    ].join('\n');
  };
  dSel.addEventListener('change', update);
  floor.addEventListener('input', update);
  name.addEventListener('input', () => (nameTouched = true));

  const dlg = h('dialog', { class: 'picker' });
  const close = (): void => {
    dlg.close();
    dlg.remove();
  };
  const create = (): void => {
    err.textContent = '';
    try {
      const d = chosen();
      const template = d.maps.find((m) => String(m.hash) === tSel.value) ?? d.maps[0]!;
      const m = session.addMap({
        dungeon: d.dungeon,
        floor: Number(floor.value) || 0,
        name: name.value,
        template,
        templateDoc: session.docOf(template),
        copyTiles: copyTiles.checked,
      });
      close();
      onCreated(m);
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  };
  const field = (label: string, input: HTMLElement): HTMLElement => h('label', { class: 'field' }, h('span', {}, label), input);
  dlg.append(
    h('div', { class: 'picker-head' }, h('h2', {}, 'マップを追加'), h('button', { onclick: close }, '閉じる')),
    h('div', {},
      field('ダンジョン', dSel),
      field('階 (地下は負の数)', floor),
      field('マップのコード', name),
      field('写す元のマップ', tSel),
      h('label', { class: 'layer' }, copyTiles, ' タイルも写す'),
      note,
      err,
      h('p', {}, h('button', { class: 'primary', onclick: create }, '追加する')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  note.style.whiteSpace = 'pre-line';
  document.body.append(dlg);
  update();
  dlg.showModal();
}
