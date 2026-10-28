// 史実の合戦（P75）の操作を、PC は本物のクリック、スマホは本物のタップで確かめる。開発サーバー（5183）が要る。
// 織田家と武田家の合戦の出来事を今月に足して月を進め、知らせとカード → 戦う（確かめる窓）→ 戦場 → 観戦で決着 → 戦略マップへ戻る → 結果の記録、
// もう1つの合戦は「見送る」。
// 使い方：node tools/histbattle-check.mjs [画面を撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', { ...devices['iPhone 13'] }]]) {
  const page = await (await browser.newContext(opts)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', tag, name, extra); };
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 60000 });
  const press = async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); if (tag === 'sp') await l.tap(); else await l.click(); };
  const shot = async (n) => { if (out) await page.screenshot({ path: path.join(out, `hb_${tag}_${n}.png`) }); };
  const C = (f, a) => page.evaluate(f, a);
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await press('[data-sample="sengoku_fid5_1575"]'); await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation'); await page.waitForSelector('#campaign'); await idle();
  await press('#campaign'); await page.waitForSelector('#next'); await idle();
  // 来月、織田家と武田家の合戦（史実は織田家の勝ち）と、織田家と北条家の合戦を起こす
  await C(() => {
    const c = window.__campaign.c, gs = c.gs, sc = c.world.scenario, me = c.player;
    const key = (name) => Object.entries(sc.nationOf).find(([, v]) => gs.factions[v]?.name.ja === name)?.[0];
    const at = Object.entries(sc.placeProv).find(([, p]) => gs.provinces[p]?.owner === me)[0];
    const next = gs.year * 12 + gs.month + 1, y = Math.floor((next - 1) / 12), m = ((next - 1) % 12) + 1;
    sc.data.battles.chk1 = { name: { ja: 'ためしの合戦一', en: '' }, at, sides: [{ realm: key('織田家'), generals: [] }, { realm: key('武田家'), generals: [] }], winner: 0, deploy: { ja: '両軍が野で向き合った。', en: '' } };
    sc.data.battles.chk2 = { name: { ja: 'ためしの合戦二', en: '' }, at, sides: [{ realm: key('北条家'), generals: [] }, { realm: key('織田家'), generals: [] }], winner: 0 };
    sc.data.events.push({ id: 'chk_hb1', y, m, imp: 3, ja: 'ためし一', at, do: [['battle', 'chk1']] });
    sc.data.events.push({ id: 'chk_hb2', y, m, imp: 3, ja: 'ためし二', at, do: [['battle', 'chk2']] });
  });
  await press('#next');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    if (await page.locator('.busy').count()) continue;
    if (await page.locator('.result.ask h2:has-text("史実の合戦")').count()) break;
    const btn = ['.result.fall [data-a="ok"]', '.result.report [data-a="ok"]', '.result [data-a="auto"]', '.result.captive [data-a="hold"]', '.result.ask [data-a="ok"]'];
    let hit = false;
    for (const b of btn) if (await page.locator(b).count()) { await press(b); hit = true; break; }
    if (!hit && await page.locator('#next:not([disabled])').count() && !(await page.locator('.result').count())) break;
  }
  ok('月を進めると「史実の合戦」の知らせが出る', ((await page.locator('.result.ask h2').first().textContent().catch(() => '')) ?? '').includes('史実の合戦'));
  if (await page.locator('.result.ask [data-a="ok"]').count()) await press('.result.ask [data-a="ok"]');
  await idle();
  ok('カードが2枚出る', (await page.locator('.card.status.histbattle').count()) === 2);
  await page.locator('.card.status.histbattle').first().scrollIntoViewIfNeeded();
  await shot('1_cards');
  // 見送る
  await press('[data-hbattle="chk_hb2"][data-c="skip"]'); await page.waitForSelector('.result.ask.confirm');
  await press('.result.ask.confirm [data-a="ok"]'); await page.waitForTimeout(300);
  ok('見送るとカードが消える', (await page.locator('[data-hbattle="chk_hb2"]').count()) === 0);
  // 戦う
  await press('[data-hbattle="chk_hb1"][data-c="fight"]'); await page.waitForSelector('.result.ask.confirm');
  ok('確かめる窓に布陣の説明と顔ぶれ', /両軍が野で向き合った/.test((await page.locator('.result.ask.confirm').textContent()) ?? ''));
  await shot('2_confirm');
  await press('.result.ask.confirm [data-a="ok"]');
  await page.waitForSelector('#deployDone, #end', { timeout: 60000 }); await idle();
  ok('戦場が開く', (await page.locator('.battle canvas').count()) > 0);
  await shot('3_battle');
  // 観戦・速さ5で決着させる
  await press('#watch'); await press('[data-speed="4"]');
  await page.waitForFunction(() => window.__app?.st?.winner !== null && window.__app?.st?.winner !== undefined, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const back = page.locator('button:has-text("戦略マップへ")').first();
  await back.waitFor({ timeout: 30000 });
  await back.scrollIntoViewIfNeeded(); if (tag === 'sp') await back.tap(); else await back.click();
  await page.waitForSelector('#next'); await idle();
  const res = await C(() => { const c = window.__campaign.c; return { left: (c.history.battles ?? []).length, result: c.log.find((e) => e.key === 'histBattleResult')?.vars.result ?? '', div: (c.history.diverged ?? []).includes('chk_hb1') }; });
  ok('戦い終えると戦略マップに戻り、結果が記録される', res.left === 0 && !!res.result, `${res.result}${res.div ? '（史実と違う道）' : ''}`);
  ok('ページのエラーが無い', errors.length === 0, errors.join(' / '));
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
