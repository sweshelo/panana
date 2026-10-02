// RomFS of 電波人間のRPG3 (oahu): naauao oahu/analysis.md §4. The root names are RPG2's hashes with the low 16 bits
// moved up (RPG2 56562135 -> RPG3 21350000).
import { OAHU_TABLES } from '../oahu/tables';
import { OAHU } from '../rom/titles';
import type { RomfsProfile } from './profile';

export const oahuRomfsProfile: RomfsProfile = {
  title: OAHU,
  archiveVersion: 7,
  files: {
    '21350000': 'master (GS テーブル・システムと戦闘のメッセージ・フォント)',
    '402F0000': '演出の表 (effectData・directData)',
    A4070000: 'エフェクト (CGFX)',
    F8D10000: 'エフェクト (CGFX)',
    A9DF0000: 'MessageField・フィールドのレイアウト',
    '00910000': 'MessageAntenna',
    '3B630000': 'MessageCommand',
    '58190000': 'MessageCommand',
    '619D0000': 'MessageCommand',
    '838B0000': 'MessageCommand・MessageEvent',
    '6E380000': 'MessageNagomi・なごみ',
    D94C0000: 'MessageStaffroll',
    '91470000': 'MessageCodeFilter',
    '7BF70000': 'タイトル画面',
    'SOUND/SOUND.BCSAR': 'サウンドアーカイブ',
  },
  entryTypes: {
    0: '生のデータ',
    1: 'フォント・パレット',
    2: 'BCH (モデル・テクスチャ)',
    3: 'CGFX (エフェクト)',
    4: 'darc (レイアウト)',
    5: 'シェーダー',
    6: 'GMSG (メッセージ)',
    8: 'マップのパーツ (0x180 + BCH)',
    9: 'GS テーブル',
    10: 'BCH',
  },
  tables: OAHU_TABLES,
};
