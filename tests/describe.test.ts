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

describe('0.13.0 fixes', () => {
  it('the herbal brew says it heals enemies too, and the confusion status is now called 捕縛', async () => {
    const t = skillTip(D.bySkill.k053);
    expect(t).toMatch(/敵も巻き込む/);
    expect(t).not.toMatch(/味方も巻き込む/);
    expect(D.bySkill.k053.shape).toEqual({ type: 'around', n: 1 });
    const { STATUS_NAME } = await import('../src/ui/text');
    expect(STATUS_NAME.confuse).toBe('捕縛');
    expect(D.byTactic.x37.name.jp).toBe('捕縛の計');
    expect(D.bySkill.k058).toBeUndefined();
    expect(D.units.some((u) => u.skills.includes('k058') || u.skills.includes('k061'))).toBe(false);
  });
});
