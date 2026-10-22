// 将の詳しい窓：能力・役職・特性・性格・軍略・兵と、列伝（hist-sim の記録・史実の出来事・解説記事・この国モードでの出来事）。

import { personalityLabel, personalityOf } from '../ai/personality';
import type { GGeneral, Taught } from '../convert/model';
import { S } from '../strategy/config';
import { artName, intOf, isMastered, slotsOf } from '../strategy/teach';
import { D, L } from '../data/db';
import { biography } from '../strategy/biography';
import { strengthOf, troopLoad, type Campaign, type CampaignLog } from '../strategy/campaign';
import { classMod, generalPromotions, lowerClasses, MAX_MASTERY } from '../rules/growth';
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
        <h4>兵</h4><div class="small">${g.troops.map((t) => `<span class="trait" data-tip="${esc(unitTip(t.unitId, t.level))}">${esc(t.name ?? L(D.byUnit[t.unitId].name))} Lv${t.level}<span class="dim">・熟練${t.mastery?.[t.unitId] ?? 0}/${MAX_MASTERY}</span></span>`).join('・') || '兵なし'}</div>
      </div>
    </div>
    ${masteryHtml(g)}
    ${taughtHtml(g)}
    <h3>列伝</h3>
    ${bio.facts.map((f) => `<p>${esc(f)}</p>`).join('')}
    ${list('家族', bio.family.map(esc))}${list('在位', bio.reigns.map(esc))}${list('縁', bio.ties.map(esc))}
    ${list('史実の出来事', bio.events.map((e) => `<b>${esc(e.year)}</b>　${esc(e.text)}`))}
    ${list('かかわる話', bio.articles.map((a) => `<b>${esc(a.title)}</b>：${esc(a.text)}`), 2)}
    ${list('この国での出来事', deeds)}
  </div>`;
}

/** 熟練度の欄：役職の道（下から今の役職まで）ごとの熟練度と、何に使うか */
function masteryHtml(g: GGeneral): string {
  const cur = D.byClass[g.classId];
  const path = [...lowerClasses(g.classId).reverse(), cur];
  const others = Object.keys(g.mastery).filter((id) => D.byClass[id] && !path.some((c) => c.id === id)).map((id) => D.byClass[id]);
  const tac = (ids: string[]): string => ids.map((id) => (D.byTactic[id] ? L(D.byTactic[id].name) : id)).join('・');
  const line = (c: typeof cur): string => {
    const m = Math.min(MAX_MASTERY, g.mastery[c.id] ?? 0), full = m >= MAX_MASTERY, now = c.id === cur.id;
    const left = MAX_MASTERY - m;
    const what = full
      ? (c.tactics.length ? `軍略（${tac(c.tactics)}）を持ち越し済み` : '上限')
      : `あと${left}レベルで上限${c.tactics.length ? `。上限で軍略（${tac(c.tactics)}）を持ち越せる` : ''}${now && generalPromotions(g).length ? '。昇進の条件にもなる' : ''}`;
    return `<li><b>${esc(L(c.name))}</b>${now ? ' <span class="tag">今の役職</span>' : ''}　熟練${m}/${MAX_MASTERY}　<span class="dim">${what}</span></li>`;
  };
  return `<h4>熟練度</h4><ul class="small">${[...path, ...others].map(line).join('')}</ul>
    <p class="dim small">熟練度は役職ごとに0〜${MAX_MASTERY}。レベルが1上がるごとに、今の役職の熟練度が1上がる。使い道：① 上限（${MAX_MASTERY}）になると、その役職の軍略を「持ち越し」、役職を変えても使える。② 昇進には、今の役職の熟練度${MAX_MASTERY}が要る（とレベル）。下の役職は経てきたものとして上限になっている。兵の熟練度も兵種ごとに同じように上がる（今は記録だけ）。</p>`;
}

/** 直伝の欄（P68）：教わった技・軍略（借り物・直伝済）と枠。配下の兵の分も */
function taughtHtml(g: GGeneral): string {
  const tag = (x: Taught): string => (isMastered(x) ? '<span class="tmark">伝</span>直伝済' : `<span class="tmark borrow">借</span>借り物（${x.uses}/${S.teach.masterUses}回。気力${Math.round((S.teach.borrowedMpMult - 1) * 100)}%増し）`);
  const row = (x: Taught): string => `<li>${x.kind === 'skill' ? '技' : '軍略'}「${esc(artName(x.id, x.kind))}」　${tag(x)}　<span class="dim">${esc(x.from)}から</span></li>`;
  const troops = g.troops.filter((t) => t.taught?.length).map((t) => `<li>${esc(t.name ?? L(D.byUnit[t.unitId].name))}：${t.taught!.map((x) => `「${esc(artName(x.id, x.kind))}」${isMastered(x) ? '（直伝済）' : `（借り物 ${x.uses}/${S.teach.masterUses}）`}`).join('')}</li>`);
  return `<h4>直伝 <span class="dim small">枠 ${(g.taught ?? []).length}/${slotsOf(g)}（${T.int()}${intOf(g)}で決まる）</span></h4>
    ${g.taught?.length ? `<ul class="small">${g.taught.map(row).join('')}</ul>` : '<p class="small dim">まだ教わったものはありません。</p>'}
    ${troops.length ? `<ul class="small">${troops.join('')}</ul>` : ''}
    <p class="dim small">直伝の枠は${T.int()}で決まる（${S.teach.slotsByInt.map(([max, n], i) => `${i ? `${S.teach.slotsByInt[i - 1][0] + 1}〜` : ''}${max}${i ? '' : '以下'}で${n}`).join('・')}・${S.teach.slotsByInt.at(-1)![0] + 1}以上で${S.teach.maxSlots}）。兵は${S.teach.troopSlots}つ。</p>`;
}
