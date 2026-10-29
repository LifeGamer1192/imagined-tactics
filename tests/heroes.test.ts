// 名将（P102）：天佑・特別技・特別軍略の割り当てと、天佑の発動・効き目・消え方
import { describe, expect, it } from 'vitest';
import { apply } from '../src/battle/engine';
import { mapFromProvince } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import { convert } from '../src/convert/convert';
import { BOONS, HEROES } from '../src/convert/heroes';
import { fromJSON, restore, snapshot, toJSON } from '../src/persist/save';
import { unitFx } from '../src/rules/combat';
import { moveOf, skillOf } from '../src/rules/stats';
import { newCampaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

const byName = (gs: ReturnType<typeof convert>, n: string) => Object.values(gs.generals).find((g) => (g.recordName ?? g.name.ja) === n)!;

describe('who are the great generals', () => {
  it('the list names them; others at the top of fame get a boon by ties and traits; every boon has a condition', async () => {
    for (const b of Object.values(BOONS)) expect(b.cond.length, b.name.jp).toBeGreaterThan(0);
    const gs = convert(await loadFixture('sengoku_fid5_1575'));
    expect(byName(gs, '真田昌幸').hero).toEqual({ boon: 'shubi_meisho', tactic: 't004' });
    expect(byName(gs, '本多忠勝').hero).toEqual({ boon: 'muki_mosho', skill: 's001' });
    const all = Object.values(gs.generals), heroes = all.filter((g) => g.hero);
    expect(heroes.length).toBeGreaterThan(5);
    expect(heroes.length / all.length).toBeLessThan(0.15);
    for (const g of heroes) expect(BOONS[g.hero!.boon!], g.name.ja).toBeTruthy();
    // 名簿の名前は、その世界の人物にいる
    for (const p of HEROES.people.filter((x) => x.scenario === 'sengoku')) expect(byName(gs, p.name), p.name).toBeTruthy();
  });

  it('old saves get them when loaded', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    delete gs.heroes; for (const g of Object.values(gs.generals)) delete g.hero;
    const c = newCampaign(gs, save.world, 0);
    const back = restore(fromJSON(toJSON(snapshot(c))));
    expect(byName(back.gs, '真田昌幸').hero?.boon).toBe('shubi_meisho');
  });
});

describe('boons in battle', () => {
  const battle = async (defenderBoon: string) => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const hero = byName(gs, '真田昌幸');
    hero.hero = { boon: defenderBoon, tactic: 't004' };
    const foe = byName(gs, '織田信長');
    const map = mapFromProvince(save.world, gs.factions[hero.faction].capital, { capital: true, fort: 0.6 });
    // 攻め手に信長（Lv25、真田昌幸より格上）、守り手に真田昌幸
    const st = createBattle(gs, map, [[foe.id], [hero.id]], 'boon');
    return { st, gs, hero, foe };
  };

  it('fires when every condition holds: big opening volley that never kills, enemy attack −10% and ally move +1 while the holder lives', async () => {
    const { st } = await battle('shubi_meisho');
    const b = st.boons?.find((x) => x.id === 'shubi_meisho');
    expect(b).toBeTruthy();
    expect(b!.met.join(' ')).toMatch(/守る側/);
    expect(b!.met.join(' ')).toMatch(/格上の敵：織田信長/);
    const hits = st.log.filter((e) => e.key === 'boonHit');
    expect(hits.length).toBe(st.units.filter((u) => u.side === 0).length);
    for (const u of st.units.filter((x) => x.side === 0)) expect(u.hp).toBeGreaterThanOrEqual(1);
    const atk = st.units.find((u) => u.side === 0 && u.kind === 'troop')!, def = st.units.find((u) => u.side === 1 && u.kind === 'troop')!;
    expect(Object.entries(Object.fromEntries(unitFx(st, atk, def, false))).find(([k]) => k.startsWith('天佑の攻撃'))?.[1]).toBeCloseTo(0.9, 6);
    expect(moveOf(def)).toBe(def.move + 1);
    // 持ち主が倒れると消える
    const holder = st.units[b!.uid];
    holder.hp = 1;
    const killer = st.units.find((u) => u.side === 0 && u.alive)!;
    killer.pos = st.map.grid.neighbors(holder.pos).find((i) => !st.units.some((u) => u.alive && u.pos === i))!;
    killer.passives.push({ type: 'hit', pct: 500 }); killer.acted = false; killer.moved = false; st.turn = 0;
    const basic = killer.skills.map(skillOf).find((s) => s.basic && s.range[0] <= 1)!;
    apply(st, { type: 'skill', unit: killer.id, skill: basic.id, target: holder.pos });
    expect(holder.alive).toBe(false);
    expect(st.log.some((e) => e.key === 'boonEnd')).toBe(true);
    expect(def.bmod).toBeUndefined();
    expect(moveOf(def)).toBe(def.move);
  });

  it('does not fire when a condition fails (an attack-only boon on the defending side)', async () => {
    const { st } = await battle('jinto');
    expect(st.boons ?? []).toEqual([]);
    expect(st.log.some((e) => e.key === 'boon')).toBe(false);
  });

  it('special arts are added to the holder in battle', async () => {
    const { st } = await battle('shubi_meisho');
    const g = st.units.find((u) => u.kind === 'general' && u.side === 1)!;
    expect(g.tactics).toContain('t004');
  });
});
