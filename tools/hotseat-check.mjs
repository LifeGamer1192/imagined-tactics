// 1台を交代で遊ぶ（P119）：局地戦で「両方を操作」にすると、配置・番の替わりめに交代画面が出て、盤が隠れる
// 使い方：node tools/hotseat-check.mjs [撮る先]（vite を 5183 で立ち上げておく）
import playwright from './pw.mjs';
const out = process.argv[2];
let fails = 0;
const ok = (name, cond, note = '') => { console.log(`${cond ? 'OK ' : 'NG '} ${name}${note ? `  … ${note}` : ''}`); if (!cond) fails++; };
const b = await playwright.chromium.launch();
for (const [tag, w, h, mobile] of [['pc', 1360, 820, false], ['sp', 390, 844, true]]) {
  const page = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  const press = (sel) => (mobile ? page.tap(sel) : page.click(sel));
  const shot = async (n) => { if (out) { await page.waitForTimeout(200); await page.screenshot({ path: `${out}/hotseat_${tag}_${n}.png` }); } };
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await press('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeLocal'); await press('#modeLocal');
  await page.waitForSelector('#start');
  await page.selectOption('#control', 'both');
  await press('#start');
  await page.waitForSelector('.handoff');
  ok(`[${tag}] 始めに攻め手の配置の交代画面`, (await page.textContent('.handoff')).includes('攻め手') && (await page.textContent('.handoff')).includes('配置'));
  await shot('1_handoff_deploy0');
  await press('.handoff [data-a="go"]');
  await page.waitForSelector('#deployDone');
  ok(`[${tag}] 攻め手の配置のボタンは「守り手の配置へ」`, (await page.textContent('#deployDone')).includes('守り手の配置へ'));
  // 配置の間は、守り手の駒を選べない
  const pick = await page.evaluate(() => { const a = window.__app, st = a.st; const foe = st.units.find((u) => u.side === 1); return foe.pos; });
  await page.evaluate((c) => { const a = window.__app; a.onClick(...(() => { const v = a.view, g = a.st.map.grid; const [wx, wy] = g.center(c, 34); return v.cam.toScreen(wx, wy); })()); }, pick);
  ok(`[${tag}] 攻め手の配置の間は、守り手の駒を選べない`, await page.evaluate(() => { const a = window.__app; return a.selected === null || a.st.units[a.selected].side === 0; }));
  await press('#deployDone');
  await page.waitForSelector('.handoff');
  ok(`[${tag}] 次に守り手の配置の交代画面`, (await page.textContent('.handoff')).includes('守り手'));
  await press('.handoff [data-a="go"]');
  await page.waitForSelector('#deployDone');
  ok(`[${tag}] 守り手の配置のボタンは「戦闘開始」`, (await page.textContent('#deployDone')).includes('戦闘開始'));
  await press('#deployDone');
  await page.waitForSelector('.handoff');
  ok(`[${tag}] 開戦の前に攻め手の交代画面`, (await page.textContent('.handoff')).includes('攻め手'));
  ok(`[${tag}] 交代画面は盤を覆う`, await page.evaluate(() => { const r = document.querySelector('.handoff').getBoundingClientRect(), f = document.querySelector('.battle').getBoundingClientRect(); return r.width >= f.width - 1 && r.height >= f.height - 1; }));
  await shot('2_handoff_start');
  await press('.handoff [data-a="go"]');
  await page.waitForSelector('#end');
  const t0 = await page.evaluate(() => window.__app.st.turn);
  await press('#end');
  const cf = await page.waitForSelector('.confirm [data-a="ok"]', { timeout: 3000 }).catch(() => null);
  if (cf) await cf.click();
  await page.waitForSelector('.handoff', { timeout: 10000 });
  ok(`[${tag}] 番を終えると、守り手の交代画面`, t0 === 0 && (await page.evaluate(() => window.__app.st.turn)) === 1 && (await page.textContent('.handoff')).includes('守り手'));
  ok(`[${tag}] 交代画面の間は、盤を押しても選べない`, await page.evaluate(() => { const a = window.__app; const u = a.st.units.find((x) => x.side === 1 && x.alive); a.onClick(...(() => { const v = a.view, g = a.st.map.grid; const [wx, wy] = g.center(u.pos, 34); return v.cam.toScreen(wx, wy); })()); return a.selected === null; }));
  await shot('3_handoff_turn');
  await press('.handoff [data-a="go"]');
  await page.waitForTimeout(300);
  ok(`[${tag}] 押すと守り手の番が始まる`, !(await page.$('.handoff')) && await page.evaluate(() => window.__app.st.turn === 1));
  ok(`[${tag}] ページのエラーなし`, errors.length === 0, errors.join(' / '));
}
await b.close();
console.log(fails ? `NG ${fails}件` : 'すべて OK');
process.exit(fails ? 1 : 0);
