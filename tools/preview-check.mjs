// ビルドした版（npm run build → npx vite preview）が動くかの確認。開発用の裏口（__app）を使わず、画面だけで確かめる。
// 使い方：npx vite preview --port 5184 を動かしてから  node tools/preview-check.mjs
import path from 'node:path';

import playwright from './pw.mjs';
const { chromium } = playwright;
const url = process.env.HEX_URL ?? 'http://localhost:5184/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

await page.goto(url);
await page.click('[data-sample="sengoku_fid5_1575"]');
await page.waitForSelector('#modeLocal');
await page.click('#modeLocal');
await page.waitForSelector('#start');
await page.selectOption('#control', 'watch');
const t0 = Date.now();
await page.click('#start');
await page.waitForSelector('.result', { timeout: 240000 });
console.log('観戦の1戦：', ((Date.now() - t0) / 1000).toFixed(1), '秒 ／', (await page.textContent('.result')).replace(/\s+/g, ' ').slice(0, 40));
await page.click('.result button');
await page.waitForSelector('#start');
await page.click('#toModes');
await page.waitForSelector('#modeNation');
await page.click('#modeNation');
await page.waitForSelector('#campaign');
await page.click('#campaign');
await page.waitForSelector('#next');
await page.click('#next');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  if (await page.$('.result.fall [data-a="skip"]')) await page.click('.result.fall [data-a="skip"]'); else if (await page.$('.result.fall [data-a="ok"]')) await page.click('.result.fall [data-a="ok"]'); else if (await page.$('.result.report [data-a="ok"]')) await page.click('.result.report [data-a="ok"]'); else if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]'); else if (await page.$('#next')) break;
}
await page.waitForSelector('#next');
console.log('戦略：', (await page.textContent('.turn')).replace(/\s+/g, ' ').slice(0, 30));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'ビルド版：ページのエラーなし');
await browser.close();
process.exit(errors.length ? 1 : 0);
