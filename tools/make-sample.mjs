// 見本のセーブを、公開版の hist-sim で作る（本物の地形で作るため。hist-sim のテスト用のセーブは、通信なしで作るので地形が簡易な形になっている）。
// hist-sim のアドレスに until を付けて開くと、世界ができたあと最高速でその月まで進み、ちょうどその月で止まってセーブを書き出す。
// 終わると document.body.dataset.until が running から done になる（世界が先に終わると ended、値を読めないと bad）。
// 使い方：node tools/make-sample.mjs <シナリオ> <史実度> <止める年月> <出力ファイル> [種]
//   止める年月：1575:1（1575年1月）、259bc:1（前259年1月）。月を省くと1月
// 例：node tools/make-sample.mjs sengoku 5 1575:1 art-src/saves/sengoku_fid5_1575.histsim HEXSK
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const [scn, fid, until, out, seed = 'HEXSIM'] = process.argv.slice(2);
if (!scn || !fid || !until || !out) { console.error('使い方：node tools/make-sample.mjs <シナリオ> <史実度> <止める年月> <出力> [種]'); process.exit(1); }
if (!/^\d+(bc)?(:\d{1,2})?$/i.test(until)) { console.error('止める年月の書き方が違います（例：1575:1、259bc:1）：', until); process.exit(1); }
const HIST = process.env.HIST_URL ?? 'https://lifegamer1192.github.io/imagined-chronicles/';
const LIMIT = 30 * 60000;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ページのエラー：', e.message));
const t0 = Date.now();
try {
  const download = page.waitForEvent('download', { timeout: LIMIT });
  download.catch(() => {});
  await page.goto(`${HIST}?seed=${seed}&scn=${scn}&fid=${fid}&until=${encodeURIComponent(until)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => ['done', 'ended', 'bad'].includes(document.body.dataset.until ?? ''), null, { timeout: LIMIT, polling: 500 });
  const state = await page.evaluate(() => ({ until: document.body.dataset.until, file: document.body.dataset.untilFile }));
  if (state.until === 'bad') throw new Error(`hist-sim が止める年月を読めませんでした：${until}`);
  const dl = await download;
  await dl.saveAs(out);
  console.log(state.until === 'ended' ? '世界が先に終わりました。その時点のセーブです：' : '書き出し：', out, `（${state.file ?? dl.suggestedFilename()}、${Math.round((Date.now() - t0) / 1000)}秒）`);
  process.exitCode = state.until === 'done' ? 0 : 2;
} catch (e) {
  console.log('失敗：', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
}
