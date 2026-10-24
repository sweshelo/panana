// The pages of a 電波人間のRPG3 (oahu) dump (#59): the maps and events, the story and the save values (#87), the messages, the items, the shops, the monsters, groups and actions, the BGM and sound effects, the code (code.ips; needs the Update), the RomFS viewer, the Update and the export.
import { useMemo, useState, type ReactNode } from 'react';
import type { FieldContext } from '../game/tabledef';
import { OahuActionPage } from '../oahu/ActionPage';
import { OahuCodePage } from '../oahu/CodePage';
import { OahuEventPage } from '../oahu/EventPage';
import { OahuExportDialog } from '../oahu/ExportDialog';
import { OahuFlagPage } from '../oahu/FlagPage';
import { OahuStoryPage } from '../oahu/StoryPage';
import { OahuGroupPage } from '../oahu/GroupPage';
import { OahuItemPage } from '../oahu/ItemPage';
import { OahuMapPage } from '../oahu/MapPage';
import { OahuMessagePage } from '../oahu/MessagePage';
import { OahuShopPage } from '../oahu/ShopPage';
import { OahuSoundPage } from '../oahu/SoundPage';
import { battleContext, OahuMonsterPage } from '../oahu/MonsterPage';
import type { OahuSession } from '../oahu/session';
import { openUpdate } from '../rom/dump';
import { oahuRomfsProfile } from '../romfs/oahu';
import { RomfsPage } from '../romfs/RomfsPage';
import { PageShell } from './PageShell';

export const OAHU_PAGES = [['maps', 'マップ'], ['events', 'イベント'], ['story', 'ストーリー'], ['flags', 'セーブの値'], ['messages', 'メッセージ'], ['items', 'アイテム'], ['shops', 'ショップ'], ['monsters', 'モンスター'], ['groups', '群れ'], ['actions', 'アクション'], ['sounds', 'BGM・効果音'], ['code', 'コード'], ['romfs', 'RomFS']] as const;
type OahuPage = (typeof OAHU_PAGES)[number][0];
const TITLES: Record<OahuPage, string> = { maps: 'マップ', events: 'イベント一覧', story: 'ストーリー', flags: 'セーブの値', messages: 'メッセージ', items: 'アイテム図鑑', shops: 'ショップ', monsters: 'モンスター図鑑', groups: '群れ', actions: 'アクション', sounds: 'BGM・効果音', code: 'コード', romfs: 'RomFS' };

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

export function OahuShell({ session, onSession }: {
  session: OahuSession;
  /** The session with the Update added (same edits). */
  onSession: (s: OahuSession) => void;
}): ReactNode {
  const { dump } = session;
  const [exporting, setExporting] = useState(false);
  const addUpdate = (): void => pickUpdate(session, onSession);
  const u = dump.update;
  const context = useMemo((): FieldContext => ({ ...battleContext(session.battle), message: (id) => session.messages.texts.preview(id, true) }), [session]);
  return (
    <PageShell pages={OAHU_PAGES} titles={TITLES} fallback="messages" brand="電波人間のRPG3 エディタ" titleSuffix=" (RPG3)" romLabel={dump.label}
      actions={(closeMenu) => (
        <>
          {u ? <span className="muted small" title={`patchList.bin: ${u.patched.join(', ')}`}>{`Update v${u.titleVersion ?? '?'}`}</span>
            : <button title="書き出しと、code.bin を使う機能には Update が要ります" onClick={addUpdate}>Update を追加…</button>}
          <button className="primary" title="変更したメッセージ・表・コードのパッチを LayeredFS 用の MOD として書き出します (Update が必要)" onClick={() => { closeMenu(); setExporting(true); }}>書き出し…</button>
        </>
      )}
      render={(id, { arg: a }) => (
        id === 'maps' ? <OahuMapPage session={session} arg={a} />
          : id === 'events' ? <OahuEventPage session={session} arg={a} onAddUpdate={addUpdate} />
          : id === 'story' ? <OahuStoryPage session={session} arg={a} onAddUpdate={addUpdate} />
          : id === 'flags' ? <OahuFlagPage session={session} arg={a} onAddUpdate={addUpdate} />
          : id === 'messages' ? <OahuMessagePage session={session} arg={a} />
          : id === 'items' ? <OahuItemPage session={session} arg={a} />
          : id === 'shops' ? <OahuShopPage session={session} arg={a} />
          : id === 'monsters' ? <OahuMonsterPage session={session} arg={a} />
          : id === 'groups' ? <OahuGroupPage session={session} arg={a} />
          : id === 'actions' ? <OahuActionPage session={session} arg={a} />
          : id === 'sounds' ? <OahuSoundPage session={session} arg={a} />
          : id === 'code' ? <OahuCodePage session={session} onAddUpdate={addUpdate} />
          : <RomfsPage dump={dump} profile={oahuRomfsProfile} arg={a} context={context} />
      )}>
      {exporting && <OahuExportDialog session={session} onAddUpdate={() => { setExporting(false); addUpdate(); }} onClose={() => setExporting(false)} />}
    </PageShell>
  );
}
