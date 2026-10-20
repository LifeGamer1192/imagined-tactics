// 将の詳しい窓：能力・役職・特性・性格・軍略・兵と、列伝（hist-sim の記録・史実の出来事・解説記事・この国モードでの出来事）。

import { personalityLabel, personalityOf } from '../ai/personality';
import type { GGeneral } from '../convert/model';
import { D, L } from '../data/db';
import { biography } from '../strategy/biography';
import { strengthOf, troopLoad, type Campaign, type CampaignLog } from '../strategy/campaign';
import { classMod } from '../rules/growth';
import { classTip, commandTip, personalityTip, strengthRank, strengthTip, tacticTip, traitTip, unitTip } from './describe';
import { T, TRAIT_NAME } from './text';

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

const AB = ['政治', '軍事', '外交', '魅力'];

/** 窓の中身（HTML）。fig は後ろ姿の絵、line は国モードの記録を文にする関数 */
export function profileHtml(c: Campaign, g: GGeneral, fig: string, line: (e: CampaignLog) => string): string {
  const cls = D.byClass[g.classId], s = g.stats, m = classMod(cls);
  const pers = personalityOf(g.traits, g.ab), plabel = personalityLabel(pers);
  const bio = biography(c, g);
  const tactics = [...new Set([...cls.tactics, ...g.learned])].map((id) => D.byTactic[id]).filter(Boolean);
  // 長い項目は、はじめの数件だけ見せて、残りは開いて読む
  const list = (title: string, items: string[], show = 6): string => {
    if (!items.length) return '';
    const li = (xs: string[]): string => xs.map((x) => `<li>${x}</li>`).join('');
    const rest = items.slice(show);
    return `<h4>${title}</h4><ul>${li(items.slice(0, show))}</ul>${rest.length ? `<details class="pf-more"><summary>ほか${rest.length}件</summary><ul>${li(rest)}</ul></details>` : ''}`;
  };
  const deeds = c.log.filter((e) => Object.values(e.vars).some((v) => v === g.name.ja)).slice(-12).map((e) => esc(line(e)));
  const row = (k: string, v: string | number): string => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const allStr = Object.values(c.gs.generals).filter((x) => x.faction).map(strengthOf);
  return `<div class="profile">
    <div class="pf-head">${fig}<div>
      <div class="pf-name">${esc(g.name.ja)}${g.isLord ? ' <span class="tag">当主</span>' : ''}</div>
      <div class="dim">${esc(c.gs.factions[g.faction]?.name.ja ?? '浪人')}・<span class="trait" data-tip="${esc(classTip(g.classId))}">${L(cls.name)}</span> Lv${g.level}・${g.age}歳</div>
      <div class="small"><span class="trait" data-tip="${esc(personalityTip(pers, plabel))}">性格：${plabel}</span>${g.traits.length ? `　特性：${g.traits.map((t) => `<span class="trait" data-tip="${esc(traitTip(t))}">${TRAIT_NAME[t] ?? t}</span>`).join('・')}` : ''}</div>
    </div></div>
    <div class="pf-cols">
      <table class="pf-stats">
        ${row(T.hp(), s.hp + m.hp)}${row(T.mp(), s.mp + m.mp)}${row(T.str(), s.str + m.str)}${row(T.int(), s.int + m.int)}${row(T.agi(), s.agi + m.agi)}
        ${row('<span class="trait" data-tip="' + esc(commandTip(troopLoad(g), g.command, g.commandRange)) + '">采配</span>', `${troopLoad(g)}／${g.command}（範囲${g.commandRange}）`)}${row('<span class="trait" data-tip="' + esc(strengthTip(strengthOf(g), allStr)) + '">強さ</span>', `${Math.round(strengthOf(g))}（${strengthRank(strengthOf(g), allStr).word}）`)}
        ${row('伸び', `${T.str()}${g.growth.str}・${T.int()}${g.growth.int}・${T.agi()}${g.growth.agi}`)}
        ${row('もとの能力', g.ab.map((v, i) => `${AB[i]}${v}`).join('・'))}
      </table>
      <div>
        <h4>軍略</h4><div class="small">${tactics.map((t) => `<span class="trait" data-tip="${esc(tacticTip(t))}">${L(t.name)}（気力${t.mp}）</span>`).join('・') || 'なし'}</div>
        <h4>兵</h4><div class="small">${g.troops.map((t) => `<span class="trait" data-tip="${esc(unitTip(t.unitId, t.level))}">${esc(t.name ?? L(D.byUnit[t.unitId].name))} Lv${t.level}</span>`).join('・') || '兵なし'}</div>
      </div>
    </div>
    <h3>列伝</h3>
    ${bio.facts.map((f) => `<p>${esc(f)}</p>`).join('')}
    ${list('家族', bio.family.map(esc))}${list('在位', bio.reigns.map(esc))}${list('縁', bio.ties.map(esc))}
    ${list('史実の出来事', bio.events.map((e) => `<b>${esc(e.year)}</b>　${esc(e.text)}`))}
    ${list('かかわる話', bio.articles.map((a) => `<b>${esc(a.title)}</b>：${esc(a.text)}`), 2)}
    ${list('この国での出来事', deeds)}
  </div>`;
}
