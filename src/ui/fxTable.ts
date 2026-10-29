// 技・軍略ごとの、攻撃のエフェクトの種類。
// 技は番号で決める（data/system/skills.json の射程・形・名前の系統を見て分けた）。
// 表に無い技は、射程1なら斬撃、2以上なら矢にする。

import { D } from '../data/db';
import type { SkillDef, TacticDef } from '../data/types';

/**
 * 技のエフェクト。
 *   近接：slash 斬る ／ thrust 突く ／ blow 打つ・ぶつかる
 *   飛び道具：arrow 矢（山なり）／ javelin 投げ槍 ／ dart 吹き矢・手裏剣・撒き菱（小さく速い）
 *             bullet 鉄砲・弩（速い直線の弾、発射の光と煙）／ cannon 大筒（弧を描く玉、発射の煙、着弾の土煙）
 *             stone 投石・落石（弧を描く玉、着弾の土煙）／ fire 火の玉・火矢（着弾の炎）
 *   そのほか：shout 声や音（自分から輪が広がる）／ heal 回復
 */
export type StrikeFx = 'slash' | 'thrust' | 'blow' | 'arrow' | 'javelin' | 'dart' | 'bullet' | 'cannon' | 'stone' | 'fire' | 'shout' | 'heal';

/** エフェクトの種類 → 技の番号（空白区切り） */
const GROUPS: Record<StrikeFx, string> = {
  // 刀・太刀・鉈で斬る
  slash: 'k017 k019 k021 k032 k033 k044 k045 k046 k047 k048 k049 k050 k052 k056 k057 k067 k077 k079 k085 k093 k094 k095 k096 k102 k103 k104 k105',
  // 槍・懐の刃で突く、騎馬で突っ込む（長槍の2マス先を突く技も。0.11.0）
  thrust: 'k001 k002 k010 k026 k027 k028 k029 k030 k031 k054 k059 k060 k062 k064 k089 k090 k091 k097 k098 k099 k100 k101',
  // 柄・盾・槌で打つ、体当たり、踏み荒らす
  blow: 'k003 k005 k006 k008 k013 k015 k034 k035 k036 k037 k038 k039 k041 k058 k061 k074 k082 k086 k087',
  arrow: 'k024 k025',
  javelin: 'k004',
  dart: 'k018 k020 k022 k023 k063 k065 k068',
  bullet: 'k014 k016 k078 k080',
  cannon: 'k040 k042 k043 k075 k076 k083 k084',
  stone: 'k055',
  fire: 'k012 k070 k071 k072 k073 k081',
  // 法螺・鬨・唄・言葉
  shout: 'k007 k009 k011 k051 k066 k069 k088 k092',
  heal: 'k053',
};

const SKILL_FX: Record<string, StrikeFx> = {};
for (const [fx, ids] of Object.entries(GROUPS) as [StrikeFx, string][]) for (const id of ids.split(' ')) SKILL_FX[id] = fx;

/** 表に載っている技か（テスト用） */
export const inSkillTable = (id: string): boolean => id in SKILL_FX;

/** 技のエフェクト。武将の通常攻撃（atk:役職）は、弓なら矢、そのほかは斬撃 */
export function skillFx(skill: SkillDef): StrikeFx {
  const hit = SKILL_FX[skill.id];
  if (hit) return hit;
  const far = skill.shape.type === 'single' ? skill.range[1] >= 2 : skill.shape.n >= 2;
  return far ? 'arrow' : 'slash';
}

/** 飛んでいくものが見えるエフェクトか */
export const isProjectile = (fx: StrikeFx): boolean =>
  fx === 'arrow' || fx === 'javelin' || fx === 'dart' || fx === 'bullet' || fx === 'cannon' || fx === 'stone' || fx === 'fire';

/**
 * 軍略のエフェクト。
 *   攻撃：fire 火 ／ water 水 ／ arrow 矢 ／ stone 落石 ／ raid 兵が襲う ／ shout 声
 *   回復：heal、補助：buff、妨害：debuff、打ち消し：dispel
 */
export type TacticFx = 'fire' | 'water' | 'arrow' | 'stone' | 'raid' | 'shout' | 'heal' | 'buff' | 'debuff' | 'dispel';

const TACTIC_FX: Record<string, TacticFx> = {
  x01: 'arrow', x02: 'fire', x03: 'water', x04: 'raid', x05: 'raid', x06: 'raid', x07: 'stone', x08: 'fire', x09: 'fire',
  x10: 'water', x11: 'raid', x12: 'shout', x13: 'fire', x38: 'shout',
};

/** 軍略のエフェクト。表に無いものは、種類（攻撃・回復・補助・妨害）で決める */
export function tacticFx(tac: TacticDef): TacticFx {
  const hit = TACTIC_FX[tac.id];
  if (hit) return hit;
  switch (tac.kind) {
    case 'damage': return D.combat.weather.fireTactics.includes(tac.id) ? 'fire' : 'raid';
    case 'heal': case 'cure': case 'mpRestore': return 'heal';
    case 'buff': case 'pull': case 'revive': return 'buff';
    case 'dispel': return 'dispel';
    default: return 'debuff';
  }
}
