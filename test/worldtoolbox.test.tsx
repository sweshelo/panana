// The toolbox layout shared by the dungeon map editor and the world maps (editor/tools.tsx), rendered to a string.
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ToolboxLayout } from '../src/editor/tools';

describe('ToolboxLayout', () => {
  const tools: ['select' | 'paint' | 'erase', string, string][] = [
    ['select', '選択・移動', 'V'],
    ['paint', '地形を塗る', 'B'],
    ['erase', '地形を消す', 'E'],
  ];
  test('shows the modes, the tools as icons and the palette', () => {
    const html = renderToString(
      <ToolboxLayout tiles tools={tools} tool="paint" onTool={() => {}} onMode={() => {}}>
        <div>PALETTE</div>
      </ToolboxLayout>,
    );
    expect(html).toContain('チップ');
    expect(html).toContain('パーツ');
    expect(html).toContain('aria-label="地形を塗る"');
    expect(html).toContain('PALETTE');
  });
  test('says why a tool or the parts mode cannot be used', () => {
    const html = renderToString(
      <ToolboxLayout
        tiles
        tools={tools}
        tool="select"
        onTool={() => {}}
        onMode={() => {}}
        partsDisabled="置けません"
        toolDisabled={(t) => (t === 'select' ? null : '地形は編集できません')}
      >
        {null}
      </ToolboxLayout>,
    );
    expect(html).toContain('title="置けません"');
    expect(html).toContain('title="地形は編集できません"');
  });
  test('duplicate / delete only in the parts mode', () => {
    const el = (tiles: boolean) =>
      renderToString(
        <ToolboxLayout
          tiles={tiles}
          tools={tools}
          tool="select"
          onTool={() => {}}
          onMode={() => {}}
          onDelete={() => {}}
          onDuplicate={() => {}}
          canEditPart
        >
          {null}
        </ToolboxLayout>,
      );
    expect(el(true)).not.toContain('選んだパーツを削除');
    expect(el(false)).toContain('選んだパーツを削除');
    expect(el(false)).toContain('選んだパーツを複製');
  });
});
