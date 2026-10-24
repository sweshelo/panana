// The frame the games' pages share (#151), rendered to a string.
import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { PageShell, type Visit } from '../src/ui/PageShell';

const PAGES = [['list', '一覧'], ['world', '世界'], ['outside', '外']] as const;
type P = (typeof PAGES)[number][0];
const TITLES: Record<P, string> = { list: 'リスト', world: 'ワールド', outside: '外のページ' };

function at(hash: string): void {
  (globalThis as { location?: unknown }).location = { hash };
}

function shell(extra: Partial<Parameters<typeof PageShell<P>>[0]> = {}, seen: [P, Visit][] = []): string {
  return renderToString(
    <PageShell<P> pages={PAGES} titles={TITLES} fallback="list" brand="テスト" romLabel="ROM"
      actions={() => <button className="act">書き出し…</button>}
      render={(page, v) => { seen.push([page, v]); return page === 'outside' ? null : <i>{`${page}:${v.arg ?? ''}`}</i>; }}
      {...extra} />,
  );
}

describe('page shell', () => {
  afterEach(() => { delete (globalThis as { location?: unknown }).location; });

  test('tabs, the active page, the brand and the game\'s buttons', () => {
    at('#/world/W01');
    const html = shell();
    expect(html).toContain('data-page="world"');
    expect(html).toContain('<a class="tab active" data-page="world" href="#/world">世界</a>');
    expect(html).toContain('<a class="tab" data-page="list" href="#/list">一覧</a>');
    expect(html).toContain('Panana<span class="brand-sub"> - テスト</span>');
    expect(html).toContain('<span class="nav-title">ワールド</span>');
    expect(html).toContain('class="act"');
    expect(html).toContain('<div class="page page-world"><i>world:W01</i></div>');
    // only the shown page is built
    expect(html).not.toContain('page-list');
  });

  test('an entry shows the back bar to its list', () => {
    at('#/list/3');
    const html = shell();
    expect(html).toContain('data-detail="true"');
    expect(html).toContain('<a class="back-bar" href="#/list">← リストの一覧</a>');
  });

  test('a game decides what an entry is and where its back bar leads', () => {
    const detail = { isDetail: (p: P, a: string) => p !== 'world' || a.includes('.'), backHref: (p: P, a: string) => `#/${p}/${a.split('.')[0]}` };
    at('#/world/W01');
    expect(shell(detail)).not.toContain('back-bar');
    at('#/world/W01.2');
    expect(shell(detail)).toContain('<a class="back-bar" href="#/world/W01">← ワールドの一覧</a>');
  });

  test('a hash of another game names no page here: the fallback page, no entry', () => {
    at('#/map/M01');
    const html = shell();
    expect(html).toContain('data-page="list"');
    expect(html).not.toContain('data-detail');
  });

  test('a page drawn outside of React has no wrapper; the outside nodes and the dialogs are put in', () => {
    at('#/outside');
    const seen: [P, Visit][] = [];
    const html = shell({ outside: <div className="page page-outside">外</div>, children: <div className="dialog" /> }, seen);
    expect(html.match(/page-outside/g)).toHaveLength(1);
    expect(html).toContain('<div class="dialog"></div>');
    expect(seen).toEqual([['outside', { hash: '#/outside', arg: undefined, n: 1 }]]);
  });
});
