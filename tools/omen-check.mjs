// 兆し（P74）のカードの操作を、PC は本物のクリック、スマホは本物のタップで確かめる。開発サーバー（5183）が要る。
// 自分の家の将が2か月後に暗殺される出来事を足して月を進め、兆しの知らせとカードが出ること、備える（確かめる窓→兵糧が減る）、史実のまま（やめる→もう一度）を見る。
// 使い方：node tools/omen-check.mjs [画面を撮る先のフォルダ]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium, devices } = require('playwright');
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
  const shot = async (n) => { if (out) await page.screenshot({ path: path.join(out, `omen_${tag}_${n}.png`) }); };
  const C = (f, a) => page.evaluate(f, a);
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await press('[data-sample="sengoku_fid5_1575"]'); await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation'); await page.waitForSelector('#campaign'); await idle();
  await press('#campaign'); await page.waitForSelector('#next'); await idle();
  // 2人の将に、2か月後に暗殺・戦死される出来事を足す
  const who = await C(() => {
    const s = window.__campaign, c = s.c, gs = c.gs, me = c.player;
    const [a, b] = Object.values(gs.generals).filter((g) => g.faction === me && !g.isLord);
    const sc = c.world.scenario, at = gs.year * 12 + gs.month + 2, y = Math.floor((at - 1) / 12), m = ((at - 1) % 12) + 1;
    sc.data.events.push({ id: 'chk_a', y, m, imp: 3, ja: 'ためし：刺客', do: [['dies', a.name.ja, 'assassination']] });
    sc.data.events.push({ id: 'chk_b', y, m, imp: 3, ja: 'ためし：討死', do: [['dies', b.name.ja, 'battle_wound']] });
    return { a: a.id, b: b.id, an: a.name.ja };
  });
  // 月を進める（攻められた戦いなどの窓は閉じる）
  await press('#next');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    if (await page.locator('.busy').count()) continue;
    if (await page.locator('.result.ask h2:has-text("兆し")').count()) break;
    const btn = ['.result.fall [data-a="ok"]', '.result.report [data-a="ok"]', '.result [data-a="auto"]', '.result.captive [data-a="hold"]', '.result.ask [data-a="ok"]'];
    let hit = false;
    for (const b of btn) if (await page.locator(b).count()) { await press(b); hit = true; break; }
    if (!hit && await page.locator('#next:not([disabled])').count() && !(await page.locator('.result').count())) break;
  }
  const newsTitle = (await page.locator('.result.ask h2').first().textContent().catch(() => '')) ?? '';
  ok('月を進めると「兆し」の知らせが出る', newsTitle.includes('兆し'), newsTitle);
  await shot('1_news');
  if (await page.locator('.result.ask [data-a="ok"]').count()) await press('.result.ask [data-a="ok"]');
  await idle();
  ok('兆しのカードが2枚出る', (await page.locator('.card.status.omen').count()) === 2);
  await page.locator('.card.status.omen').first().scrollIntoViewIfNeeded();
  await shot('2_cards');
  // 備える
  const supply = await C(() => window.__campaign.c.gs.factions[window.__campaign.c.player].supply);
  await press(`[data-omen="chk_a"][data-c="guard"]`); await page.waitForSelector('.result.ask.confirm');
  await press('.result.ask.confirm [data-a="ok"]'); await page.waitForTimeout(300);
  const after = await C(() => ({ supply: window.__campaign.c.gs.factions[window.__campaign.c.player].supply, choice: window.__campaign.c.history.omens.find((o) => o.ev === 'chk_a')?.choice }));
  ok('備えると兵糧が減り、カードが「備えている」になる', after.choice === 'guard' && supply - after.supply > 0 && ((await page.locator('.card.status.omen').first().textContent()) ?? '').includes('備えている'), `兵糧${supply}→${after.supply}`);
  // 史実のまま：やめる → もう一度
  await press(`[data-omen="chk_b"][data-c="accept"]`); await page.waitForSelector('.result.ask.confirm');
  await press('.result.ask.confirm [data-a="no"]'); await page.waitForTimeout(200);
  ok('やめると選ばれない', await C(() => !window.__campaign.c.history.omens.find((o) => o.ev === 'chk_b')?.choice));
  await press(`[data-omen="chk_b"][data-c="accept"]`); await page.waitForSelector('.result.ask.confirm');
  await press('.result.ask.confirm [data-a="ok"]'); await page.waitForTimeout(300);
  ok('「史実のままにする」を選べる', await C(() => window.__campaign.c.history.omens.find((o) => o.ev === 'chk_b')?.choice === 'accept'));
  await shot('3_chosen');
  ok('ページのエラーが無い', errors.length === 0, errors.join(' / '));
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
