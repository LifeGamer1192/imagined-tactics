// 戦闘中の能力の変化の内訳（P58）：どの能力が、何のせいで、いくつ変わっているか（巡の数が限られるなら残りの巡の数も）。
// 計算は stats.ts と同じ順番で、駒の情報欄に出す。戦いの始めに特性で変わったぶんは u.traitFx。

import type { BStatus, BUnit, BattleState } from '../battle/types';
import { D } from '../data/db';
import type { StatusId } from '../data/types';
import { agility, attackPower, defense, has, intellect, moveOf, outOfCommand, passive, supplyMultOf, tacticResist, terrainMod } from './stats';

export interface StatCause { why: string; value: string; turns?: string }
export interface StatRow { key: string; base: number; now: number; causes: StatCause[] }

const sg = (v: number): string => `${v > 0 ? '+' : ''}${v}`;
const mul = (m: number): string => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;

/** 状態の残り：巡の数、または「次の技まで」「戦いの終わりまで」 */
export function turnsText(s: BStatus | undefined): string | undefined {
  if (!s) return undefined;
  if (s.id === 'atkNext' || s.id === 'sureNext') return '次の技まで';
  if (s.id === 'ward') return '次の軍略まで';
  if (s.id === 'extraAct') return 'この番だけ';
  return s.turns > 0 ? `残り${s.turns}巡` : '戦いの終わりまで';
}

/** 状態の名前（ui/text の STATUS_NAME を渡す） */
export function statRows(st: BattleState, u: BUnit, statusName: (id: StatusId) => string): StatRow[] {
  const S = D.status, rows: StatRow[] = [];
  const stat = (id: StatusId): StatCause | null => {
    const s = u.statuses.find((x) => x.id === id);
    return s ? { why: statusName(id), value: '', turns: turnsText(s) } : null;
  };
  const withV = (c: StatCause | null, value: string): StatCause[] => (c ? [{ ...c, value }] : []);
  const out = outOfCommand(st, u), sup = supplyMultOf(st, u);
  // 攻撃
  {
    const causes = [
      ...withV(stat('atkNext'), sg(S.atkNext.atk)), ...withV(stat('atkUp'), sg(S.atkUp.atk)),
      ...withV(stat('weaken'), sg(S.weaken.atk)), ...withV(stat('atkDown'), sg(S.atkDown.atk)),
      ...(out ? [{ why: '采配範囲外', value: mul(1 + S.outOfCommand.atkDefPct / 100), turns: '将の近くへ戻るまで' }] : []),
      ...(sup !== 1 ? [{ why: '飛び地で戦う', value: mul(sup), turns: '戦いの終わりまで' }] : []),
    ];
    if (causes.length) rows.push({ key: '攻撃', base: Math.round(u.str * D.combat.atkPerStr), now: Math.round(attackPower(st, u)), causes });
  }
  // 防御
  {
    const causes = has(u, 'confuse')
      ? withV(stat('confuse'), `${S.confuse.def}に固定`)
      : [
          ...withV(stat('defUp'), sg(S.defUp.def)), ...withV(stat('weaken'), sg(S.weaken.def)),
          ...(out ? [{ why: '采配範囲外', value: mul(1 + S.outOfCommand.atkDefPct / 100), turns: '将の近くへ戻るまで' }] : []),
          ...(sup !== 1 ? [{ why: '飛び地で戦う', value: mul(sup), turns: '戦いの終わりまで' }] : []),
        ];
    if (causes.length) rows.push({ key: '防御', base: u.def, now: Math.round(defense(st, u)), causes });
  }
  // 知略・機敏・移動
  { const c = withV(stat('intDown'), sg(S.intDown.int)); if (c.length) rows.push({ key: '知略', base: u.int, now: intellect(u), causes: c }); }
  { const c = [...withV(stat('agiUp'), sg(S.agiUp.agi)), ...withV(stat('grounded'), sg(S.grounded.agi))]; if (c.length) rows.push({ key: '機敏', base: u.agi, now: agility(u), causes: c }); }
  { const c = withV(stat('moveUp'), sg(S.moveUp.move)); if (c.length) rows.push({ key: '移動', base: u.move, now: moveOf(u), causes: c }); }
  // 軍略への耐性（％）
  {
    const fromPassive = passive(u, 'tacticResist').reduce((s, p) => s + p.pct, 0);
    const causes = [
      ...withV(stat('resistUp'), sg(S.resistUp.pct) + '%'),
      ...(out ? [{ why: '采配範囲外', value: `${sg(-S.outOfCommand.tacticDamagePct)}%`, turns: '将の近くへ戻るまで' }] : []),
    ];
    if (causes.length) rows.push({ key: '軍略への耐性(%)', base: fromPassive, now: Math.round(tacticResist(st, u) * 100), causes });
  }
  // 命中・回避（地形）
  {
    const tm = terrainMod(st, u);
    if (tm) rows.push({ key: '命中・回避', base: 0, now: tm, causes: [{ why: 'いる地形', value: sg(tm), turns: 'このマスにいる間' }] });
  }
  // 体力の増減（毎巡）
  {
    const c = [...withV(stat('poison'), `毎巡 −${S.poison.pct}%`), ...withV(stat('regen'), `毎巡 +${S.regen.pct}%`)];
    if (c.length) rows.push({ key: '体力（番の始め）', base: u.hp, now: u.hp, causes: c });
  }
  // 得意地形
  {
    const c = [...withV(stat('mounted'), '騎になる'), ...withV(stat('grounded'), '平地になる')];
    if (c.length) rows.push({ key: '得意地形', base: 0, now: 0, causes: c });
  }
  return rows;
}
