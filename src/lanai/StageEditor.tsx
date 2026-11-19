import { useRef, useState, type ReactNode } from 'react';
import { GridPicker } from '../ui/GridPicker';
import { RowStrings, tableKey } from './MessagePage';
import { imageUrl } from '../ui/ScreenMap';
import { readSarc } from '../layout/sarc';
import { readBflim } from '../layout/bflim';
import { Dialog } from '../ui/Dialog';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { LanaiConditionEditor } from './ConditionEditor';
import {
  CRO_HOOK_START_EVENT,
  lanaiContents,
  type ContentArchive,
  type LanaiContent,
  type LanaiStage,
} from './contents';
import { DestinationFields } from './DestinationFields';
import { lanaiMapHref } from './MapPage';
import { lanaiFloorLabel, lanaiMaps } from './maps';
import { useLanaiRevision } from './MonsterEditor';
import type { LanaiSession } from './session';
import type { LanaiCondition } from './conditions';
import { LanaiStageThumbnail, uploadedStageThumbnail } from './StageThumbnail';
import { addLanaiEmptyStage } from './emptyStage';
import {
  cloneLanaiContent,
  editLanaiStage,
  lanaiStageStart,
  LANAI_EMPTY_SCRIPT_CONTENT,
  setLanaiStageStart,
  type LanaiCloneOptions,
} from './stageEdit';

/**
 * Where the stage starts and what plays first: the first map and arrival point (MapStage +0x3A → MapGroup +0x14 /
 * +0x18) and whether the content's CRO has an opening event (hook 3).
 */
export function LanaiStageStartEditor({
  session,
  content,
  stage,
  archive,
}: {
  session: LanaiSession;
  content: LanaiContent;
  stage: LanaiStage;
  archive: ContentArchive;
}): ReactNode {
  const revision = useLanaiRevision(session);
  const maps = useAsync(() => lanaiMaps(session, content), [session, content]);
  const start = useAsync(() => lanaiStageStart(session, content, stage), [session, content, stage, revision]);
  const [error, setError] = useState('');
  const hooks = archive.cro?.info.hooks ?? [];
  const opening = hooks.includes(CRO_HOOK_START_EVENT);
  if (!maps || !start) return <p className="muted">マップを読み込み中…</p>;
  if (maps instanceof Error) return <p className="muted">{maps.message}</p>;
  if (start instanceof Error) return <p className="error">{start.message}</p>;
  const info = maps.map(start.map);
  return (
    <div className="stage-start">
      <p className="small muted">
        {`ステージ選択から入ると、MapGroup ${start.group} 「${maps.groupName(start.group) || '名前なし'}」の最初のマップ・入口から始まります (MapStage +0x3A → MapGroup +0x14 / +0x18)。マップを選ぶと、そのマップの MapGroup が始まりになります。同じ MapGroup の「最初のマップ」はほかの場面でも使う見込みです。`}
      </p>
      <DestinationFields
        maps={maps}
        map={start.map}
        point={start.point}
        labels={['最初のマップ', '最初の入口 (到着する出入口)']}
        onChange={(map, point) => {
          setError('');
          setLanaiStageStart(session, content, stage, map, point).catch((e: Error) => setError(e.message));
        }}
      />
      {info ? (
        <p className="small">
          <a
            href={lanaiMapHref(content.index, info.name)}
          >{`${info.name} (${lanaiFloorLabel(info.floor) || '地上'}) を開く`}</a>
        </p>
      ) : start.map === 0 ? (
        <p className="muted small">{`始まりのマップがありません (MapGroup ${start.group})。`}</p>
      ) : (
        <p className="error small">{`最初のマップ ${hex8(start.map).toUpperCase()} がこのステージのマップ表にありません。`}</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small">
        {!archive.cro
          ? '最初のイベント: CRO がありません。'
          : opening
            ? `最初のイベント: あり (CRO ${archive.cro.info.module} の関数 ${CRO_HOOK_START_EVENT})。マップに入ると CRO が MapGroup やフラグを見て開始の演出 (${archive.cro.info.classes.filter((c) => /Intro$/.test(c)).join('、') || 'Intro'} など) を返します。追加したマップでは、元の開始イベントを呼び出さない保護を MOD に含めます。元のマップの演出も止める場合は「イベントなしで追加」でステージを作り直します。`
            : `最初のイベント: なし (CRO ${archive.cro.info.module} に開始の演出がありません)。`}
      </p>
    </div>
  );
}
export function LanaiStageEditor({
  session,
  content,
  stage,
  onClose,
}: {
  session: LanaiSession;
  content: LanaiContent;
  stage: LanaiStage;
  onClose: () => void;
}): ReactNode {
  const [order, setOrder] = useState(stage.order),
    [stamina, setStamina] = useState(stage.stamina),
    [recommendedLevel, setRecommendedLevel] = useState(stage.recommendedLevel),
    [thumbnail, setThumbnail] = useState('');
  const thumbnails = lanaiContents(session).flatMap((c) =>
    c.stages.map((st) => ({
      key: String(st.row),
      archive: c.archive,
      stage: st,
    })),
  );
  const [pickingThumbnail, setPickingThumbnail] = useState(false);
  const [upload, setUpload] = useState<Uint8Array>();
  const [uploadPreview, setUploadPreview] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<{ body: Uint8Array; preview: string; name: string }[]>([]);
  const messageRef = session.refOf(session.need('MessageMapStage'))!;
  const messageRow = messageRef.table.find(stage.messageId);
  const selectedThumbnail = thumbnails.find((t) => t.key === thumbnail);
  const [visible, setVisible] = useState(stage.visible);
  const [hidden, setHidden] = useState(stage.hidden);
  const pendingScripts = useRef(new Map<number, string>());
  const script = (source: string, change: (value: LanaiCondition) => void): void => {
    const id = Math.max(0, ...session.conditionScripts.keys(), ...pendingScripts.current.keys()) + 1;
    pendingScripts.current.set(id, source);
    change({ kind: 0x72, v1: id, v2: 0 });
  };
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="ステージを編集" className="stage-editor" onClose={onClose}>
      <label className="field">
        <span>並び順</span>
        <input
          type="number"
          min={0}
          max={4294967295}
          value={order}
          onChange={(e) => setOrder(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>必要なスタミナ</span>
        <input type="number" min={0} max={255} value={stamina} onChange={(e) => setStamina(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>推奨レベル (0 で表示なし)</span>
        <input
          type="number"
          min={0}
          max={65535}
          step={1}
          value={recommendedLevel}
          onChange={(e) => setRecommendedLevel(Number(e.target.value))}
        />
      </label>
      <h3>サムネイル</h3>
      <button
        className="stage-thumbnail-trigger"
        aria-label="サムネイルを選ぶ"
        disabled={busy}
        onClick={() => setPickingThumbnail(true)}
      >
        {upload ? (
          <img src={uploadPreview} alt="アップロードしたステージ画像" />
        ) : (
          <LanaiStageThumbnail
            session={session}
            archive={selectedThumbnail?.archive ?? content.archive}
            hash={selectedThumbnail?.stage.thumbnail ?? stage.thumbnail}
            name={selectedThumbnail?.stage.name ?? stage.name}
          />
        )}
      </button>
      {pickingThumbnail && (
        <GridPicker
          title="ステージ画像を選ぶ"
          wide
          groupByCategory
          categories={{ 1: '規定', 2: 'アップロード', 3: 'ステージ画像' }}
          controls={
            <>
              <input
                ref={uploadInput}
                type="file"
                accept="image/*"
                hidden
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setBusy(true);
                  setError('');
                  try {
                    const body = await uploadedStageThumbnail(session, content.archive, stage.thumbnail, file);
                    const texture = [...readSarc(body)].find(([name]) => /^timg\/.*\.bflim$/i.test(name))![1];
                    const preview = imageUrl(readBflim(texture));
                    if (!preview) throw new Error('画像をプレビューできません');
                    setUploads((previous) => [...previous, { body, preview, name: file.name }]);
                    setUploadPreview(preview);
                    setUpload(body);
                    setThumbnail('');
                    setPickingThumbnail(false);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />

              <p className="small muted">
                アップロードした画像は元のサイズに合わせて変換されます。同じコンテンツ内で画像を共有するステージにも反映されます。保存するまで画像は変更されません。
              </p>
              {busy && <p role="status">画像を変換中…</p>}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          }
          entries={[
            {
              id: -1,
              name: '現在の画像',
              category: 1,
              icon: (
                <span className="stage-thumbnail-choice">
                  <LanaiStageThumbnail
                    session={session}
                    archive={content.archive}
                    hash={stage.thumbnail}
                    name={stage.name}
                  />
                </span>
              ),
            },
            {
              id: -2,
              name: '画像をアップロード',
              category: 2,
              icon: (
                <span className="stage-thumbnail-choice stage-thumbnail-add" aria-hidden="true">
                  ＋
                </span>
              ),
            },
            ...uploads.map((item, index) => ({
              id: -3 - index,
              name: item.name,
              category: 2,
              icon: (
                <span className="stage-thumbnail-choice">
                  <img src={item.preview} alt={item.name} />
                </span>
              ),
            })),
            ...thumbnails.map((t) => ({
              id: t.stage.row,
              name: t.stage.name || '名前なし',
              sub: 'コンテンツ ' + t.stage.content,
              category: 3,
              icon: (
                <span className="stage-thumbnail-choice">
                  <LanaiStageThumbnail
                    session={session}
                    archive={t.archive}
                    hash={t.stage.thumbnail}
                    name={t.stage.name}
                  />
                </span>
              ),
            })),
          ].map((entry) => ({ ...entry, unavailable: busy ? '画像を変換中です' : null }))}
          current={
            upload ? -3 - uploads.findIndex((item) => item.body === upload) : (selectedThumbnail?.stage.row ?? -1)
          }
          onPick={(id) => {
            if (id === -2) {
              uploadInput.current?.click();
              return;
            }
            if (id <= -3) {
              const item = uploads[-3 - id]!;
              setUpload(item.body);
              setUploadPreview(item.preview);
              setThumbnail('');
            } else {
              setUpload(undefined);
              setThumbnail(id === -1 ? '' : String(id));
            }
            setPickingThumbnail(false);
          }}
          onClose={() => {
            setPickingThumbnail(false);
          }}
        />
      )}
      {messageRow >= 0 && (
        <section>
          <h3>名前・ミッション・説明</h3>
          <p className="small muted">メッセージは各欄の編集操作で反映されます。</p>
          <RowStrings
            session={session}
            e={{ ref: messageRef, row: messageRow, key: tableKey(messageRef) + ':' + messageRow }}
            label="MessageMapStage"
            showHeader={false}
          />
        </section>
      )}
      <h3>表示・解放条件</h3>
      <p className="small muted">条件が成立すると表示されます。条件なし (0) はいつも表示します。</p>
      <LanaiConditionEditor
        session={session}
        value={visible}
        onChange={setVisible}
        onScript={(source) => script(source, setVisible)}
      />
      <h3>表示しない条件</h3>
      <p className="small muted">
        この条件が成立すると非表示になります。条件なし (0) は非表示にしません。配信・期限などによる制限は別にあります。
      </p>
      <LanaiConditionEditor
        session={session}
        value={hidden}
        onChange={setHidden}
        onScript={(source) => script(source, setHidden)}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="primary"
        onClick={async () => {
          setBusy(true);
          try {
            for (const c of [visible, hidden])
              if (c.kind === 0x72 && pendingScripts.current.has(c.v1))
                session.setConditionScript(c.v1, pendingScripts.current.get(c.v1)!);
            session.codeIps(); // validate version, conflicts and available code space before committing table edits
            await editLanaiStage(session, content, stage, {
              order,
              stamina,
              recommendedLevel,
              visible,
              hidden,
              ...(upload
                ? { thumbnail: upload }
                : selectedThumbnail
                  ? { thumbnail: { archive: selectedThumbnail.archive, hash: selectedThumbnail.stage.thumbnail } }
                  : {}),
            });
            onClose();
          } catch (e) {
            for (const id of pendingScripts.current.keys()) session.conditionScripts.delete(id);
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        保存
      </button>
    </Dialog>
  );
}
export function LanaiContentCreator({
  session,
  content,
  onClose,
}: {
  session: LanaiSession;
  content: LanaiContent;
  onClose: () => void;
}): ReactNode {
  const [title, setTitle] = useState('新しいステージ'),
    [script, setScript] = useState<NonNullable<LanaiCloneOptions['script']>>('copy'),
    [intro, setIntro] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="コンテンツを複製して追加" onClose={onClose}>
      <p>選択したステージのマップ・敵・宝・店・会話を写し、新しいコンテンツ番号で追加します。</p>
      <label className="field">
        <span>ステージ名</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset className="field">
        <legend>イベントのスクリプト (CRO)</legend>
        <label>
          <input type="radio" checked={script === 'copy'} onChange={() => setScript('copy')} />
          元のステージのまま写す (開始の演出・会話・扉などのイベントも写し、元のステージとフラグを共有します)
        </label>
        <label>
          <input type="radio" checked={script === 'empty'} onChange={() => setScript('empty')} />
          {`イベントなし (コンテンツ ${LANAI_EMPTY_SCRIPT_CONTENT} の空の CRO を使います。マップ・宝箱・出入口・クリアは表のデータで動きます。CRO に書かれた会話やギミックは動きません)`}
        </label>
        {script === 'empty' && (
          <label>
            <input type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} />
            入場の演出を付ける
            (ゲームと同じく、開始地点の門の外から歩いて入り、ステージ名を出して門が閉まります。門が無ければステージ名だけ。あとでスクリプトの画面で外せます)
          </label>
        )}
      </fieldset>
      <p className="muted small">
        実験機能です。元の CRO
        のイベントコードも写します。元のコンテンツ番号をコード内で使う処理やセーブの共有は自動変換しません。コンテンツ数のゲーム側の上限と実機での動作は未確認です。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={busy || !title.trim()}
        className="primary"
        onClick={async () => {
          setBusy(true);
          try {
            const index = await cloneLanaiContent(session, content, title, { script, intro });
            location.hash = `#/stages/${index}`;
            onClose();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? '作成中…' : '追加する'}
      </button>
    </Dialog>
  );
}

/** Adds an empty stage (emptyStage.ts: content 99's room with a gate at its start and the game's opening). */
export function LanaiEmptyStageCreator({
  session,
  onClose,
}: {
  session: LanaiSession;
  onClose: () => void;
}): ReactNode {
  const [title, setTitle] = useState('新しいステージ'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="新しいステージ" onClose={onClose}>
      <p>
        {`何もないステージを新しいコンテンツ番号で追加します。コンテンツ ${LANAI_EMPTY_SCRIPT_CONTENT} (未使用の「あみだクジ（仮）」) の 3×3 の部屋に、ゲームと同じ形の門 (開始地点) と、門から歩いて入る入場の演出を付けます。`}
      </p>
      <p className="muted small">
        マップ・敵の群れ・宝箱・イベントは自分で足します。見た目はマップのページの「見た目
        (タイルセット)」で替えられます (最初は洞窟A)。ゴールは無いので、クリアするにはゴールの宝箱などを置いてください。
      </p>
      <label className="field">
        <span>ステージ名</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={busy || !title.trim()}
        className="primary"
        onClick={async () => {
          setBusy(true);
          try {
            const index = await addLanaiEmptyStage(session, title);
            location.hash = `#/stages/${index}`;
            onClose();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? '作成中…' : '追加する'}
      </button>
    </Dialog>
  );
}
