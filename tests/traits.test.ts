// 特性の効き目（P56）：将と配下のすべての兵に効く。％の増減・2回行動・軍略の気力・普請と徴兵の費用
import { describe, expect, it } from 'vitest';
import { createBattle } from '../src/battle/setup';
import { parseMap } from '../src/battle/map';
import type { BUnit } from '../src/battle/types';
import { convert, generalsOf } from '../src/convert/convert';
import { D } from '../src/data/db';
import { tacticCost } from '../src/rules/combat';
import { traitMods } from '../src/rules/traits';
import { buildCost, newCampaign, recruitCost, recruitCostFor } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

const OPEN = Array.from({ length: 9 }, () => '. . . . . . . . . . . . .').join('\n');

async function world() {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  const gens = generalsOf(gs, f.id).filter((g) => g.troops.length >= 2);
  return { save, gs, f, g: gens[0], foe: generalsOf(gs, Object.values(gs.factions).find((x) => x.id !== f.id && generalsOf(gs, x.id).length)!.id)[0] };
}
/** 同じ武将を、特性だけ変えて戦場に出したときの駒（将と兵） */
function unitsWith(gs: Awaited<ReturnType<typeof world>>['gs'], gid: string, foe: string, traits: string[]): BUnit[] {
  const g = gs.generals[gid], keep = g.traits;
  g.traits = traits;
  const st = createBattle(gs, { ...parseMap(OPEN), spawn: [[...Array(30).keys()], [...Array(30).keys()].map((i) => 116 - i)] } as never, [[gid], [foe]], 'traits');
  g.traits = keep;
  return st.units.filter((u) => u.generalId === gid);
}

describe('trait effects (P56)', () => {
  it('percent stat changes apply to the general and every troop under them', async () => {
    const { gs, g, foe } = await world();
    const base = unitsWith(gs, g.id, foe.id, []), brave = unitsWith(gs, g.id, foe.id, ['brave']), wise = unitsWith(gs, g.id, foe.id, ['wise']);
    expect(base.length).toBeGreaterThanOrEqual(3);
    base.forEach((u, i) => {
      expect(brave[i].str).toBe(Math.max(1, Math.round(u.str * 1.12)));
      expect(wise[i].int).toBe(Math.max(1, Math.round(u.int * 1.15)));
      expect(brave[i].passives.some((p) => p.type === 'counterDamage' && p.pct === 20)).toBe(true);
    });
  });

  it('pious heals +30%, cruel crit +15, genius mp +40%, generous counter -20%', async () => {
    const { gs, g, foe } = await world();
    const base = unitsWith(gs, g.id, foe.id, []);
    const pious = unitsWith(gs, g.id, foe.id, ['pious']), cruel = unitsWith(gs, g.id, foe.id, ['cruel']), genius = unitsWith(gs, g.id, foe.id, ['genius']), gen = unitsWith(gs, g.id, foe.id, ['generous']);
    pious.forEach((u) => expect(u.healPct).toBe(30));
    cruel.forEach((u) => expect(u.critPct).toBe(15));
    genius.forEach((u, i) => { if (base[i].maxMp > 0) expect(u.maxMp).toBe(Math.round(base[i].maxMp * 1.4)); });
    gen.forEach((u) => expect(u.passives.some((p) => p.type === 'counterDamage' && p.pct === -20)).toBe(true));
  });

  it('unifier gives every unit two actions; ambitious +1 move; sickly -15% hp', async () => {
    const { gs, g, foe } = await world();
    const base = unitsWith(gs, g.id, foe.id, []);
    unitsWith(gs, g.id, foe.id, ['unifier']).forEach((u) => expect(u.passives.some((p) => p.type === 'doubleAct')).toBe(true));
    unitsWith(gs, g.id, foe.id, ['ambitious']).forEach((u, i) => expect(u.move).toBe(base[i].move + 1));
    unitsWith(gs, g.id, foe.id, ['sickly']).forEach((u, i) => expect(u.maxHp).toBe(Math.round(base[i].maxHp * 0.85)));
  });

  it('kind cuts support tactic cost by 30%, content cuts every tactic by 15%', () => {
    const heal = D.tactics.find((t) => t.kind === 'heal' && t.mp >= 10)!, dmg = D.tactics.find((t) => t.kind === 'damage' && t.mp >= 10)!;
    const kind = traitMods(['kind']), content = traitMods(['content']);
    const u = (m: ReturnType<typeof traitMods>) => ({ mpCostPct: m.mpCostPct, supportMpCostPct: m.supportMpCostPct }) as BUnit;
    expect(tacticCost(u(kind), heal)).toBe(Math.round(heal.mp * 0.7));
    expect(tacticCost(u(kind), dmg)).toBe(dmg.mp);
    expect(tacticCost(u(content), dmg)).toBe(Math.round(dmg.mp * 0.85));
  });

  it('a builder in the province halves build cost; a reformer (or reformer lord) halves recruit cost', async () => {
    const { save, gs, f } = await world();
    const c = newCampaign(gs, save.world, f.id);
    const prov = f.capital, here = Object.values(gs.generals).filter((x) => x.prov === prov && x.faction === f.id);
    for (const x of here) x.traits = x.traits.filter((t) => t !== 'builder');
    const full = buildCost(c, prov, 'fort');
    here[0].traits = [...here[0].traits, 'builder'];
    expect(buildCost(c, prov, 'fort')).toBe(Math.round(full * 0.5));
    const lord = gs.generals[f.lordId], other = here.find((x) => x.id !== lord.id)!;
    lord.traits = lord.traits.filter((t) => t !== 'reformer'); other.traits = other.traits.filter((t) => t !== 'reformer');
    const u = 'u01a', normal = recruitCost(u, f, false);
    expect(recruitCostFor(c, other, u)).toBe(normal);
    other.traits.push('reformer');
    expect(recruitCostFor(c, other, u)).toBe(Math.round(normal * 0.5));
    other.traits.pop(); lord.traits.push('reformer');
    expect(recruitCostFor(c, other, u)).toBe(Math.round(normal * 0.5));
  });
});
