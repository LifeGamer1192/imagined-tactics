// 捕虜と登用（P72・P73）の操作を、PC は本物のクリック、スマホは本物のタップで確かめる。開発サーバー（5183）が要る。
// 当主の窓（登用・保留が無い）→ 解き放つ、ふつうの捕虜 → 保留 → 「捕虜」ボタン → 一覧 → 決める → 処断（確かめる窓でやめる→もう一度）、
// 登用、自分の将が捕まる → 一覧の身代金で取り戻す。
// 使い方：node tools/captive-check.mjs [画面を撮る先のフォルダ]
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
  const shot = async (n) => { if (out) await page.screenshot({ path: path.join(out, `captive_${tag}_${n}.png`) }); };
  const C = (f, a) => page.evaluate(f, a);
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await press('[data-sample="sengoku_fid5_1575"]'); await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation'); await page.waitForSelector('#campaign'); await idle();
  await press('#campaign'); await page.waitForSelector('#next'); await idle();
  await page.waitForTimeout(500);
  // 武田家の当主と将2人を、こちらが勝った戦いで捕らえたことにする
  const ids = await C(async () => {
    const { S } = await import('/src/strategy/config.ts');
    const cap = await import('/src/strategy/captive.ts');
    const s = window.__campaign, c = s.c, gs = c.gs;
    const me = c.player, foe = Object.values(gs.factions).find((f) => f.name.ja === '武田家').id, prov = gs.factions[me].capital;
    const lord = gs.factions[foe].lordId, [a, b] = Object.values(gs.generals).filter((g) => g.faction === foe && !g.isLord).map((g) => g.id);
    S.captive.base = 1; S.captive.lordBase = 1;
    const list = [lord, a, b];
    cap.takeCaptives(c, { attacker: me, defender: foe, prov, from: prov, atk: [gs.factions[me].lordId], def: list }, { winner: 0, rounds: 3, levelUps: [], lost: [], beaten: list.map((id) => gs.generals[id].name.ja), beatenSides: list.map(() => 1), beatenIds: list });
    s.captiveWindows(() => s.mount());
    return { lord, a, b, foe };
  });
  await page.waitForSelector('.result.captive');
  ok('当主の窓が出る', ((await page.locator('.result.captive h2').textContent()) ?? '').includes('当主'));
  ok('当主の窓に「登用する」「保留」が無い', (await page.locator('.result.captive [data-a="recruit"], .result.captive [data-a="hold"]').count()) === 0);
  await shot('1_lord');
  await press('.result.captive [data-a="release"]');
  await page.waitForTimeout(300);
  ok('当主を解き放つと、もとの家へ戻る', await C((x) => window.__campaign.c.gs.generals[x.lord]?.faction === x.foe, ids));
  // 次の捕虜：保留
  await page.waitForSelector('.result.captive');
  ok('次の捕虜の窓に登用の見込み', /登用の見込み：\d+%/.test((await page.locator('.result.captive').textContent()) ?? ''));
  await shot('2_captive');
  await press('.result.captive [data-a="hold"]');
  await page.waitForSelector('.result.captive');
  await press('.result.captive [data-a="hold"]');
  await page.waitForTimeout(300);
  ok('保留すると窓が閉じる', (await page.locator('.result.captive').count()) === 0);
  ok('「捕虜」ボタンが出る', ((await page.locator('#captiveBtn').textContent()) ?? '').includes('捕虜 2人'));
  // 一覧 → 決める → 処断（やめる → もう一度）
  await press('#captiveBtn'); await page.waitForSelector('.result.captives');
  await shot('3_list');
  ok('一覧に2人', (await page.locator('.result.captives [data-cap]').count()) === 2);
  await press(`.result.captives [data-cap="${ids.a}"]`); await page.waitForSelector('.result.captive');
  await press('.result.captive [data-a="execute"]'); await page.waitForSelector('.result.ask.confirm');
  await press('.result.ask.confirm [data-a="no"]'); await page.waitForTimeout(200);
  ok('処断の確かめでやめると、捕虜の窓に戻る', await page.locator('.result.captive').isVisible() && await C((x) => !!window.__campaign.c.captives.find((y) => y.g.id === x.a), ids));
  await press('.result.captive [data-a="execute"]'); await page.waitForSelector('.result.ask.confirm');
  await press('.result.ask.confirm [data-a="ok"]'); await page.waitForTimeout(300);
  ok('処断すると世を去る', await C((x) => !window.__campaign.c.gs.generals[x.a] && !window.__campaign.c.captives.find((y) => y.g.id === x.a), ids));
  // 一覧へ戻る → 登用（見込みを必ずにして）
  await page.waitForSelector('.result.captives');
  await C(async () => { const { S } = await import('/src/strategy/config.ts'); S.captive.recruit.min = 1; S.captive.recruit.max = 1; });
  await press(`.result.captives [data-cap="${ids.b}"]`); await page.waitForSelector('.result.captive');
  await press('.result.captive [data-a="recruit"]'); await page.waitForTimeout(300);
  ok('登用すると家臣になる', await C((x) => window.__campaign.c.gs.generals[x.b]?.faction === window.__campaign.c.player, ids));
  if (await page.locator('.result.captives').count()) await press('.result.captives [data-a="ok"]');
  ok('家臣の欄に出る', (await page.locator(`.gen[data-gen="${ids.b}"]`).count()) === 1);
  // 自分の将が捕まる → 身代金
  const mine = await C(async (x) => {
    const cap = await import('/src/strategy/captive.ts');
    const { S } = await import('/src/strategy/config.ts');
    S.captive.recruit.min = 0; S.captive.recruit.max = 0; S.captive.ai.executeChance = 0;
    const s = window.__campaign, c = s.c, gs = c.gs, me = c.player, g = Object.values(gs.generals).find((y) => y.faction === me && !y.isLord && y.id !== x.b);
    const fprov = gs.factions[x.foe].capital;
    cap.takeCaptives(c, { attacker: me, defender: x.foe, prov: fprov, from: gs.factions[me].capital, atk: [g.id], def: [] }, { winner: 1, rounds: 3, levelUps: [], lost: [], beaten: [g.name.ja], beatenSides: [0], beatenIds: [g.id] });
    // 相手は登用に失敗し、処断もしない設定のまま捕虜にしておく
    const held = c.captives.find((y) => y.g.id === g.id);
    if (!held) { return { id: g.id, held: false }; }
    gs.factions[me].supply = 9999; s.refresh();
    return { id: g.id, held: true };
  }, ids);
  if (mine.held) {
    ok('「捕まった将」がボタンに出る', ((await page.locator('#captiveBtn').textContent()) ?? '').includes('捕まった将 1人'));
    await press('#captiveBtn'); await page.waitForSelector('.result.captives');
    await press(`.result.captives [data-ransom="${mine.id}"]`); await page.waitForTimeout(300);
    ok('身代金で取り戻す', await C((id) => window.__campaign.c.gs.generals[id]?.faction === window.__campaign.c.player, mine.id));
    if (await page.locator('.result.captives').count()) await press('.result.captives [data-a="ok"]');
  } else ok('自分の将が捕まる（相手がその場で決めた）', true, '相手の国がその場で登用・処断・解き放ちを決めた');
  ok('ページのエラーが無い', errors.length === 0, errors.join(' / '));
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
