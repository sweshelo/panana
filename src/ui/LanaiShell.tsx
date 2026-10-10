// The pages of a 電波人間のRPG FREE! (lanai) dump, read only: the stages (contents), the strings of the tables, the
// monsters, the codes and the check-in tables, and the RomFS viewer. The Update is added like RPG3's.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LanaiCodePage } from '../lanai/CodePage';
import { contentTitle, lanaiContents } from '../lanai/contents';
import { LanaiMessagePage } from '../lanai/MessagePage';
import { LanaiMonsterPage } from '../lanai/MonsterPage';
import { LanaiSession } from '../lanai/session';
import { LanaiStagePage } from '../lanai/StagePage';
import { openUpdate, withUpdate } from '../rom/dump';
import { lanaiRomfsProfile } from '../romfs/lanai';
import type { RomfsProfile } from '../romfs/profile';
import { RomfsPage } from '../romfs/RomfsPage';
import { InfoTooltip } from './InfoTip';
import { useHashRoute } from './route';

export const LANAI_PAGES = [['stages', 'ステージ'], ['messages', 'メッセージ'], ['monsters', 'モンスター'], ['codes', 'コード・配信'], ['romfs', 'RomFS']] as const;
type LanaiPage = (typeof LANAI_PAGES)[number][0];
const PAGE_IDS = LANAI_PAGES.map(([id]) => id);
const TITLES: Record<LanaiPage, string> = { stages: 'ステージ', messages: 'メッセージ', monsters: 'モンスター', codes: 'コード入力・チェックイン', romfs: 'RomFS' };

/** Asks for the Update's CIA and opens the dump again with it. */
function pickUpdate(session: LanaiSession, done: (s: LanaiSession) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.cia,.cxi,.app';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      done(await LanaiSession.open(withUpdate(session.dump, await openUpdate(f, f.name))));
    } catch (err) {
      alert(`Update を読めませんでした: ${(err as Error).message}`);
    }
  });
  input.click();
}

export function LanaiShell({ session, onSession, onChangeDump }: {
  session: LanaiSession;
  /** The session reopened with the Update. */
  onSession: (s: LanaiSession) => void;
  onChangeDump: () => void;
}): ReactNode {
  const { dump } = session;
  const { page, arg, hash } = useHashRoute<LanaiPage>(PAGE_IDS, 'stages');
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [hash]);
  useEffect(() => {
    document.title = `Panana — ${TITLES[page]} (RPG FREE!)`;
  }, [page]);
  const visits = useRef(new Map<LanaiPage, string | undefined>());
  visits.current.set(page, arg);
  const detail = !!arg && hash.startsWith(`#/${page}/`);
  // the RomFS viewer names the archives of the contents by their stages
  const profile = useMemo((): RomfsProfile => {
    const files = { ...lanaiRomfsProfile.files };
    for (const c of lanaiContents(session)) files[c.archive] ??= `コンテンツ ${c.index}: ${contentTitle(c)}`;
    return { ...lanaiRomfsProfile, files };
  }, [session]);
  const u = dump.update;
  return (
    <div className="shell" data-page={page} data-detail={detail || undefined}>
      <nav className={menu ? 'topnav open' : 'topnav'}>
        <button className="nav-toggle" aria-label="メニュー" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <b className="brand">Panana<span className="brand-sub"> - 電波人間のRPG FREE! ビューア</span></b>
        <span className="nav-title">{TITLES[page]}</span>
        <div className="nav-items">
          {LANAI_PAGES.map(([id, label]) => (
            <a key={id} className={id === page ? 'tab active' : 'tab'} data-page={id} href={`#/${id}`}>{label}</a>
          ))}
          <span className="grow" />
          <span className="muted small dump-label">{dump.label}</span>
          {u ? <span className="muted small" title={`patchList.bin: ${u.patched.length} 個`}>{`Update v${u.titleVersion ?? '?'}`}</span>
            : <button title="ゲームが実際に読むのは Update のアーカイブです (資料のアドレスや行も Update が基準)" onClick={() => pickUpdate(session, onSession)}>Update を追加…</button>}
          <button onClick={onChangeDump}>ダンプを変える</button>
        </div>
      </nav>
      {menu && <div className="nav-backdrop" onClick={() => setMenu(false)} />}
      {detail && <a className="back-bar" href={`#/${page}`}>{`← ${TITLES[page]}の一覧`}</a>}
      <InfoTooltip />
      {LANAI_PAGES.map(([id]) => {
        if (!visits.current.has(id)) return null;
        const a = visits.current.get(id);
        return (
          <div key={id} className={`page page-${id}`}>
            {id === 'stages' ? <LanaiStagePage session={session} arg={a} />
              : id === 'messages' ? <LanaiMessagePage session={session} arg={a} />
              : id === 'monsters' ? <LanaiMonsterPage session={session} arg={a} />
              : id === 'codes' ? <LanaiCodePage session={session} arg={a} />
              : <RomfsPage dump={dump} profile={profile} arg={a} />}
          </div>
        );
      })}
    </div>
  );
}
