import { convert } from '../../src/convert/convert';
import { FIXTURES, loadFixture } from '../../tests/helpers';
for (const f of FIXTURES) {
  const gs = convert(await loadFixture(f));
  const gens = Object.values(gs.generals).filter((g) => g.faction);
  const by = new Map<number, number>();
  for (const g of gens) { const b = Math.floor(g.level / 5) * 5; by.set(b, (by.get(b) ?? 0) + 1); }
  const hi = gens.filter((g) => g.level >= 15);
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(f, [...by].sort((a, b) => a[0] - b[0]).map(([b, n]) => `Lv${b}-${b + 4}:${n}`).join(' '), '| Lv15以上', hi.length, '人の真ん中 体力', med(hi.map((g) => g.stats.hp)), '武力', med(hi.map((g) => g.stats.str)), '知略', med(hi.map((g) => g.stats.int)), '機敏', med(hi.map((g) => g.stats.agi)), '気力', med(hi.map((g) => g.stats.mp)));
}
