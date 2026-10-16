// 画面の重さを測る（開発サーバー 5183 が要る。開発用の入口を使う）。速くする作業の前後で比べるための道具。
// 使い方：node tools/perf.mjs [見本の名前=sengoku_fid5_1575]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const sample = process.argv[2] ?? 'sengoku_fid5_1575';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
const idle = () => page.waitForFunction(() => !document.querySelector('.busy'));
let t0 = Date.now();
await page.goto('http://localhost:5183/');
await page.click(`[data-sample="${sample}"]`);
await page.waitForSelector('#start');
await idle();
console.log('見本の読み込み', Date.now() - t0, 'ms');
await page.click('#start');
await page.waitForSelector('#end');
await idle();
console.log('戦闘の画面（1回あたり ms）', JSON.stringify(await page.evaluate(() => {
  const a = window.__app, T = (fn, n = 20) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return +((performance.now() - t) / n).toFixed(2); };
  return { 全体の書き換え: T(() => a.refresh()), 地図だけ: T(() => a.view.draw()), 地形の描き直し: T(() => { a.view.baseDirty = true; a.view.draw(); }, 3) };
})));
// 観戦の1戦（速さ5）
await page.click('[data-speed="4"]');
t0 = Date.now();
await page.click('#watch');
await page.waitForSelector('.result', { timeout: 180000 });
const rounds = await page.evaluate(() => window.__app.st?.round ?? 0);
console.log('観戦の1戦（速さ5）', Date.now() - t0, 'ms', `${rounds}巡`);
await page.click('.result button');
await page.waitForSelector('#campaign');
await idle();
t0 = Date.now();
await page.click('#campaign');
await page.waitForSelector('#next');
await idle();
console.log('戦略を始める', Date.now() - t0, 'ms');
console.log('戦略の画面（1回あたり ms）', JSON.stringify(await page.evaluate(() => {
  const s = window.__campaign, v = s.view, T = (fn, n = 10) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return +((performance.now() - t) / n).toFixed(2); };
  return { 地図だけ: T(() => v.draw()), 全体の書き換え: T(() => s.refresh(), 5), 領を調べる: T(() => v.pick(400, 400), 50), 勢力の形: T(() => v.buildGeo(), 3), 画面の作り直し: T(() => s.mount(), 3), セル: v.model.m.n, 領: s.c.gs.provinces.length };
})));
t0 = Date.now();
await page.click('#next');
await page.waitForTimeout(100);
for (let i = 0; i < 20; i++) { await idle(); if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]'); else break; await page.waitForTimeout(50); }
await idle();
console.log('月を進める（攻められた戦いはおまかせ）', Date.now() - t0, 'ms');
await page.click('#exit'); await page.click('.confirm [data-a="ok"]');
await page.waitForSelector('#campaignWatch');
await idle();
await page.click('#campaignWatch');
await page.waitForSelector('#run');
await idle();
t0 = Date.now();
await page.click('#run');
await page.waitForFunction(() => /・12か月/.test(document.querySelector('#panel')?.textContent ?? ''), null, { timeout: 240000 });
await idle();
console.log('観戦で12か月', Date.now() - t0, 'ms');
await browser.close();
