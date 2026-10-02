// The pages of a 電波人間のRPG3 (oahu) dump (#59): the messages, the items, the monsters, groups and actions, the code (code.ips; needs the Update), the RomFS viewer, the Update and the export.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldContext } from '../game/tabledef';
import { OahuActionPage } from '../oahu/ActionPage';
import { OahuCodePage } from '../oahu/CodePage';
import { OahuExportDialog } from '../oahu/ExportDialog';
import { OahuGroupPage } from '../oahu/GroupPage';
import { OahuItemPage } from '../oahu/ItemPage';
import { OahuMessagePage } from '../oahu/MessagePage';
import { battleContext, OahuMonsterPage } from '../oahu/MonsterPage';
import type { OahuSession } from '../oahu/session';
import { openUpdate } from '../rom/dump';
import { oahuRomfsProfile } from '../romfs/oahu';
import { RomfsPage } from '../romfs/RomfsPage';
import { InfoTooltip } from './InfoTip';
import { useHashRoute } from './route';

export const OAHU_PAGES = [['messages', 'メッセージ'], ['items', 'アイテム'], ['monsters', 'モンスター'], ['groups', '群れ'], ['actions', 'アクション'], ['code', 'コード'], ['romfs', 'RomFS']] as const;
type OahuPage = (typeof OAHU_PAGES)[number][0];
const PAGE_IDS = OAHU_PAGES.map(([id]) => id);
const TITLES: Record<OahuPage, string> = { messages: 'メッセージ', items: 'アイテム図鑑', monsters: 'モンスター図鑑', groups: '群れ', actions: 'アクション', code: 'コード', romfs: 'RomFS' };

/** Asks for the Update's CIA and opens it. */
function pickUpdate(session: OahuSession, done: (s: OahuSession) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.cia,.cxi,.app';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      done(await session.withUpdate(await openUpdate(f, f.name)));
    } catch (err) {
      alert(`Update を読めませんでした: ${(err as Error).message}`);
    }
  });
  input.click();
}

export function OahuShell({ session, onSession, onChangeDump }: {
  session: OahuSession;
  /** The session with the Update added (same edits). */
  onSession: (s: OahuSession) => void;
  onChangeDump: () => void;
}): ReactNode {
  const { dump } = session;
  const { page, arg, hash } = useHashRoute<OahuPage>(PAGE_IDS, 'messages');
  const [menu, setMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => setMenu(false), [hash]);
  useEffect(() => {
    document.title = `Panana — ${TITLES[page]} (RPG3)`;
  }, [page]);
  // Pages are built when first shown and kept while others are shown, each with the route it was last shown with.
  const visits = useRef(new Map<OahuPage, string | undefined>());
  visits.current.set(page, arg);
  // a hash left by RPG2's pages (#/map/…) names nothing here
  const detail = !!arg && hash.startsWith(`#/${page}/`);
  const addUpdate = (): void => pickUpdate(session, onSession);
  const u = dump.update;
  const context = useMemo((): FieldContext => ({ ...battleContext(session.battle), message: (id) => session.messages.texts.preview(id, true) }), [session]);
  return (
    <div className="shell" data-page={page} data-detail={detail || undefined}>
      <nav className={menu ? 'topnav open' : 'topnav'}>
        <button className="nav-toggle" aria-label="メニュー" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <b className="brand">Panana<span className="brand-sub"> - 電波人間のRPG3 エディタ</span></b>
        <span className="nav-title">{TITLES[page]}</span>
        <div className="nav-items">
          {OAHU_PAGES.map(([id, label]) => (
            <a key={id} className={id === page ? 'tab active' : 'tab'} data-page={id} href={`#/${id}`}>{label}</a>
          ))}
          <span className="grow" />
          <span className="muted small dump-label">{dump.label}</span>
          {u ? <span className="muted small" title={`patchList.bin: ${u.patched.join(', ')}`}>{`Update v${u.titleVersion ?? '?'}`}</span>
            : <button title="書き出しと、code.bin を使う機能には Update が要ります" onClick={addUpdate}>Update を追加…</button>}
          <button className="primary" title="変更したメッセージ・表・コードのパッチを LayeredFS 用の MOD として書き出します (Update が必要)" onClick={() => { setMenu(false); setExporting(true); }}>書き出し…</button>
          <button onClick={onChangeDump}>ダンプを変える</button>
        </div>
      </nav>
      {menu && <div className="nav-backdrop" onClick={() => setMenu(false)} />}
      {detail && <a className="back-bar" href={`#/${page}`}>{`← ${TITLES[page]}の一覧`}</a>}
      <InfoTooltip />
      {OAHU_PAGES.map(([id]) => {
        if (!visits.current.has(id)) return null;
        const a = visits.current.get(id);
        return (
          <div key={id} className={`page page-${id}`}>
            {id === 'messages' ? <OahuMessagePage session={session} arg={a} />
              : id === 'items' ? <OahuItemPage session={session} arg={a} />
              : id === 'monsters' ? <OahuMonsterPage session={session} arg={a} />
              : id === 'groups' ? <OahuGroupPage session={session} arg={a} />
              : id === 'actions' ? <OahuActionPage session={session} arg={a} />
              : id === 'code' ? <OahuCodePage session={session} onAddUpdate={addUpdate} />
              : <RomfsPage dump={dump} profile={oahuRomfsProfile} arg={a} context={context} />}
          </div>
        );
      })}
      {exporting && <OahuExportDialog session={session} onAddUpdate={() => { setExporting(false); addUpdate(); }} onClose={() => setExporting(false)} />}
    </div>
  );
}
