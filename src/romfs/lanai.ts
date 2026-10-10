// RomFS of 電波人間のRPG FREE! (lanai): naauao lanai/analysis.md §1・§3.1 and lanai/contents.md. The root names end in
// 0000 or 000A (the 000A archives hold the _JP tables and messages).
import { LANAI } from '../rom/titles';
import type { RomfsProfile } from './profile';

export const lanaiRomfsProfile: RomfsProfile = {
  title: LANAI,
  archiveVersion: 10,
  files: {
    '2135000A': 'master (GS テーブル・メッセージ・フォント)',
    A9DF0000: 'チェックインの表・raregetParameter・boostParameter',
    '25D60000': 'CheckinOffsetTime',
    '307C0000': 'checkin_debug_JP (開発用の文言)',
    '7BF7000A': 'コード入力の表 (CampaignCharacter・CampaignCodeLocal …)',
    '7BF70000': 'タイトルのモデル',
    D4410000: 'ランキング (Wi-Fi コロシアム)',
    FE74000A: 'MessageMenu などの UI の文言',
    '012A000A': '電波人間の作成の表',
    '28480000': '敵のモデル (Base)',
    '719F0000': '敵のモデル (Update)',
    '402F0000': 'MonsterBrain',
    '5EFB0000': 'コンテンツ 0 (島・町のスクリプト)',
    'SOUND/SOUND.BCSAR': 'サウンドアーカイブ',
    'APP/LANAI.CRS': '本体の CRO 用シンボル',
  },
  entryTypes: {
    1: 'GS テーブル・CRO・フォント・テクスチャ',
    2: 'フォント・パレット',
    3: 'GS テーブル (TableResource)・マップの配置',
    4: 'BCH (モデル・テクスチャ)',
    5: 'PTCL (パーティクル)',
    6: 'darc / SARC (レイアウト)',
    10: 'GSC (場面)',
    11: 'GS テーブル',
    12: 'GS テーブル (コンテンツ)',
    13: 'BCH (アンテナ・体の模様)',
  },
};
