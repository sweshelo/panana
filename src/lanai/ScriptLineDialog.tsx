// Writing a new line of talk from the script editor (StageSourcePage.tsx): the line is added to the talk table of a
// MapGroup (maps.ts addTalkRow / addTalkSet) and the call that shows it is written at the editor's cursor. A line is
// the one spoken to's (talk(): moves the mouth of self), the lead 電波人間's (the eight tones, StartMessageAuto), the
// hero's own (one row of tone 1, StartMessage) or the system's (no speaker, the system window). A row with a voice
// speaks it (talk.ts); the voices of a set are written on the talks' page.
import { useState, type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import type { LanaiMaps } from './maps';
import { encodeLanaiMessage, parseLanaiText } from './message';
import { lineIdText } from './scriptAssist';
import type { LanaiSession } from './session';
import { encodeTalkVoice, setTalkVoice, SPEAKERS, TALK_TONES, toneLabel, voiceDraft, voiceProblem } from './talk';

export type ScriptLineKind = 'talk' | 'tones' | 'hero' | 'system';

const KINDS: [ScriptLineKind, string, string][] = [
  ['talk', '話している相手の台詞', 'talk(行 ID): 話しかけたときのイベントで、相手 (self) の口を動かしながら出す'],
  [
    'tones',
    '先頭の電波人間の台詞 (性格違いの 8 口調)',
    'ScriptMenu.StartMessageAuto: 先頭の電波人間の性格 0〜6 で口調 2〜8 の行が選ばれる (ほかは口調 1)',
  ],
  ['hero', '主人公専用の台詞 (口調 1 の 1 行)', 'ScriptMenu.StartMessage: 渡した行をそのまま出す'],
  [
    'system',
    'システムのメッセージ (話者なし)',
    'ScriptMenu.StartMessage(行 ID, 2, 0, 0.2): システムのウィンドウで出す',
  ],
];

/** The call that shows a line of the kind, as the script writes it. */
export function scriptLineCall(kind: ScriptLineKind, id: number): string {
  const line = lineIdText(id);
  switch (kind) {
    case 'talk':
      return `talk(${line})`;
    case 'tones':
      return `ScriptMenu.StartMessageAuto(${line}, 0, 0, 0.2)`;
    case 'hero':
      return `ScriptMenu.StartMessage(${line}, 0, 0, 0.2)`;
    case 'system':
      return `ScriptMenu.StartMessage(${line}, 2, 0, 0.2)`;
  }
}

/** The ID the script names a row of a group's talk table by (0x800000NN). */
export const talkLineId = (maps: LanaiMaps, group: number, row: number): number =>
  (maps.talkTable(group)!.rowId(row) | 0x80000000) >>> 0;

/**
 * Adds a line of the kind to a group's talk table (with its voice when one is given; a set's voices are written on
 * the talks' page) and returns the call that shows it.
 */
export function addScriptLine(
  maps: LanaiMaps,
  group: number,
  kind: ScriptLineKind,
  texts: string[],
  speaker: number,
  voice: string,
): string {
  // a text that cannot be written stops before any row is added
  for (const text of texts) encodeLanaiMessage(parseLanaiText(text));
  if (kind !== 'tones') encodeTalkVoice(voice);
  const row =
    kind === 'tones'
      ? maps.addTalkSet(group, texts)
      : maps.addTalkRow(group, texts[0] ?? '', kind === 'hero' ? 1 : kind === 'system' ? 0 : speaker);
  if (kind !== 'tones' && voice) setTalkVoice({ table: maps.talkTable(group)! }, row, voice);
  return scriptLineCall(kind, talkLineId(maps, group, row));
}

export function ScriptLineDialog({
  session,
  maps,
  group,
  onInsert,
  onClose,
}: {
  session: LanaiSession;
  maps: LanaiMaps;
  group: number;
  /** Writes the call at the editor's cursor. */
  onInsert: (call: string) => void;
  onClose: () => void;
}): ReactNode {
  const [kind, setKind] = useState<ScriptLineKind>('talk');
  const [texts, setTexts] = useState<string[]>(() => Array<string>(TALK_TONES).fill(''));
  const [speaker, setSpeaker] = useState(0x12);
  const [voice, setVoice] = useState('');
  const [error, setError] = useState('');
  const table = maps.talkTable(group);
  const tones = kind === 'tones';
  const shown = tones ? texts : texts.slice(0, 1);
  const setText = (k: number, v: string): void => setTexts(texts.map((x, i) => (i === k ? v : x)));
  const add = (): void => {
    try {
      if (!shown.some((x) => x.trim())) throw new Error('本文を書いてください');
      const call = addScriptLine(maps, group, kind, tones ? texts.map((x) => x || texts[0]!) : shown, speaker, voice);
      session.edited();
      onInsert(call);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!table) return null;
  const problem = !tones && voice ? voiceProblem(texts[0]!, voice) : '';
  return (
    <Dialog title="台詞を追加" onClose={onClose}>
      <p className="muted small">{`MapGroup ${group} の台詞の表 (${table.name}) の末尾に足し、呼び出しをカーソルの位置に書きます。台詞の行 ID は MapGroup ごとに違うので、このスクリプトの関数を割り当てるイベントの MapGroup を選んでおきます (演出プレビューのマップ)。`}</p>
      <fieldset>
        {KINDS.map(([k, label, about]) => (
          <label key={k} className="row" title={about}>
            <input type="radio" name="line-kind" checked={kind === k} onChange={() => setKind(k)} />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="muted small">{KINDS.find(([k]) => k === kind)![2]}</p>
      {kind === 'talk' && (
        <label className="field">
          <span>話者 (声)</span>
          <select value={speaker} onChange={(e) => setSpeaker(Number(e.target.value))}>
            {SPEAKERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {shown.map((text, k) => (
        <label key={k} className="field">
          <span>{tones ? toneLabel(k + 1) : '本文'}</span>
          <textarea
            rows={2}
            style={{ width: '100%' }}
            value={text}
            placeholder={tones && k ? '(空なら口調 1 と同じ)' : 'ルビは {ruby:親字|よみ}、改ページは {page}'}
            onChange={(e) => setText(k, e.target.value)}
          />
        </label>
      ))}
      {tones ? (
        <p className="muted small">
          8 口調の読み (voice) は、追加したあとセリフのページで書きます。読みのない行は喋りません。
        </p>
      ) : (
        <label className="field">
          <span>読み (voice)</span>
          <input
            className="mono"
            style={{ width: '100%' }}
            placeholder="(空: 喋らない) 半角カナ。' アクセント / 区切り . 終わり"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
          />
          <button className="small" onClick={() => setVoice(voiceDraft(texts[0]!))}>
            本文から下書き
          </button>
        </label>
      )}
      {(error || problem) && <p className="error small">{error || problem}</p>}
      <div className="row">
        <button className="primary" onClick={add}>
          追加してカーソルの位置に書く
        </button>
      </div>
    </Dialog>
  );
}
