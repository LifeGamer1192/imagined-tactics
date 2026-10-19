// 強化・弱化・状態の技と軍略は、かかるとどう変わるかを必ず説明する（P40）
import { describe, expect, it } from 'vitest';
import { D } from '../src/data/db';
import { skillTip, statusEffect, tacticTip } from '../src/ui/describe';

describe('buff and debuff explanations', () => {
  it('every tactic that gives a status says what the status does', () => {
    for (const t of D.tactics) {
      const st = typeof t.status === 'string' ? t.status : t.status?.status;
      if (!st) continue;
      expect(statusEffect(st), `${t.id} ${st}`).not.toBe('');
      expect(tacticTip(t)).toContain(statusEffect(st).slice(0, 8));
    }
  });

  it('every skill that gives a status says what the status does', () => {
    for (const s of D.skills) for (const e of s.effects) {
      if (e.type !== 'status') continue;
      expect(statusEffect(e.status), `${s.id} ${e.status}`).not.toBe('');
      expect(skillTip(s)).toContain('（');
    }
  });

  it('mounting explains what changes, not just the word', () => {
    const t = D.tactics.find((x) => x.status === 'mounted')!;
    const tip = tacticTip(t);
    expect(tip).toContain('得意地形が「騎」');
    expect(tip).toMatch(/動きやすく|動きにくく|入れなく/);
  });
});
