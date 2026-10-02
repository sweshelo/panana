// RomFS of 電波人間のRPG2 (kahara): docs/analysis.md "RomFS" and the archives the editor reads.
import { KAHARA } from '../rom/titles';
import type { RomfsProfile } from './profile';

export const kaharaRomfsProfile: RomfsProfile = {
  title: KAHARA,
  archiveVersion: 5,
  files: {
    '56562135': 'master (GS テーブル・システムのメッセージ・アイテムのモデル)',
    A90C8038: 'マップ DB',
    '2713402F': 'MonsterDesign・演出の表 (directData・effectData)',
    '470D2848': 'モンスターのモデル',
    '49A43B63': 'ShopItem・MessageCommand',
    '1D37838B': 'ShopItem・MessageCommand・アイテムのモデル',
    '302996EB': 'アイテムのモデル',
    '8756A407': 'エフェクト (CGFX)',
  },
  entryTypes: {
    2: 'CGFX (モデル・テクスチャ)',
    6: 'GMSG (メッセージ)',
    8: 'マップのパーツ (0x180 + CGFX)',
    9: 'GS テーブル',
  },
};
