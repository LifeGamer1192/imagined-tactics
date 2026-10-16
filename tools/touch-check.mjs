// スマホの画面で、指で兵をつまんで運べるかを確かめる。開発サーバー（5183）が要る。
// 指の動きは、ブラウザに本物のタッチとして送る（マウスの動きでは、指のときだけ起きる不具合が見えない）。
// 使い方：node tools/touch-check.mjs [画面を撮る先のフォルダ]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium, devices } = require('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
const idle = () => page.waitForFunction(() => !document.querySelector('.busy'));
await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
await page.tap('[data-sample="sengoku_fid5_1575"]');
await page.waitForSelector('#modeNation');
await page.tap('#modeNation');
await page.waitForSelector('#campaign');
await idle();
await page.tap('#campaign');
await page.waitForSelector('#next');
await idle();
const setup = await page.evaluate(async () => {
  const cam = await import('/src/strategy/campaign.ts');
  const s = window.__campaign, c = s.c, gens = cam.generalsAt(c, s.selected, c.player).filter((g) => !g.isLord);
  for (const g of gens) while (g.troops.length > 3) g.troops.pop();
  const from = gens.find((g) => g.troops.length >= 2), to = gens.find((g) => g !== from), far = gens.at(-1);
  to.command = 999; far.command = 999;
  s.refresh();
  return { from: from.id, to: to.id, far: far.id, n: gens.length };
});
const count = (id) => page.evaluate((id) => window.__campaign.c.gs.generals[id].troops.length, id);
const box = async (sel) => { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); return el.boundingBox(); };
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
/** 指でつまんで運ぶ。to が関数なら、運んでいる途中の位置を返す（欄が送られるのを待つとき） */
const drag = async (from, target, hold = 0) => {
  const a = await box(from);
  const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2;
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', x0 + i * 4, y0 + i * 4); await page.waitForTimeout(16); }
  let b = await target();
  for (let i = 1; i <= 8; i++) { await touch('touchMove', x0 + (b.x - x0) * i / 8, y0 + (b.y - y0) * i / 8); await page.waitForTimeout(16); }
  // 運ぶ先が見えるまで、その場で待つ（欄の端にいれば、欄が送られていく）
  for (let t = 0; t < hold; t += 100) { await page.waitForTimeout(100); const nb = await target(); const moved = nb.x !== b.x || nb.y !== b.y; b = nb; await touch('touchMove', b.x, b.y); if (moved) break; }
  await page.waitForTimeout(60); b = await target(); await touch('touchMove', b.x, b.y); await page.waitForTimeout(30);
  const ghost = !!(await page.$('.chip.ghost'));
  await touch('touchEnd', b.x, b.y);
  await page.waitForTimeout(200);
  return ghost;
};
const mid = (sel) => async () => { const b = await (await page.$(sel)).boundingBox(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 24) }; };
const chip = `[data-troop="${setup.from}"][data-i="0"]`;
ok('兵の名前は、指で触っても画面が送られない設定になっている', (await page.$eval(chip, (el) => getComputedStyle(el).touchAction)) === 'none');
const n0 = await count(setup.from), t0 = await count(setup.to);
const ghost = await drag(chip, mid(`.gen[data-gen="${setup.to}"]`));
ok('指でつまむと、運んでいる兵が指に付いてくる', ghost);
ok('指で別の武将へ運ぶと、渡せる', (await count(setup.from)) === n0 - 1 && (await count(setup.to)) === t0 + 1);
ok('運んだあとに、入れ替えの欄が開かない', !(await page.$('.tmenu, [data-tclose]')));
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'touch_drag.png') });
// 指で軽く触るだけなら、これまでどおり欄が開く
await page.tap(chip);
ok('軽く触ると、兵の欄が開く', !!(await page.$('[data-tclose]')));
await page.tap('[data-tclose]');
// 欄の下の端で止めると欄が送られ、隠れていた武将へ運べる
const panel = await page.evaluate(() => { const p = document.querySelector('#panel'), r = p.getBoundingClientRect(); p.scrollTop = 0; return { x: r.x + r.width / 2, bottom: r.bottom, canScroll: p.scrollHeight > p.clientHeight + 40 }; });
if (panel.canScroll && setup.far !== setup.to) {
  const f0 = await count(setup.far), n1 = await count(setup.from);
  let top0 = 0;
  await drag(chip, async () => {
    const b = await (await page.$(`.gen[data-gen="${setup.far}"]`)).boundingBox();
    const y = b.y + 20;
    // 運ぶ先がまだ欄の下に隠れているあいだは、欄の下の端で待つ
    return y > panel.bottom - 40 ? { x: panel.x, y: panel.bottom - 12 } : { x: b.x + b.width / 2, y };
  }, 20000);
  top0 = await page.evaluate(() => document.querySelector('#panel').scrollTop);
  ok('欄の端で止めると欄が送られ、隠れていた武将へ運べる', (await count(setup.far)) === f0 + 1 && (await count(setup.from)) === n1 - 1, `欄の送り ${Math.round(top0)}`);
} else console.log('--  欄が画面に収まっているので、送りの確認は省いた');
// 武将の欄の外へ落とすと、手放すかを聞く
await page.evaluate(() => { document.querySelector('#panel').scrollTop = 0; });
await drag(chip, async () => { const r = await (await page.$('.battle canvas')).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
ok('指で武将の欄の外へ落とすと、「手放しますか？」と聞かれる', (await page.textContent('.result.ask h2').catch(() => '')) === '手放しますか？');
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'touch_dismiss.png') });
await page.tap('.result.ask [data-a="no"]');
ok('ページのエラーなし', errors.length === 0, errors.join(' / '));
console.log(ng ? `NG ${ng}件` : 'すべて OK');
await browser.close();
process.exit(ng ? 1 : 0);
