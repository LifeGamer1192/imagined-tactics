// 図鑑（P90）の確認：タイトル画面の「図鑑」から開き、兵種の対応表・技・軍略・レベルの各タブが出るか、名前で探せるか、
// 名前の版を切り替えられるか、横にはみ出さないかを、PC とスマホ（縦・横）で見る。開発サーバー（5183）が要る。
// 使い方：node tools/zukan-check.mjs [撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
const { defaultBrowserType, ...phone } = devices['iPhone 13'];
const { defaultBrowserType: _d, ...land } = devices['iPhone 13 landscape'];
for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', phone], ['spland', land]]) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const press = (sel) => (opts.hasTouch ? page.tap(sel) : page.click(sel));
  const shot = async (n) => { if (out) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, `zukan_${tag}_${n}.png`) }); } };
  const fits = () => page.evaluate(() => { const h = document.querySelector('.zukan .help').getBoundingClientRect(); return h.left >= -1 && h.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await page.waitForSelector('[data-zukan]');
  await press('[data-zukan]');
  await page.waitForSelector('.zukan:not([hidden]) .zk-units');
  const units = await page.$$eval('.zukan .zk-units tr', (r) => r.length);
  ok(`[${tag}] 兵種の対応表：50種と見出し`, units >= 50 + 18, `${units}行`);
  ok(`[${tag}] 兵種の対応表に3つの版の名前（雑兵・徒卒・民兵）`, /雑兵[\s\S]*徒卒[\s\S]*民兵/.test(await page.textContent('.zukan .help-body')));
  ok(`[${tag}] 窓が横にはみ出さない`, await fits());
  await shot('1_units');
  for (const [t, want, min] of [['skills', '通常攻撃', 10], ['tactics', '気力', 10], ['levels', '累計', 49]]) {
    await press(`[data-ztab="${t}"]`);
    await page.waitForTimeout(150);
    const rows = await page.$$eval('.zukan .help-body table tr', (r) => r.length);
    ok(`[${tag}] ${t} のタブ`, rows > min && (await page.textContent('.zukan .help-body')).includes(want), `${rows}行`);
    ok(`[${tag}] ${t}：窓が横にはみ出さない`, await fits());
    await shot(`2_${t}`);
  }
  // レベル表：役職・兵種を選び直すと数が変わる
  const before = await page.textContent('.zk-levels');
  await page.selectOption('[data-zk="unit"]', 'u15c');
  ok(`[${tag}] レベル表：兵種を選び直すと数が変わる`, (await page.textContent('.zk-levels')) !== before);
  // 軍略：名前で探す・名前の版
  await press('[data-ztab="tactics"]');
  const all = await page.$$eval('.zukan .help-body table tr', (r) => r.length);
  await page.fill('[data-zk="q"]', '火');
  const some = await page.$$eval('.zukan .help-body table tr', (r) => r.length);
  ok(`[${tag}] 名前で探すと絞られる`, some > 1 && some < all, `${all} → ${some}行`);
  await page.fill('[data-zk="q"]', '');
  await page.selectOption('[data-zk="ver"]', 'cn');
  ok(`[${tag}] 名前を中国版に切り替えられる`, (await page.textContent('.zukan .help-body')) !== '' && (await page.$eval('[data-zk="ver"]', (s) => s.value)) === 'cn');
  await page.selectOption('[data-zk="ver"]', 'jp');
  await press('.zukan .help-close');
  ok(`[${tag}] 閉じられる`, await page.$eval('.zukan', (e) => e.hidden));
  ok(`[${tag}] ページのエラーなし`, errors.length === 0, errors.join(' / '));
  await context.close();
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
