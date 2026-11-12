// セーブの保存を、わざと失敗させて確かめる（P124）：ふつう／そのままの形が入らない（DataCloneError）／IndexedDB が無い／何も入らない（容量不足）
// 使い方：node tools/save-check.mjs [撮る先]（vite を 5183 で立ち上げておく）
import playwright from './pw.mjs';
const out = process.argv[2];
let fails = 0;
const ok = (name, cond, note = '') => { console.log(`${cond ? 'OK ' : 'NG '} ${name}${note ? `  … ${note}` : ''}`); if (!cond) fails++; };
const b = await playwright.chromium.launch();
const URL0 = process.env.HEX_URL ?? 'http://localhost:5183/';
const CASES = [
  ['normal', '', 'idb'],
  ['clone', `(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (String(k).startsWith('slot:') && !(v && v.packed)) throw new DOMException('could not be cloned', 'DataCloneError'); return put.call(this, v, k); }; })()`, 'packed'],
  ['noidb', `(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); })()`, 'local'],
  // 端末の保存に入るが、鍵を数える方法が働かない（Safari で起きた見込みの形。P125）
  ['nokeys', `(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); Object.defineProperty(Storage.prototype, 'length', { get() { return 0; }, configurable: true }); })()`, 'local'],
  ['nothing', `(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); Storage.prototype.setItem = function (k) { if (String(k).includes('slot:')) throw new DOMException('quota', 'QuotaExceededError'); }; })()`, 'fail'],
];
for (const [tag, init, want] of CASES) {
  const ctx = await b.newContext({ viewport: { width: 1360, height: 820 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL0);
  await page.click('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeNation'); await page.click('#modeNation');
  await page.waitForSelector('#campaign'); await page.click('#campaign');
  await page.waitForSelector('#next', { timeout: 60000 }); await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) { const x = await page.$('.result.ask.confirm button'); if (!x) break; await x.click().catch(() => {}); await page.waitForTimeout(150); }
  await page.click('#saves'); await page.waitForSelector('#saveNew');
  await page.click('#saveNew');
  await page.waitForFunction(() => document.querySelector('[data-load="1"]') || document.querySelector('.savefail'), null, { timeout: 30000 });
  const r = await page.evaluate(() => ({ loaded: !!document.querySelector('[data-load="1"]'), fail: document.querySelector('.savefail')?.textContent ?? '', note: document.querySelector('.savemenu')?.textContent ?? '' }));
  if (want === 'fail') {
    ok(`[${tag}] 保存できないとき、コードと端末の情報が出る`, r.fail.includes('SV-20') && r.fail.includes('ブラウザ：') && r.fail.includes('試した1') && r.fail.includes('IndexedDB：なし'), r.fail.slice(0, 60));
    if (out) { await page.click('.savefail summary'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/save_${tag}.png` }); }
  } else {
    ok(`[${tag}] 保存できる（${want}）`, r.loaded, r.fail.slice(0, 80));
    if (want !== 'idb') ok(`[${tag}] 縮めて入れたと断る`, r.note.includes('縮めた形で'));
    // 開き直して、つづきから読める
    await page.goto(URL0);
    await page.waitForSelector('#continue:not([hidden])', { timeout: 15000 }).catch(() => {});
    const cont = await page.$('#continue:not([hidden])');
    ok(`[${tag}] 開き直すと「つづきから」が出る`, !!cont);
    if (cont) {
      await cont.click(); await page.waitForSelector('[data-load="1"]'); await page.click('[data-load="1"]');
      await page.waitForSelector('#next', { timeout: 60000 }).catch(() => {});
      ok(`[${tag}] 枠1から続けられる`, !!(await page.$('#next')));
    }
  }
  // 保存の様子を調べる
  if (want !== 'fail') {
    await page.click('#saves'); await page.waitForSelector('#diag'); await page.click('#diag');
    await page.waitForSelector('.savediag');
    const d = await page.textContent('.savediag');
    ok(`[${tag}] 保存の様子に、場所ごとの中身と端末の情報`, d.includes('保存の場所の様子') && d.includes('一覧に出る枠：') && d.includes('ブラウザ：'), d.split('\n').find((l) => l.startsWith('一覧に出る枠')));
  }
  ok(`[${tag}] ページのエラーなし`, errors.length === 0, errors.join(' / '));
  await ctx.close();
}
await b.close();
console.log(fails ? `NG ${fails}件` : 'すべて OK');
process.exit(fails ? 1 : 0);
