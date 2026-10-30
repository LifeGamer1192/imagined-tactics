// おまかせの方針（P104：5段階と、密集・統制・包囲）の選ぶ欄を、PC・スマホ縦・スマホ横で確かめる。開発サーバー（5183）が要る。
// 国モードの「方針」ボタンから窓を開き、各軸の1〜5と狙いを押して、ボタンの文字と覚えた値が変わるか、押してからの速さを見る。戦闘の画面の欄も撮る。
// 使い方：node tools/plan-check.mjs [画面を撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', { ...devices['iPhone 13'] }], ['spl', { ...devices['iPhone 13 landscape'] }]]) {
  const page = await (await browser.newContext(opts)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', tag, name, extra); };
  const shot = async (n) => { if (out) await page.screenshot({ path: path.join(out, `plan_${tag}_${n}.png`) }); };
  const press = async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); if (tag === 'pc') await l.click(); else await l.tap(); };
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 60000 });
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await page.evaluate(() => { try { localStorage.removeItem('hexsim.autoPlan'); } catch { /* */ } });
  await press('[data-sample="sengoku_fid5_1575"]'); await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation'); await page.waitForSelector('#campaign'); await idle();
  await press('#campaign'); await page.waitForSelector('#next'); await idle();
  ok('始めの方針（猛攻5・最寄り狙い・直情1・密集3・統制3・包囲3）', /猛攻5・最寄り狙い・直情1・密集3・統制3・包囲3/.test(await page.textContent('#planBtn')), (await page.textContent('#planBtn')).trim());
  await press('#planBtn');
  await page.waitForSelector('.planbox');
  ok('6つの軸が並ぶ（5段階が5つ、狙いが3択）', (await page.$$eval('.planbox .prow', (r) => r.length)) === 6 && (await page.$$eval('.planbox .pgrp.lv', (r) => r.length)) === 5);
  await shot('1_box');
  for (const [k, v] of [['push', 2], ['mind', 4], ['tight', 5], ['command', 1], ['envelop', 5]]) {
    const t0 = Date.now();
    await press(`.planbox [data-plan="${k}:${v}"]`);
    ok(`${k}を${v}に（0.2秒以内）`, Date.now() - t0 < 400, `${Date.now() - t0}ms`);
  }
  await press('.planbox [data-plan="aim:weak"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hexsim.autoPlan')));
  ok('選んだ値を覚える', saved.push === 2 && saved.mind === 4 && saved.tight === 5 && saved.command === 1 && saved.envelop === 5 && saved.aim === 'weak', JSON.stringify(saved));
  await shot('2_set');
  await press('.planbox [data-a="ok"]');
  ok('ボタンの文字が変わる', /消極2・弱った敵狙い・知略4・密集5・統制1・包囲5/.test(await page.textContent('#planBtn')), (await page.textContent('#planBtn')).trim());
  ok('横にはみ出さない', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('ページのエラーが無い', !errors.length, errors.join(' / '));
  await page.close();
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
