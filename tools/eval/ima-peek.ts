import { readFileSync } from 'node:fs';
import { applyIma, imaRealm, readImaFile } from '../../src/bridge/imarpg';
import { convert, strengthOf } from '../../src/convert/convert';
import { D, L, setVariant } from '../../src/data/db';
const file = await readImaFile(new Blob([readFileSync(process.argv[2] ?? 'tests/fixtures/ima_test_troops.imarpg')]));
setVariant('cn');
const gs = convert(file.save, { variant: 'cn' });
const realm = imaRealm(file.game);
const res = applyIma(gs, file.game, 'cn', { faction: realm, king: true });
for (const id of [res.heroId, ...res.companionIds]) {
  const g = gs.generals[id!];
  console.log(g.name.ja, L(D.byClass[g.classId].name), 'Lv', g.level, JSON.stringify(g.stats), '采配', g.command, '範囲', g.commandRange, '特性', g.traits.join('・'), '技', (g.skills ?? []).map((s) => L(D.bySkill[s].name)).join('・'), '軍略', g.learned.map((x) => L(D.byTactic[x].name)).join('・'), '兵', g.troops.map((t) => `${L(D.byUnit[t.unitId].name)}${t.level}`).join('・'));
}
console.log(gs.factions[realm].name.ja, res.notes.join(' / '), '予備', res.reserve.length);
const lords = Object.values(gs.generals).filter((g) => g.faction === realm).sort((a, b) => b.level - a.level).slice(0, 4).map((g) => `${g.name.ja}Lv${g.level}${g.isLord ? '(当主)' : ''}`);
console.log('同じ国の上位', lords.join('、'));
