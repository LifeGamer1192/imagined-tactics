// 兵種の対応表（docs/20_兵種の対応表.md）を作る：系統ごとに、日本版・中国版・西洋版の名前と駒の絵を横に並べる。
// 兵種や西洋の名前（data/system/west.json）、駒の絵を変えたら実行する。使い方：node tools/unit-table.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const units = JSON.parse(readFileSync('data/system/units.json', 'utf8'));
const west = JSON.parse(readFileSync('data/system/west.json', 'utf8')).units;
const list = Array.isArray(units) ? units : units.units;
const LINE = {
  1: '歩兵', 2: '鼓舞（楽隊）', 3: '小舟', 4: '鉄砲・弩・投石', 5: '忍び・刺客', 6: '弓', 7: '軽騎兵', 8: '回復',
  9: '盾', 10: '城攻め（工兵・攻城兵器）', 11: '大刀・斧', 12: '山岳', 13: '騎馬武者・戦車・重騎兵', 14: '伏兵', 15: '火攻め', 16: '大船', 17: '指揮', 18: '調略', 19: '槍', 20: '長槍', 21: '戟・薙刀',
};
const TIER = { 1: '下級', 2: '中級', 3: '上級' };
const pic = (set, id) => (existsSync(`public/art/unit/${set}/${id}.webp`) ? `<img src="../public/art/unit/${set}/${id}.webp" width="56" alt="">` : '（絵なし）');
const cell = (set, id, name) => `${pic(set, id)}<br>${name}`;
const byId = Object.fromEntries(list.map((u) => [u.id, u]));
const out = [
  '# 兵種の対応表',
  '',
  '同じ番号の兵種は、名前と絵が違うだけで、能力・技・軍略・昇格はすべて同じ。どの版の名前で出るかは世界で決まる（日本の戦国は日本版、中国の世界は中国版、ローマは西洋版）。',
  '西洋版の名前は `data/system/west.json`、駒の絵は `public/art/unit/<jp|cn|west>/`。この表は `node tools/unit-table.mjs` で作る（手で直さない）。',
  '',
  `西洋版の絵：${list.filter((u) => existsSync(`public/art/unit/west/${u.id}.webp`)).length}／${list.length}種。絵の無い兵種は、戦場では名前の字の駒で描く。`,
  '',
];
for (const line of [...new Set(list.map((u) => u.line))]) {
  out.push(`## 系統${line}：${LINE[line] ?? ''}`, '', '| 番号 | 格 | 日本版 | 中国版 | 西洋版 | 昇格先 |', '|---|---|:-:|:-:|:-:|---|');
  for (const u of list.filter((x) => x.line === line)) {
    const up = (u.promote ?? []).map((p) => `${p.to}（${byId[p.to]?.name.jp ?? ''}／${byId[p.to]?.name.cn ?? ''}／${west[p.to] ?? ''}）`).join('<br>') || '—';
    out.push(`| ${u.id} | ${TIER[u.tier] ?? u.tier} | ${cell('jp', u.id, u.name.jp)} | ${cell('cn', u.id, u.name.cn)} | ${cell('west', u.id, west[u.id] ?? '（未定）')} | ${up} |`);
  }
  out.push('');
}
writeFileSync('docs/20_兵種の対応表.md', out.join('\n'));
console.log(`docs/20_兵種の対応表.md：${list.length}種`);
