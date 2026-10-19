// 見本のセーブで、ある特性を持つ武将を並べる。使い方：npx vite-node tools/eval/trait-list.ts [特性=unifier]
import { convert } from '../../src/convert/convert';
import { FIXTURES, loadFixture } from '../../tests/helpers';

const trait = process.argv[2] ?? 'unifier';
for (const name of FIXTURES) {
  const save = await loadFixture(name), gs = convert(save);
  const list = Object.values(gs.generals).filter((g) => g.traits.includes(trait))
    .map((g) => `${g.name.ja}（${gs.factions[g.faction]?.name.ja ?? '浪人'}${g.isLord ? '・当主' : ''}・Lv${g.level}）`);
  console.log(`${name}：${list.length ? list.join('、') : 'なし'}`);
}
