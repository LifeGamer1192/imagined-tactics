// 公開用のビルド（dist/）が、サブフォルダに置いても動くかの確認。
// dist/ を http://localhost:<ポート>/games/hex-sim/ として出す小さなサーバーをこの中で立て、画面だけで
// 「タイトル → サンプル → 戦闘開始 → 戦略 → 月を進める」まで進める。終わるとサーバーも止まる。
// 使い方：npm run build のあと  node tools/subdir-check.mjs [画面の保存先]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const PREFIX = '/games/hex-sim/';
const PORT = Number(process.env.PORT ?? 5185);
const dist = path.resolve('dist');
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
if (!existsSync(path.join(dist, 'index.html'))) { console.log('dist/ がありません。先に npm run build を実行してください'); process.exit(1); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // サブフォルダの外は何も無い（外を見に行っていたら 404 になって気づける）
  if (!url.startsWith(PREFIX)) { res.writeHead(404).end('not found'); return; }
  let file = path.join(dist, url.slice(PREFIX.length));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? `  … ${detail}` : ''}`); };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], outside = [], failed = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // 読み込みの失敗（404）は下の failed で数えるので、ここでは除く
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && !u.pathname.startsWith(PREFIX)) outside.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  const shot = async (name) => { if (out) await page.screenshot({ path: path.join(out, `${name}.png`) }); };

  await page.goto(`http://127.0.0.1:${PORT}${PREFIX}`);
  await page.waitForSelector('[data-sample]');
  check('タイトルが出る', await page.isVisible('h1'));
  const bg = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--title-bg'));
  check('タイトルの背景画がサブフォルダの中を指す', bg.includes('art/bg/') && !bg.includes('url("/art'), bg);
  await shot('subdir_title');

  await page.click('.help-btn');
  check('「？」で案内が開く', await page.isVisible('.help'));
  await page.keyboard.press('Escape');
  check('Esc で案内が閉じる', !(await page.isVisible('.help')));

  await page.click('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeLocal');
  await page.click('#modeLocal');
  await page.waitForSelector('#start');
  check('サンプルを読み込める', (await page.textContent('.setup header')).includes('戦国'));

  await page.click('#start');
  await page.waitForSelector('.battle canvas');
  // 自分で戦う戦いは配置の段階から始まる
  await page.waitForSelector('#deployDone');
  check('配置の段階から始まる', (await page.textContent('.turn')).includes('配置'));
  await page.click('#deployDone');
  await page.waitForSelector('#end');
  await page.waitForTimeout(1500);
  check('戦闘が始まる', (await page.textContent('.turn')).includes('巡'));
  const images = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.webp$/.test(e.name)).length);
  check('戦場の絵を読み込んでいる', images > 0, `${images}枚`);
  await shot('subdir_battle');
  await page.click('#quit'); await page.click('.confirm [data-a="ok"]');
  await page.waitForSelector('#start');
  await page.click('#toModes');
  await page.waitForSelector('#modeNation');
  await page.click('#modeNation');
  await page.waitForSelector('#campaign');

  await page.click('#campaign');
  await page.waitForSelector('#next');
  await page.waitForTimeout(1500);
  const before = await page.textContent('.turn');
  await shot('subdir_strategy');
  await page.click('#next');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]');
    else if (await page.$('#next')) break;
  }
  await page.waitForSelector('#next');
  const after = await page.textContent('.turn');
  check('戦略で月が進む', before !== after, after.replace(/\s+/g, ' ').slice(0, 30));

  // index.html を付けたアドレスでも同じに動く
  await page.goto(`http://127.0.0.1:${PORT}${PREFIX}index.html`);
  await page.click('[data-sample="rome_fid3_212bc"]');
  await page.waitForSelector('#modeLocal');
  check('index.html を付けたアドレスでもサンプルを読み込める', (await page.textContent('.setup header')).includes('ローマ'));

  check('サブフォルダの外への読み込みが無い', outside.length === 0, outside.slice(0, 3).join(' '));
  check('読み込みに失敗したものが無い', failed.length === 0, `${failed.length}件 ${failed.slice(0, 3).join(' ')}`);
  check('ページのエラーが無い', errors.length === 0, errors.slice(0, 3).join(' / '));
} finally {
  await browser.close();
  await new Promise((ok) => server.close(ok));
}
const ng = results.filter((r) => !r).length;
console.log(ng ? `NG ${ng}件` : `すべて OK（${results.length}項目）。サーバーは止めました`);
process.exit(ng ? 1 : 0);
