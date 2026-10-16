// 画面の文章。戦闘ログは「キーと値」で保存し、表示するときに文章にする（rts-mons / hist-sim の i18n の方式）。

import type { BUnit, BattleLogEntry } from '../battle/types';
import { D, L, term } from '../data/db';
import type { StatusId } from '../data/types';

export const STATUS_NAME: Record<StatusId, string> = {
  poison: '毒', daze: '怯み', silence: '攪乱', defect: '寝返り', stun: '気絶', confuse: '混乱',
  weaken: '攻撃・防御ダウン', atkNext: '次の攻撃アップ', moveUp: '移動アップ', resistUp: '軍略耐性アップ', defUp: '防御アップ',
  atkUp: '攻撃アップ', agiUp: '命中・回避アップ', atkDown: '攻撃ダウン', intDown: '知略ダウン', grounded: '足止め',
  mounted: '騎乗', regen: '毎ターン回復', ward: '軍略無効', sureNext: '次の攻撃が必中', extraAct: '再行動', routed: '収容された敗残兵',
};
export const AFFINITY_NAME: Record<string, string> = { plain: '平地', forest: '森', mountain: '山', swamp: '湿地', water: '水上', rider: '騎' };

const TEXT: Record<string, string> = {
  'hit': '{unit}の{skill}：{target}に{dmg}',
  'hit.crit': '{unit}の{skill}：会心！ {target}に{dmg}',
  'miss': '{unit}の{skill}：{target}に当たらない',
  'shield': '{unit}が盾で受けた',
  'defeat': '{unit}が倒れた',
  'retreat': '{unit}は戦場を離れた',
  'lost': '{unit}は失われた',
  'tactic': '{unit}の{tactic}',
  'tactic.hit': '{tactic}：{target}に{dmg}',
  'heal': '{target}が{hp}回復',
  'resist': '{target}には効かなかった',
  'ward': '{unit}は用心していた（無効）',
  'poison': '{unit}は毒で{dmg}',
  'status.add': '{unit}：{status}',
  'status.end': '{unit}：{status}が解けた',
  'win': '{side}の勝ち',
  'timeup': '時間切れ。{side}の勝ち',
  'timeupHeld': '時間切れ。天守を押さえた{side}の勝ち',
  'hold': '{unit}が天守を押さえている（{count}／{need}）',
  'holdLost': '{side}は天守から追い出された',
  'castleTaken': '{unit}が天守を落とした。{side}の勝ち',
  'turn': '── {side}の番（{round}巡目）──',
};

export function logText(e: BattleLogEntry): string {
  const tpl = TEXT[e.key] ?? e.key;
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = e.vars[k];
    if (k === 'status' && typeof v === 'string') return STATUS_NAME[v as StatusId] ?? v;
    return v === undefined ? '' : String(v);
  });
}

/** ユニットの役職・兵種の名前 */
export function kindName(u: BUnit): string {
  if (u.kind === 'general') return D.byClass[u.defId] ? L(D.byClass[u.defId].name) : '';
  return D.byUnit[u.defId] ? L(D.byUnit[u.defId].name) : '';
}

export const T = {
  hp: () => term('hp'), mp: () => term('mp'), str: () => term('str'), int: () => term('int'), agi: () => term('agi'),
  general: () => term('general'), unit: () => term('unit'), tactic: () => term('tactic'), command: () => term('commandRange'),
};

export const TRAIT_NAME: Record<string, string> = {
  brave: '勇敢', craven: '臆病', wise: '賢明', foolish: '愚か', pious: '敬虔', cynical: '皮肉屋', just: '公正', cruel: '残酷',
  kind: '優しい', greedy: '強欲', generous: '寛大', ambitious: '野心', content: '満足', scholar: '学者', warrior: '武人',
  builder: '築城家', drunkard: '酒好き', paranoid: '疑り深い', charismatic: 'カリスマ', sickly: '病弱', genius: '天才',
  unifier: '統一者', reformer: '改革者',
};
