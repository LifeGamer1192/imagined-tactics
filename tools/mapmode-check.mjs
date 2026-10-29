// 地図の切り替え（P97）を、PC・スマホ縦・スマホ横で確かめる。開発サーバー（5183）が要る。
// 「曲」の隣の「地図」ボタンで選ぶ欄が開くこと、各地図に切り替えると塗り分けと凡例が出ること、押してから描き直すまでの時間を見る。
// 使い方：node tools/mapmode-check.mjs [画面を撮る先のフォルダ] [見本の名前=sengoku_fid5_1575]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
const out = process.argv[2], sample = process.argv[3] ?? 'sengoku_fid5_1575';
const browser = await chromium.launch();
let ng = 0;
const sizes = [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', { ...devices['iPhone 13'] }], ['spl', { ...devices['iPhone 13 landscape'] }]];
for (const [tag, opts] of sizes) {
  const page = await (await browser.newContext(opts)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', tag, name, extra); };
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 60000 });
  const press = async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); if (tag === 'pc') await l.click(); else await l.tap(); };
  const shot = async (n) => { if (out) await page.screenshot({ path: path.join(out, `map_${tag}_${n}.png`) }); };
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await page.evaluate(() => { try { localStorage.removeItem('hexsim.mapMode'); } catch { /* */ } });
  await press(`[data-sample="${sample}"]`); await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation'); await page.waitForSelector('#campaign'); await idle();
  await press('#campaign'); await page.waitForSelector('#next'); await idle();
  ok('「地図」ボタンが「曲」の隣にある', await page.evaluate(() => document.querySelector('#bgmBtn')?.nextElementSibling?.id === 'mapModeBtn'));
  ok('始めは「領地」', (await page.textContent('#mapModeBtn')).includes('領地'));
  await press('#mapModeBtn');
  await page.waitForSelector('.mapmenu');
  const names = await page.$$eval('.mapmenu [data-mapmode]', (bs) => bs.map((b) => b.querySelector('b').textContent));
  ok('選ぶ欄に地図が並ぶ', ['領地', '人口', '収入', '兵の数', '偵察度', '外交'].every((n) => names.includes(n)), names.join('・'));
  await shot('0_menu');
  for (const id of ['pop', 'income', 'troops', 'fort', 'unrest', 'scout', 'diplo']) {
    if (!(await page.locator('.mapmenu').count())) await press('#mapModeBtn');
    // 人口は本物のクリック・タップで押す。ほかは、押してから描き終わるまでをページの中で測る（操作の道具の待ち時間を入れない）
    const ms = id === 'pop'
      ? (await press(`.mapmenu [data-mapmode="${id}"]`), 0)
      : await page.evaluate((sel) => { const t = performance.now(); document.querySelector(sel).click(); return Math.round(performance.now() - t); }, `.mapmenu [data-mapmode="${id}"]`);
    const st = await page.evaluate(() => { const p = window.__campaign.view.hl.paint; return p ? { fills: p.fills.size, labels: p.labels.size, legend: p.legend.items.length, title: p.legend.title } : null; });
    ok(`${id}：塗り分けと凡例`, st && st.fills > 0 && st.legend >= 2, JSON.stringify(st));
    if (id !== 'pop') ok(`${id}：0.2秒以内に描き直す`, ms < 200, `${ms}ms`);
    await shot(id);
  }
  await page.reload(); await page.waitForSelector('[data-sample]');
  ok('ページのエラーが無い', !errors.length, errors.join(' / '));
  await page.close();
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
