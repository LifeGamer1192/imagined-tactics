// 守備兵との戦いと、兵の入れ替えを、実際の画面で確かめる。開発サーバー（5183）が要る。
// 相手の武将を下げて守る武将のいない領を作るところだけ、開発用の入口（window.__campaign）を使う。
// 使い方：node tools/garrison-check.mjs [画面を撮る先のフォルダ]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
// 兵を運ぶ先の武将が見える高さにしておく（実際の画面では、運んでいる間に欄の端へ寄せると欄が送られる）
const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
const idle = () => page.waitForFunction(() => !document.querySelector('.busy'));
await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
await page.click('[data-sample="sengoku_fid5_1575"]');
await page.waitForSelector('#modeNation');
await page.click('#modeNation');
await page.waitForSelector('#campaign');
await idle();
await page.click('#campaign');
await page.waitForSelector('#next');
await idle();

// 兵の入れ替え：兵をつまんで、別の武将の欄へ運ぶ
// （運ぶ先が欄の下のほうで隠れていると、確認の道具ではうまく運べないので、上のほうに並ぶ武将どうしで試す）
const setup = await page.evaluate(async () => {
  const cam = await import('/src/strategy/campaign.ts');
  const s = window.__campaign, c = s.c, gens = cam.generalsAt(c, s.selected, c.player).filter((g) => !g.isLord).slice(0, 4);
  for (const g of gens) while (g.troops.length > 3) g.troops.pop();
  const from = gens.find((g) => g.troops.length >= 2), to = gens.find((g) => g !== from && g.troops.length < 5), full = gens.find((g) => g !== from && g !== to);
  to.command = 999;       // 渡す相手に空きを作る
  full.command = 0;       // 采配力の足りない相手
  s.refresh();
  return { from: from.id, to: to.id, toName: to.name.ja, full: full.id, fullName: full.name.ja };
});
/** 兵をつまんで運ぶ（実際のマウスの動きで） */
const drag = async (from, to) => {
  const a = await (await page.$(from)).boundingBox(), b = await (await page.$(to)).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 24), { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
};
const count = (id) => page.evaluate((id) => window.__campaign.c.gs.generals[id].troops.length, id);
const chip = `[data-troop="${setup.from}"][data-i="0"]`;
ok('兵の名前の横に、小さな兵の絵が出る', !!(await page.$(`${chip} img.uicon`)) && (await page.$eval(`${chip} img.uicon`, (el) => el.complete && el.naturalWidth > 0)));
const n0 = await count(setup.from), t0 = await count(setup.to);
await drag(chip, `.gen[data-gen="${setup.to}"]`);
ok('兵をつまんで別の武将へ運ぶと、渡せる', (await count(setup.from)) === n0 - 1 && (await count(setup.to)) === t0 + 1, `${setup.toName} ${t0} → ${t0 + 1}隊`);
await drag(chip, `.gen[data-gen="${setup.full}"]`);
const msg = (await page.textContent('.toast').catch(() => '')) ?? '';
ok('空きの無い相手に運ぶと、渡せない理由が出る', (await count(setup.from)) === n0 - 1 && /渡せません：.*采配/.test(msg), msg);
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'troop_drag.png') });
// 武将の欄の外（地図の上）へ落とすと、手放すかを聞く
await drag(chip, '.battle canvas');
ok('武将の欄の外へ落とすと、「手放しますか？」と聞かれる', (await page.textContent('.result.ask h2').catch(() => '')) === '手放しますか？');
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'troop_dismiss.png') });
await page.click('.result.ask [data-a="no"]');
ok('「やめる」なら、兵はそのまま', (await count(setup.from)) === n0 - 1 && !(await page.$('.result.ask')));
await drag(chip, '.battle canvas');
await page.click('.result.ask [data-a="yes"]');
ok('「手放す」なら、兵が減る', (await count(setup.from)) === n0 - 2);
await page.evaluate((id) => { const s = window.__campaign; s.c.gs.generals[id].command = 200; s.refresh(); }, setup.full);
// 名前の変更：武将は「✎」、兵は名前を押して出る欄から
await page.click(`[data-rename="${setup.to}"]`);
await page.fill('.result.ask input', '改名太郎');
await page.click('.result.ask [data-a="ok"]');
ok('武将の名前を変えられる', (await page.evaluate((id) => window.__campaign.c.gs.generals[id].name.ja, setup.to)) === '改名太郎' && (await page.textContent(`.gen[data-gen="${setup.to}"]`)).includes('改名太郎'));
const tchip = `[data-troop="${setup.to}"][data-i="0"]`;
await page.click(tchip);
await page.click('[data-tname]');
await page.fill('.result.ask input', '親衛隊');
await page.keyboard.press('Enter');
ok('兵の名前を変えられる', (await page.evaluate((id) => window.__campaign.c.gs.generals[id].troops[0].name, setup.to)) === '親衛隊' && (await page.textContent(tchip)).includes('親衛隊'));
// 兵を武将にする：レベルの足りない兵は選べず、足りる兵は名前を決めて取り立てる
await page.evaluate((id) => { const s = window.__campaign; s.c.gs.generals[id].troops[0].level = 1; s.refresh(); }, setup.to);
await page.click(tchip);
ok('レベルの足りない兵は、武将にできない', await page.$eval('[data-raise]', (b) => b.disabled && /レベル\d+以上/.test(b.title)));
await page.evaluate((id) => { const s = window.__campaign; s.c.gs.generals[id].troops[0].level = 12; s.refresh(); }, setup.to);
const sup0 = await page.evaluate(() => { const c = window.__campaign.c; return c.gs.factions[c.player].supply; });
const gens0 = await page.evaluate(() => Object.keys(window.__campaign.c.gs.generals).length), tt0 = await count(setup.to);
await page.click('[data-raise]');
await page.fill('.result.ask input', '取立次郎');
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'raise_ask.png') });
await page.click('.result.ask [data-a="ok"]');
const raised = await page.evaluate(() => { const g = Object.values(window.__campaign.c.gs.generals).find((x) => x.name.ja === '取立次郎'); return g ? { id: g.id, level: g.level, troops: g.troops.length, traits: g.traits.length, supply: window.__campaign.c.gs.factions[window.__campaign.c.player].supply } : null; });
if (raised) { raised.before = sup0; raised.cost = 100 + 10 * 12; }
ok('兵を武将にすると、同じレベルの武将が加わり、その隊は無くなる', !!raised && raised.level === 12 && raised.troops === 0 && (await count(setup.to)) === tt0 - 1 && (await page.evaluate(() => Object.keys(window.__campaign.c.gs.generals).length)) === gens0 + 1, raised ? `Lv${raised.level}` : '');
ok('兵を武将にすると兵糧が減り、将としての特性を1つ持つ', raised.supply === raised.before - raised.cost && raised.traits === 1, `兵糧 ${raised.before} → ${raised.supply}`);
// 武将を兵にする：確かめる窓が出て、予備兵に加わり、兵糧が3分の2戻る
await page.click(`[data-lower="${raised.id}"]`);
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'lower_ask.png') });
const s1 = await page.evaluate(() => { const c = window.__campaign.c; return c.gs.factions[c.player].supply; });
await page.click('.result.ask [data-a="yes"]');
const lowered = await page.evaluate((id) => { const s = window.__campaign, c = s.c, list = c.reserve[s.selected] ?? [], t = list.at(-1); return { gone: !c.gs.generals[id], n: list.length, name: t?.name, level: t?.level, supply: c.gs.factions[c.player].supply }; }, raised.id);
ok('武将を兵にすると、名前とレベルを持つ兵が予備兵に加わる', lowered.gone && lowered.n === 1 && lowered.name === '取立次郎' && lowered.level === 12, `${lowered.name} Lv${lowered.level}`);
ok('兵糧が、取り立ての費用の3分の2戻る', lowered.supply - s1 === Math.round(raised.cost * 2 / 3), `+${lowered.supply - s1}（費用${raised.cost}）`);
ok('予備兵の欄に、その兵が出る', ((await page.textContent('.gen.reserve')) ?? '').includes('取立次郎'));
// 予備兵を武将へ運ぶと付けられ、武将の兵を予備兵の欄へ運ぶと予備兵になる
const rchip = '.gen.reserve [data-troop][data-i="0"]';
await page.evaluate(() => { document.querySelector('#panel').scrollTop = 0; });
const tt2 = await count(setup.to);
await drag(rchip, `.gen[data-gen="${setup.to}"]`);
ok('予備兵を武将へ運ぶと、付けられる', (await count(setup.to)) === tt2 + 1 && (await page.evaluate(() => (window.__campaign.c.reserve[window.__campaign.selected] ?? []).length)) === 0, `${tt2} → ${await count(setup.to)} ${(await page.textContent('.toast').catch(() => '')) ?? ''}`);
await drag(`[data-troop="${setup.to}"][data-i="0"]`, '.gen.reserve');
ok('武将の兵を予備兵の欄へ運ぶと、予備兵になる', (await count(setup.to)) === tt2 && (await page.evaluate(() => (window.__campaign.c.reserve[window.__campaign.selected] ?? []).length)) === 1);
// 長い名前（100文字）でも、欄が崩れない
await page.evaluate((id) => { const s = window.__campaign; s.c.gs.generals[id].name.ja = '長'.repeat(100); s.c.gs.generals[id].troops[0].name = '名'.repeat(100); s.refresh(); }, setup.to);
const wide = await page.evaluate(() => { const p = document.querySelector('#panel'); return { over: p.scrollWidth - p.clientWidth, max: document.querySelector('input.name') ? 0 : 1 }; });
ok('100文字の名前でも、欄が横にはみ出さない', wide.over <= 1, `はみ出し ${wide.over}px`);
await page.click(`[data-rename="${setup.to}"]`);
ok('名前は100文字まで入れられる', (await page.$eval('.result.ask input', (el) => el.maxLength)) === 100);
await page.fill('.result.ask input', '改名太郎');
await page.click('.result.ask [data-a="ok"]');
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'names.png') });
// 守る武将のいない隣の領を作る（相手の武将を本拠へ下げる）
const spot = await page.evaluate(async () => {
  const s = window.__campaign, c = s.c, gs = c.gs, me = c.player, cam = await import('/src/strategy/campaign.ts');
  let from = -1, to = -1;
  for (const p of gs.provinces.filter((x) => x.owner === me)) {
    const t = cam.neighborsOf(c, p.id).find((n) => { const o = gs.provinces[n].owner; return o && o !== me && gs.factions[o].capital !== n && cam.canAttack(c, me, o); });
    if (t !== undefined) { from = p.id; to = t; break; }
  }
  for (const g of Object.values(gs.generals)) if (g.prov === to) g.prov = gs.factions[g.faction].capital;
  // 自分の武将を、攻め口の領へ集める
  for (const g of cam.generalsAt(c, gs.factions[me].capital, me).slice(0, 4)) g.prov = from;
  s.selected = from; s.refresh();
  // 相手の領に予備兵を置いておく（奪えば手に入ることを確かめる）
  c.reserve[to] = [{ ...Object.values(gs.generals).find((g) => g.troops.length).troops[0], name: '置き土産' }];
  const garrison = cam.garrisonOf(c, to);
  s.selected = to; s.refresh();
  const card = document.querySelector('#panel').textContent;
  s.selected = from; s.refresh();
  const p = gs.provinces[to], r = document.querySelector('.battle canvas').getBoundingClientRect(), [x, y] = s.view.cam.toScreen(p.cx, p.cy);
  return { from, to, name: p.name.ja, garrison, seen: /予備兵 1隊.*置き土産.*奪えば手に入ります/.test(card), card: /守備兵が守ります（Lv\d+・\d+隊）/.test(card), xy: [r.x + x, r.y + y] };
});
ok('相手の領の欄に、予備兵の数が出る', spot.seen);
ok('守る武将のいない領の欄に、守備兵の強さが出る', spot.card, `${spot.name} Lv${spot.garrison.level}・${spot.garrison.troops}隊`);
await page.click('#selTop');
await page.click('#attack');
await page.mouse.click(spot.xy[0], spot.xy[1]);
// 守備兵が相手のときは、「観戦」か「おまかせ」を選ぶ窓が出る
await page.waitForSelector('.result [data-a="watch"]', { timeout: 30000 });
const ask = await page.textContent('.result');
ok('守備兵が相手だと、「観戦」と「おまかせ」を選べる', !!(await page.$('.result [data-a="auto"]')) && !(await page.$('.result [data-a="play"]')) && /守備兵（Lv\d+・\d+隊）/.test(ask));
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'garrison_ask.png') });
await page.click('.result [data-a="watch"]');
await page.waitForSelector('#watch', { timeout: 30000 });
await idle();
const st = await page.evaluate(() => { const a = window.__app; return { watch: document.querySelector('#watch').textContent, end: !!document.querySelector('#end'), def: a.st.units.filter((u) => u.side === 1).map((u) => `${u.name}Lv${u.level}`), names: a.st.sideNames }; });
ok('攻め込むと守備兵との戦いになり、観戦で始まる', st.watch.includes('手動にする') && !st.end && st.def.some((n) => /守備頭|守将/.test(n)), st.def.join('、'));
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'garrison_battle.png') });
// 手動に切り替えると、攻め手（自分）を動かせる
await page.click('[data-speed="0"]');
await page.click('#watch');
await page.waitForFunction(() => !!document.querySelector('#end'), null, { timeout: 60000 });
ok('手動にすると、自分の番で操作できる', !!(await page.$('#end')));
await page.click('#auto'); await page.click('.confirm [data-a="ok"]');
await page.waitForSelector('.result', { timeout: 60000 });
const result = (await page.textContent('.result h2')).trim();
// 結果は、攻め手と守り手に分けて出る
const sides = await page.$$eval('.result .sides .side', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
ok('結果が、攻め手と守り手に分かれて出る', sides.length === 2 && sides[0].startsWith('攻め手') && sides[1].startsWith('守り手') && sides.every((t) => t.includes('倒された武将') && t.includes('失われた兵')), sides.map((t) => t.slice(0, 60)).join(' ／ '));
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'battle_result.png') });
await page.click('.result button');
await page.waitForSelector('#next');
await idle();
const end = await page.evaluate((to) => { const c = window.__campaign.c; return { owner: c.gs.provinces[to].owner, me: c.player, garrisons: Object.keys(c.gs.generals).filter((k) => k.startsWith('garrison:')).length }; }, spot.to);
ok('決着のあと、守備兵は残らない', end.garrisons === 0, result);
const res = await page.evaluate((to) => { const s = window.__campaign; s.selected = to; s.refresh(); return { n: (s.c.reserve[to] ?? []).length, mine: !!document.querySelector('.gen.reserve [data-troop]'), log: document.querySelector('#log').textContent.includes('予備兵1隊を手に入れた') }; }, spot.to);
ok('予備兵は領に残り、領を奪うと自分のものになる（負ければ相手のまま）', res.n === 1 && (result.includes('織田') ? res.mine && res.log : !res.mine), result);
ok('勝てば領が手に入る（負ければそのまま）', result.includes('織田') ? end.owner === end.me : end.owner !== end.me, result);
ok('ページのエラーなし', errors.length === 0, errors.join(' / '));
console.log(ng ? `NG ${ng}件` : 'すべて OK');
await browser.close();
process.exit(ng ? 1 : 0);
