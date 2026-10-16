// 戦闘の記録の細かさ（簡易・通常・詳細）と、攻撃のエフェクトの表のテスト。
// 詳細の記録に出す内訳は、計算で使った値そのものなので、内訳から組み立て直すと、実際の結果と同じになるはず。
import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { mapFromProvince } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import type { BattleLogEntry, BattleState } from '../src/battle/types';
import { convert, generalsOf } from '../src/convert/convert';
import { D, setVariant } from '../src/data/db';
import type { Weather } from '../src/data/types';
import type { StatParts } from '../src/rules/combat';
import { skillOf } from '../src/rules/stats';
import { before, cues } from '../src/ui/battleFx';
import { BattleLogView } from '../src/ui/battleLog';
import { inSkillTable, isProjectile, skillFx, tacticFx } from '../src/ui/fxTable';
import { logText } from '../src/ui/text';
import { FIXTURES, loadFixture } from './helpers';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const EXTRA = new Set(['act', 'move', 'strike', 'tactic.on']);
/** 攻撃・防御の値を、内訳から組み立て直す */
const stat = (p: StatParts) => (p.fixed ? p.base : Math.max(1, (p.base * p.mult + p.adds.reduce((s, [, v]) => s + v, 0)) * p.out));

/** いろいろな天気で、おまかせどうしの戦いをいくつか終わらせる */
async function battles(): Promise<BattleState[]> {
  const out: BattleState[] = [];
  const skies: { weather: Weather; night: boolean }[] = [
    { weather: 'clear', night: false }, { weather: 'rain', night: false }, { weather: 'fog', night: true }, { weather: 'snow', night: false },
  ];
  for (const f of FIXTURES) {
    const save = await loadFixture(f);
    const gs = convert(save, { variant: 'jp' });
    const facs = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
    for (let i = 0; i < 4; i++) {
      const a = facs[i % facs.length], d = facs[(i + 1) % facs.length];
      if (a.id === d.id) continue;
      const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
      const st = createBattle(gs, mapFromProvince(save.world, d.capital, { capital: true, walls: i % 2 === 0 }), [pick(a.id), pick(d.id)], `detail${i}`, undefined, undefined, skies[i]);
      autoBattle(st);
      out.push(st);
    }
  }
  setVariant('jp');
  return out;
}

describe('battle log detail', () => {
  it('the breakdown of every strike and tactic recombines to what actually happened', async () => {
    const C = D.combat;
    let strikes = 0, tactics = 0, formulas = 0;
    for (const st of await battles()) {
      for (const e of st.log) {
        const d = e.d;
        if (!d) continue;
        if (d.type === 'strike') {
          strikes++;
          const h = d.hit;
          expect(d.landed).toBe(d.roll < h.pct);
          if (!h.fixed) {
            formulas++;
            const raw = h.base + h.agiA - h.agiT + h.skill + h.terA - h.terT - h.tri + h.passHit - h.passEvade + h.perch + h.rain + h.fog + h.night;
            expect(raw).toBeCloseTo(h.raw, 9);
            expect(h.pct).toBe(clamp(Math.round(h.raw), C.hitMin, C.hitMax));
            // 天気のぶんは、その天気のときだけ付く
            if (st.weather !== 'rain') expect(h.rain).toBe(0);
            if (st.weather !== 'fog') expect(h.fog).toBe(0);
            expect(h.night).toBe(st.night ? C.weather.nightHit : 0);
          }
          const g = d.dmg;
          if (g) {
            const p = g.parts;
            expect(stat(g.atk)).toBeCloseTo(p.atk, 9);
            expect(stat(g.def)).toBeCloseTo(p.def, 9);
            expect(g.atk.value).toBe(p.atk);
            expect(g.def.value).toBe(p.def);
            expect(Math.abs(Math.max(1, Math.floor(p.power * p.atk / p.def * p.bane * p.counter * p.fire)) - p.base)).toBeLessThanOrEqual(p.bane === 1 ? 0 : 1);
            expect(g.crit).toBe(g.critRoll < g.critPct);
            const raw = p.base * g.rnd * (g.crit ? g.critMult : 1) * g.critBonus * (g.shield?.ok ? 0.5 : 1);
            expect(raw).toBeCloseTo(g.raw, 6);
            expect(g.final).toBe(Math.max(1, Math.round(g.raw)));
            expect(g.rnd).toBeGreaterThanOrEqual(C.randomMin);
            expect(g.rnd).toBeLessThanOrEqual(C.randomMax);
            expect(d.hp![0] - d.hp![1]).toBe(Math.min(g.final, d.hp![0]));
          }
          for (const t of d.tries) expect(t.ok).toBe(t.roll < t.chance);
        } else {
          tactics++;
          if (d.dmg) {
            const p = d.dmg.parts;
            expect(p.base).toBe(Math.max(1, Math.floor(p.power * (p.intA * p.mult) / (p.intT + p.def) * (1 - p.resist) * p.fire)));
            expect(d.dmg.final).toBe(Math.max(1, Math.round(p.base * d.dmg.rnd)));
            expect(d.hp![0] - d.hp![1]).toBe(Math.min(d.dmg.final, d.hp![0]));
          }
          if (d.heal) {
            const p = d.heal.parts;
            expect(p.amount).toBe(Math.round(p.power * (p.c0 + p.int / p.per) * (1 + p.healPct / 100)));
            expect(d.heal.got).toBe(d.hp![1] - d.hp![0]);
            expect(d.heal.got).toBeLessThanOrEqual(p.amount);
          }
          if (d.success) {
            const p = d.success.parts;
            expect(p.raw).toBeCloseTo((p.base + p.intA - p.intT) * (1 - p.resist), 9);
            expect(p.pct).toBe(clamp(Math.round(p.raw), C.statusMin, C.statusMax));
            expect(d.success.ok).toBe(d.success.roll < p.pct);
          }
        }
      }
    }
    expect(strikes).toBeGreaterThan(200);
    expect(formulas).toBeGreaterThan(100);
    expect(tactics).toBeGreaterThan(5);
  }, 180000);

  it('the old entries are still there, and every action is grouped under its heading', async () => {
    for (const st of await battles()) {
      // これまでの記録：当たり・外れには、だれがだれに、が残っている
      for (const e of st.log) {
        if (e.key === 'hit' || e.key === 'hit.crit') { expect(typeof e.vars.dmg).toBe('number'); expect(typeof e.vars.unit).toBe('string'); expect(typeof e.vars.uid).toBe('number'); }
      }
      // 1撃ごとに、内訳（strike）のすぐあとに、当たり・外れの記録が続く（ダメージの無い技が当たったときを除く）
      st.log.forEach((e, i) => {
        if (e.key !== 'strike' || e.d?.type !== 'strike') return;
        const rest = st.log.slice(i + 1, i + 3).map((x) => x.key);
        if (!e.d.landed) expect(rest[0]).toBe('miss');
        else if (e.d.dmg) expect(rest.some((k) => k === 'hit' || k === 'hit.crit')).toBe(true);
      });
      // 見出し（act）の n は、次の見出し・移動・番の始まりを越えない
      st.log.forEach((e, i) => {
        if (e.key !== 'act') return;
        const n = e.vars.n as number;
        expect(i + n).toBeLessThan(st.log.length);
        for (const c of st.log.slice(i + 1, i + 1 + n)) expect(['act', 'move', 'turn']).not.toContain(c.key);
        const next = st.log[i + 1 + n];
        if (next) expect(['strike', 'tactic.on', 'hit', 'hit.crit', 'miss', 'tactic.hit']).not.toContain(next.key);
      });
    }
  }, 180000);

  it('shows the same log at three levels of detail', async () => {
    const st = (await battles())[0];
    const view = new BattleLogView();
    const simple = view.html(st, 0), normal = view.html(st, 1), detail = view.html(st, 2);
    // 簡易：これまでの出し方（細かい記録用のキーを除いた、直近60件を1行ずつ）
    const old = st.log.filter((e: BattleLogEntry) => !EXTRA.has(e.key)).slice(-60);
    expect(simple).toBe(old.map((e) => `<div class="${e.key === 'turn' ? 'sep' : ''}">${logText(e).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))}</div>`).join(''));
    expect(simple).not.toContain('命中率');
    // 通常：だれがだれに、体力がいくつからいくつに
    expect(normal).toContain('class="blk');
    expect(normal).toMatch(/体力 \d+→\d+/);
    expect(normal).not.toContain('命中率');
    // 詳細：計算式
    expect(detail).toMatch(/命中率 \d+%/);
    expect(detail).toMatch(/基準 \d+ ＝ 威力\d+ × 攻撃/);
    expect(detail).toMatch(/乱数[01]\.\d{3}/);
    // 表示を変えても、記録の元データは変わらない。切り替えて戻すと同じ表示になる
    expect(view.html(st, 1)).toBe(normal);
    expect(new BattleLogView().html(st, 2)).toBe(detail);
  }, 180000);
});

describe('attack effects', () => {
  it('every skill has an effect, and ranged single-target skills show something flying', () => {
    for (const s of D.skills) {
      expect(inSkillTable(s.id), `${s.id} ${s.name.jp}`).toBe(true);
      const fx = skillFx(s);
      // 射程2以上で単体を狙う技は、飛び道具か、声
      if (s.shape.type === 'single' && s.range[1] >= 2) expect(isProjectile(fx) || fx === 'shout', `${s.id} ${s.name.jp} → ${fx}`).toBe(true);
    }
    // 表に無い技は、射程で決める。武将の通常攻撃も同じ
    for (const c of D.classes) expect(skillFx(skillOf(`atk:${c.id}`))).toBe(c.attack.range[1] >= 2 ? 'arrow' : 'slash');
    for (const t of D.tactics) expect(typeof tacticFx(t)).toBe('string');
    for (const id of D.combat.weather.fireTactics) expect(tacticFx(D.byTactic[id])).toBe('fire');
  });

  it('builds a slash for melee, a projectile for ranged, and a hex-shaped damage note', async () => {
    const seen = new Set<string>();
    for (const st of (await battles()).slice(0, 4)) {
      // 記録を1つの行動ずつに切って、演出を作る（状態は、戦いが終わったあとのもの。位置は写しから取るので壊れない）
      const b = before(st);
      st.log.forEach((e, i) => {
        if (e.key !== 'act' || (e.vars.n as number) === 0) return;
        const part: BattleState = { ...st, log: st.log.slice(i, i + 1 + (e.vars.n as number)) };
        const c = cues(part, { ...b, logLen: 0 }, 1, 1000);
        for (const f of c.fx) {
          seen.add(f.kind === 'proj' || f.kind === 'slash' || f.kind === 'puff' ? `${f.kind}:${f.style}` : f.kind);
          expect(f.dur, f.kind).toBeGreaterThan(0);
          expect(f.t0).toBeGreaterThanOrEqual(1000);
          // ダメージの表示は、どのマスかを持っている
          if (f.kind === 'text') expect(f.cell).toBeGreaterThanOrEqual(0);
        }
        expect(cues(part, { ...b, logLen: 0 }, 0, 1000).fx.length).toBe(0);
      });
    }
    for (const k of ['slash:slash', 'slash:thrust', 'proj:arrow', 'text', 'lunge', 'shake']) expect([...seen], k).toContain(k);
  }, 180000);
});
