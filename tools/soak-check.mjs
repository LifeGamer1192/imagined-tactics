// 公開前の通し確認：見本のセーブすべてで、観戦の1戦と、戦略の観戦24か月を回し、エラーと重さを見る。
// 開発サーバー（5183）か、HEX_URL で指定した場所（ビルド版）に対して使う。ビルド版では開発用の入口が無いので、画面の操作だけで進める。
// 使い方：node tools/soak-check.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const url = process.env.HEX_URL ?? 'http://localhost:5183/';
const SAMPLES = ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'rome_fid3_212bc', 'invented_archipelago_y30'];
const browser = await chromium.launch();
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
for (const sample of SAMPLES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], failed = [];
  let dialogs = 0;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on('dialog', (d) => { dialogs++; d.accept(); });
  const t0 = Date.now();
  await page.goto(url);
  await page.click(`[data-sample="${sample}"]`);
  await page.waitForSelector('#start');
  const load = Date.now() - t0;
  // 観戦の1戦：速さ5で決着まで
  await page.selectOption('#control', 'watch');
  await page.click('#start');
  await page.waitForSelector('[data-speed="4"]');
  await page.click('[data-speed="4"]');
  const b0 = Date.now();
  await page.waitForSelector('.result', { timeout: 180000 });
  const battle = Date.now() - b0;
  const result = (await page.textContent('.result h2')).trim();
  await page.click('.result button');
  // 戦略の観戦：12か月を2回
  await page.waitForSelector('#campaignWatch');
  await page.click('#campaignWatch');
  await page.waitForSelector('#run');
  const s0 = Date.now();
  for (let k = 0; k < 2; k++) {
    await page.click('#run');
    await page.waitForFunction((n) => new RegExp(`・${n}か月`).test(document.querySelector('#panel')?.textContent ?? '') || document.querySelector('#next')?.disabled, (k + 1) * 12, { timeout: 240000 });
    await page.waitForTimeout(300);
  }
  const strat = Date.now() - s0;
  const head = (await page.textContent('#panel .foot')).replace(/\s+/g, ' ');
  const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1));
  ok(`${sample}：観戦の1戦と戦略24か月が終わる`, /か月/.test(head), `読み込み${load}ms／1戦${(battle / 1000).toFixed(1)}秒（${result}）／24か月${(strat / 1000).toFixed(1)}秒／メモリ${mem}MB／${head.match(/勢力\d+・\d+か月/)?.[0] ?? ''}`);
  ok(`${sample}：ページのエラーなし`, errors.length === 0, errors.slice(0, 3).join(' / '));
  ok(`${sample}：読み込みの失敗なし`, failed.length === 0, failed.slice(0, 3).join(' / '));
  ok(`${sample}：ブラウザの確認窓を出さない`, dialogs === 0, `${dialogs}回`);
  await page.close();
}
console.log(ng ? `NG ${ng}件` : 'すべて OK');
await browser.close();
process.exit(ng ? 1 : 0);
