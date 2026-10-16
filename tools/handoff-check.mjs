// 公開版どうしの受け渡しの確認：hist-sim の「この状態で hex で遊ぶ」を押して、hex-sim がモードを選ぶ画面まで進み、戦闘と戦略を始められるかを見る。
// 使い方：node tools/handoff-check.mjs [画面を撮る先のフォルダ]
//   HIST_URL（既定：公開版の hist-sim）、シナリオや世界の指定は URL の引数で渡す
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const HIST = process.env.HIST_URL ?? 'https://lifegamer1192.github.io/imagined-chronicles/';
const HEX = 'https://lifegamer1192.github.io/imagined-tactics/';
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
for (const [label, query] of [['架空の世界', '?seed=DEMO&size=small&template=continents'], ['日本語の表示', '?seed=DEMO2&size=small&template=archipelago&lang=ja']]) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('hist: ' + e.message));
  await page.goto(HIST + query, { waitUntil: 'load' });
  await page.waitForSelector('#busy[hidden]', { state: 'attached', timeout: 120000 });
  await page.waitForTimeout(800);
  await page.click('#savesBtn');
  await page.waitForSelector('#saves:not([hidden])');
  const btn = await page.$('#saves .hex');
  ok(`${label}：公開版の hist-sim にボタンがある`, !!btn, btn ? (await btn.textContent()).trim() : '');
  if (!btn) { await ctx.close(); continue; }
  if (out) await page.screenshot({ path: path.join(out, `handoff_hist_${label}.png`) });
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#saves .hex')]);
  popup.on('pageerror', (e) => errors.push('hex: ' + e.message));
  await popup.waitForLoadState('domcontentloaded');
  ok(`${label}：公開版の hex-sim が開く`, popup.url().startsWith(HEX), popup.url());
  let reached = true;
  try { await popup.waitForSelector('#modeNation', { timeout: 40000 }); } catch { reached = false; }
  ok(`${label}：セーブが渡り、モードを選ぶ画面まで進む`, reached, reached ? (await popup.textContent('header')).replace(/\s+/g, ' ').slice(0, 60) : (await popup.textContent('body')).replace(/\s+/g, ' ').slice(0, 120));
  if (reached) {
    if (out) await popup.screenshot({ path: path.join(out, `handoff_hex_${label}.png`) });
    await popup.click('#modeNation');
    await popup.waitForSelector('#campaignWatch');
    await popup.click('#campaignWatch');
    let strat = true;
    try { await popup.waitForSelector('#next', { timeout: 30000 }); } catch { strat = false; }
    ok(`${label}：渡った状態から戦略を始められる`, strat);
    if (strat) {
      await popup.waitForTimeout(1500);
      if (out) await popup.screenshot({ path: path.join(out, `handoff_strategy_${label}.png`) });
      await popup.click('#next');
      await popup.waitForTimeout(1500);
      ok(`${label}：月を進められる`, /1か月/.test(await popup.textContent('#panel')));
    }
  }
  ok(`${label}：ページのエラーなし`, errors.length === 0, errors.slice(0, 3).join(' / '));
  await ctx.close();
}
console.log(ng ? `NG ${ng}件` : 'すべて OK');
await browser.close();
process.exit(ng ? 1 : 0);
