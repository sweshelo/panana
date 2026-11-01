// RPG2's story milestones as appearance conditions (a type of FUN_0030B8A4 and its value), for picking "いつ出すか"
// in plain words. Read off the ROM (2026-10-31): 0x8D[n] is per dungeon (FUN_0030b734 writes the current dungeon's
// 0x8D[d - 1]; types 0x18..0x21 read 0x8D[0..9]), a boss beaten sets 0x91[n] = 2 (+0xA44 = n before the battle;
// type 0xB0 = "0x91[値] = 2"). docs/kahara/worldmap.md §6.4.

export interface StoryCondition {
  label: string;
  type: number;
  value: number;
  /** false = read off the scenes but not seen to hold in the game. */
  sure: boolean;
}

const BOSS = 0xb0;
const boss = (value: number, label: string, sure = true): StoryCondition => ({ label: `${label}を倒したあと`, type: BOSS, value, sure });

/** In the order of the story. */
export const STORY_CONDITIONS: StoryCondition[] = [
  boss(0x03, 'デンパタウンのリーフホッグ'),
  boss(0x04, '山のどうくつのボス', false),
  boss(0x06, '海底トンネルのバブルフロッグ'),
  boss(0x08, '海底トンネルのどくマタンゴ'),
  boss(0x09, '魔王の塔のまおう', false),
  boss(0x0a, 'ピラミッドのマミーオックス'),
  boss(0x0b, '大火山のポーン'),
  boss(0x0e, '水の神殿のセピアナイト'),
  boss(0x0f, '氷の島のアイスデーモン'),
  boss(0x15, '邪悪のどうくつのせいりゅう', false),
  boss(0x16, 'パレスタワーのじゃあくのまじょ', false),
  { label: 'エンディング 1st のあと', type: 0x20, value: 3, sure: false },
  boss(0x17, '地の獄のじごくのじょおう'),
  { label: 'エンディング 2nd のあと', type: 0x21, value: 2, sure: false },
  boss(0x0c, 'しゃくねつ火山のしんじつのポーン'),
  boss(0x18, '忘却の島のボス'),
  boss(0x19, 'とうしんポーン', false),
  boss(0x1a, 'ピラミッドのルーク'),
  boss(0x1b, 'ピラミッドのクイーン'),
  boss(0x1c, 'ピラミッドのキング'),
  boss(0x1d, '水の神殿のゲソパラディン'),
];

/** The milestone a condition is, if any. */
export const storyCondition = (type: number, value: number): StoryCondition | undefined =>
  STORY_CONDITIONS.find((c) => c.type === type && c.value === value);
