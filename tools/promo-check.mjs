// 昇進の窓（P85）の確認：新しく覚える技・軍略の細かな説明と、最大の気力に対する気力のバーが出るか。PC とスマホで撮る。
// 開発サーバー（5183）を動かしてから実行する。使い方：node tools/promo-check.mjs [撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
const { defaultBrowserType, ...phone } = devices['iPhone 13'];
for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', phone]]) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const touch = !!opts.hasTouch;
  const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
  const shot = async (name) => { if (out) { await page.waitForTimeout(200); await page.screenshot({ path: path.join(out, `promo_${tag}_${name}.png`) }); } };
  /** 窓が横にはみ出していないか */
  const fits = (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1; });
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await press('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeNation');
  await press('#modeNation');
  await page.waitForSelector('#campaign');
  await press('#campaign');
  await page.waitForSelector('#next');
  // 本拠の将を1人、軍略が増える昇進ができるようにする。当主の兵はレベルを上げて昇格できるようにする
  const who = await page.evaluate(async () => {
    const s = window.__campaign, c = s.c, f = c.gs.factions[c.player];
    const { D } = await import('/src/data/db.ts');
    const { MAX_MASTERY } = await import('/src/rules/growth.ts');
    const gens = Object.values(c.gs.generals).filter((g) => g.faction === c.player && g.prov === f.capital && !g.isLord);
    const g = gens.find((x) => D.classes.some((k) => k.from === x.classId && k.tactics.some((t) => !D.byClass[x.classId].tactics.includes(t)))) ?? gens[0];
    g.level = 99; g.mastery[g.classId] = MAX_MASTERY;
    const lord = c.gs.generals[f.lordId];
    lord.command = 999; lord.troops.forEach((t) => { t.level = 30; });
    // 1隊めは、昇格で技・軍略が増える兵種にする（品の要らないもの）
    const basic = (id) => id.startsWith('atk:') || !!D.skills.find((k) => k.id === id)?.basic;
    const u = D.units.find((x) => x.promote.some((p) => !p.item && D.byUnit[p.to] && [...D.byUnit[p.to].skills, ...D.byUnit[p.to].tactics].some((y) => !basic(y) && !x.skills.includes(y) && !x.tactics.includes(y))));
    if (u && lord.troops[0]) lord.troops[0].unitId = u.id;
    s.selected = f.capital; s.refresh();
    return g.id;
  });
  // 武将の昇進
  await page.$eval(`[data-promo-ask="${who}"]`, (el) => el.scrollIntoView({ block: 'center' }));
  await press(`[data-promo-ask="${who}"]`);
  await page.waitForSelector('.confirm');
  await shot('1_general_ask');
  const ask = await page.evaluate(() => ({ arts: !!document.querySelector('.confirm .cc-arts'), bars: document.querySelectorAll('.confirm .art-card.new .mpbar, .confirm .art-card.new .mpcap').length, text: document.querySelector('.confirm .cc-arts')?.textContent ?? '' }));
  ok(`[${tag}] 武将の昇進の窓に、新しく覚える軍略の説明と気力のバー`, ask.arts && ask.bars > 0 && /1戦で\d+回/.test(ask.text) && /対象：/.test(ask.text), ask.text.slice(0, 80).replace(/\s+/g, ' '));
  ok(`[${tag}] 武将の昇進の窓が横にはみ出さない`, await fits('.confirm'));
  await page.$eval('.confirm .cc-arts', (el) => el.scrollIntoView({ block: 'start' }));
  await shot('2_general_arts');
  await press('.confirm [data-a="ok"]');
  await page.waitForSelector('.cc-box');
  ok(`[${tag}] 祝いの窓にも、新しく覚えた技・軍略`, /新しく覚えた技・軍略/.test(await page.textContent('.cc-box')));
  await page.$eval('.cc-box .cc-arts', (el) => el.scrollIntoView({ block: 'start' }));
  await shot('3_general_party');
  await press('.cc-box [data-a="ok"]');
  // 兵の昇格
  // 技・軍略が増える昇格を選ぶ（無ければ最初の）
  const up = await page.evaluate(async () => {
    const { D } = await import('/src/data/db.ts');
    const bs = [...document.querySelectorAll('[data-up-ask]')];
    const gain = (b) => { const g = window.__campaign.c.gs.generals[b.dataset.upAsk], t = g.troops[Number(b.dataset.i)], a = D.byUnit[t.unitId], n = D.byUnit[b.dataset.to]; return [...n.skills, ...n.tactics].some((x) => !D.skills.find((k) => k.id === x)?.basic && !a.skills.includes(x) && !a.tactics.includes(x)); };
    const b = bs.find(gain) ?? bs[0];
    b.id = 'upPick';
    return !!b;
  });
  ok(`[${tag}] 兵の昇格のボタンがある`, up);
  await page.$eval('#upPick', (el) => el.scrollIntoView({ block: 'center' }));
  await press('#upPick');
  await page.waitForSelector('.confirm');
  const t = await page.evaluate(() => ({ arts: !!document.querySelector('.confirm .cc-arts'), text: document.querySelector('.confirm .cc-arts')?.textContent ?? '' }));
  ok(`[${tag}] 兵の昇格の窓に、新しく覚える技・軍略と気力のバー`, t.arts && /1戦で\d+回|気力を使わない/.test(t.text), t.text.slice(0, 80).replace(/\s+/g, ' '));
  ok(`[${tag}] 兵の昇格の窓が横にはみ出さない`, await fits('.confirm'));
  await page.$eval('.confirm .cc-arts', (el) => el.scrollIntoView({ block: 'start' }));
  await shot('4_troop_arts');
  await press('.confirm [data-a="no"]');
  ok(`[${tag}] ページのエラーなし`, errors.length === 0, errors.join(' / '));
  await context.close();
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
