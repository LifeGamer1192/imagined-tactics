// 史実の目標（P76）の表示を、PC は本物のクリック、スマホは本物のタップで確かめる。開発サーバー（5183）が要る。
// 来月に「織田家が武田家へ攻め込む」史実の戦を足して月を進め、知らせとカードが出ること、武田家の領を取ってもう1か月進めると果たしたことになるのを見る。
// 使い方：node tools/goal-check.mjs [画面を撮る先のフォルダ]
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
  const shot = async (n) => { if (out) await page.screenshot({ path: path.join(out, `goal_${tag}_${n}.png`) }); };
  const C = (f, a) => page.evaluate(f, a);
  /** 月を進め、want の知らせが出たら止まる（ほかの窓は閉じる）。戻り値：出た知らせの見出し */
  const month = async (want) => {
    await press('#next');
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      if (await page.locator('.busy').count()) continue;
      const h = (await page.locator('.result.ask h2').first().textContent().catch(() => '')) ?? '';
      if (h.includes(want)) return h;
      const btn = ['.result.fall [data-a="ok"]', '.result.report [data-a="ok"]', '.result [data-a="auto"]', '.result.captive [data-a="hold"]', '.result.ask [data-a="ok"]'];
      let hit = false;
      for (const b of btn) if (await page.locator(b).count()) { await press(b); hit = true; break; }
      if (!hit && await page.locator('#next:not([disabled])').count() && !(await page.locator('.result').count())) break;
    }
    return '';
  };
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await press('[data-sample="sengoku_fid5_1575"]'); await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation'); await page.waitForSelector('#campaign'); await idle();
  await press('#campaign'); await page.waitForSelector('#next'); await idle();
  const foe = await C(() => {
    const c = window.__campaign.c, gs = c.gs, sc = c.world.scenario, me = c.player;
    const key = (id) => Object.entries(sc.nationOf).find(([, v]) => v === id)[0];
    const foe = Object.values(gs.factions).find((f) => f.name.ja === '武田家').id;
    const next = gs.year * 12 + gs.month + 1, y = Math.floor((next - 1) / 12), m = ((next - 1) % 12) + 1;
    sc.data.events.push({ id: 'chk_goal', y, m, imp: 3, ja: 'ためしの戦', do: [['war', key(me), key(foe), { ja: 'ためし攻め', en: '' }]] });
    return foe;
  });
  ok('月を進めると「史実の目標」の知らせが出る', (await month('史実の目標')).includes('史実の目標'));
  if (await page.locator('.result.ask [data-a="ok"]').count()) await press('.result.ask [data-a="ok"]');
  await idle();
  ok('目標のカードが出る', ((await page.locator('.card.status.histgoal').textContent().catch(() => '')) ?? '').includes('ためし攻め'));
  await page.locator('.card.status.histgoal').scrollIntoViewIfNeeded();
  await shot('1_card');
  // 武田家の領を1つ取ったことにして、もう1か月
  await C((foe) => { const c = window.__campaign.c; const p = Object.values(c.gs.provinces).find((q) => q.owner === foe); p.owner = c.player; window.__campaign.refresh(); }, foe);
  await month('zzz');
  await idle();
  const done = await C(() => ({ left: (window.__campaign.c.history.goals ?? []).length, log: window.__campaign.c.log.some((e) => e.key === 'histGoalDone') }));
  ok('相手の領を取ると、目標を果たす（カードが消える）', done.left === 0 && done.log && (await page.locator('.card.status.histgoal').count()) === 0);
  ok('ページのエラーが無い', errors.length === 0, errors.join(' / '));
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
