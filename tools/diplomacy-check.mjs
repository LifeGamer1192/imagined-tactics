// 外交の操作を、実際の画面でボタンを押して確かめる。開発サーバー（5183）が要る。
// 相手の領を選ぶところと、心証などの前提をそろえるところだけ開発用の入口（window.__campaign）を使い、操作はすべて画面のボタンで行う。
// 使い方：node tools/diplomacy-check.mjs [画面を撮る先のフォルダ]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
await page.click('[data-sample="sengoku_fid5_1575"]');
await page.waitForSelector('#modeNation');
await page.click('#modeNation');
await page.waitForSelector('#campaign');
await page.click('#campaign');
await page.waitForSelector('#next');

/** 条件に合う勢力を1つ選び、その領を画面で選んだ状態にする。戻り値は勢力の番号と名前 */
const pick = (kind, opinion) => page.evaluate(([kind, opinion]) => {
  const s = window.__campaign, c = s.c, gs = c.gs, me = c.player;
  const pair = (a, b, x, y) => (a === x && b === y) || (a === y && b === x);
  const rel = (f) => {
    if (gs.factions[f].overlord === me || gs.factions[me].overlord === f) return 'ally';
    if (gs.alliances.some(([a, b]) => pair(a, b, me, f))) return 'ally';
    if (gs.wars.some((w) => (w.attackers.includes(me) && w.defenders.includes(f)) || (w.attackers.includes(f) && w.defenders.includes(me)))) return 'war';
    if (gs.truces.some((t) => pair(t.a, t.b, me, f) && t.until > gs.tick)) return 'truce';
    return 'neutral';
  };
  window.__used ??= new Set();
  const f = Object.values(gs.factions).find((x) => x.id !== me && rel(x.id) === kind && !window.__used.has(x.id) && !x.overlord && !gs.factions[me].overlord);
  if (!f) return null;
  window.__used.add(f.id);
  if (opinion !== null) f.opinions[me] = opinion;
  s.selected = gs.provinces.find((p) => p.owner === f.id).id;
  s.refresh();
  return { id: f.id, name: f.name.ja };
}, [kind, opinion]);
const select = (id) => page.evaluate((id) => { const s = window.__campaign; s.selected = s.c.gs.provinces.find((p) => p.owner === id).id; s.refresh(); }, id);
const panel = () => page.textContent('#panel');
const log = () => page.textContent('#log');
/** 外交の窓（P34）を開き、土産を選んで、見込みの文と「申し込む」が押せるかを返す（go なら申し込む、でなければやめる） */
const envoy = async (sel, gift, go) => {
  await page.click(sel);
  await page.waitForSelector('.confirm #envPlan');
  if (gift !== undefined) await page.selectOption('.confirm #envGift', String(gift));
  const plan = await page.textContent('.confirm #envPlan'), can = !(await page.isDisabled('.confirm [data-a="ok"]'));
  await page.click(go ? '.confirm [data-a="ok"]' : '.confirm [data-a="no"]');
  return { plan, can };
};

// 1. 同盟の申し込み：心証が足りないと押せず、理由が出る。足りれば結べる
const a = await pick('neutral', -30);
const a1 = await envoy('[data-envoy="ally"]', 0, false);
ok('心証が足りないと、外交の窓に「断られる見込み」と理由が出る', /断られる見込み/.test(a1.plan) && /心証が足りません/.test(a1.plan), a.name);
const a2 = await envoy('[data-envoy="ally"]', 300, false);
ok('土産を選ぶと、心証の上がりが見込みに出る', /\+1[5-9]|\+[2-9]\d/.test(a2.plan), a2.plan);
await page.evaluate((id) => { const s = window.__campaign; s.c.gs.factions[id].opinions[s.c.player] = 60; s.refresh(); }, a.id);
// 窓の見た目を撮る
await page.click('[data-envoy="ally"]'); await page.waitForSelector('.confirm #envPlan');
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'diplomacy_envoy_window.png') });
await page.click('.confirm [data-a="no"]');
const a3 = await envoy('[data-envoy="ally"]', 0, true);
ok('心証が足りれば「受けてもらえる見込み」と出て、申し込める', /受けてもらえる見込み/.test(a3.plan) && a3.can);
ok('心証が足りれば同盟を結べる（味方と出る）', /味方/.test(await panel()) && (await log()).includes('同盟を結んだ'));

// 2. 戦を仕掛ける → 加勢を頼む（味方の領を選ぶ）
const e = await pick('neutral', null);
await page.click('[data-dip="war"]'); await page.click('.confirm [data-a="ok"]');
ok('戦を仕掛けると交戦中になる', /交戦中/.test(await panel()) && (await log()).includes('戦を仕掛けた'), e.name);
await page.evaluate((id) => { const s = window.__campaign; s.c.gs.factions[id].opinions[s.c.player] = 0; }, a.id);
await select(a.id);
const c1 = await envoy(`[data-envoy="call"][data-enemy="${e.id}"]`, 0, false);
ok('味方の心証が足りないと、加勢は断られる見込みと出る', /断られる見込み/.test(c1.plan) && /心証が足りません/.test(c1.plan));
await page.evaluate((id) => { const s = window.__campaign; s.c.gs.factions[id].opinions[s.c.player] = 80; s.refresh(); }, a.id);
await envoy(`[data-envoy="call"][data-enemy="${e.id}"]`, 0, true);
ok('加勢を頼むと、味方がその戦争に加わる', (await log()).includes('加勢し'));
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'diplomacy_ally.png') });

// 3. 同盟を破る
await page.click('[data-dip="break"]'); await page.click('.confirm [data-a="ok"]');
ok('同盟を破ると中立に戻る', /中立/.test(await panel()) && (await log()).includes('同盟を破った'));

// 4. 停戦を申し込む：相手が大きく優勢なら断られる。そうでなければ結べる
await select(e.id);
const before = await page.evaluate((id) => {
  const s = window.__campaign, gs = s.c.gs;
  // 相手を大きく優勢にする：相手の武将のレベルを一時的に上げる
  const gens = Object.values(gs.generals).filter((g) => g.faction === id);
  const keep = gens.map((g) => g.level);
  gens.forEach((g) => { g.level += 4000; });
  s.refresh();
  return keep;
}, e.id);
const t1 = await envoy('[data-envoy="truce"]', 0, false);
ok('相手が大きく優勢だと、停戦は断られる見込みと理由が出る', /断られる見込み/.test(t1.plan) && /優勢/.test(t1.plan));
await page.evaluate(([id, keep]) => { const s = window.__campaign, gs = s.c.gs; Object.values(gs.generals).filter((g) => g.faction === id).forEach((g, i) => { g.level = keep[i]; }); s.refresh(); }, [e.id, before]);
if (/断られる/.test((await envoy('[data-envoy="truce"]', 0, false)).plan)) {
  // 素の強さでも相手が優勢な組み合わせだった：自分の側を強くして、結べる条件にする
  await page.evaluate(() => { const s = window.__campaign, gs = s.c.gs; Object.values(gs.generals).filter((g) => g.faction === s.c.player).forEach((g) => { g.level += 2; }); s.refresh(); });
}
await envoy('[data-envoy="truce"]', 0, true);
ok('停戦を申し込むと、停戦中になる', /停戦中/.test(await panel()) && (await log()).includes('停戦した'));
ok('停戦中の相手には、親善の使者だけが出る', !(await page.$('[data-dip]')) && !!(await page.$('[data-envoy="goodwill"]')) && (await page.$$('[data-envoy]')).length === 1);
// 親善の使者：心証が上がり、使者は行動済みになる
const gw = await page.evaluate((id) => window.__campaign.c.gs.factions[id].opinions[window.__campaign.c.player] ?? 0, e.id);
const moved0 = await page.evaluate(() => window.__campaign.c.moved.size);
await envoy('[data-envoy="goodwill"]', 100, true);
const gw2 = await page.evaluate((id) => window.__campaign.c.gs.factions[id].opinions[window.__campaign.c.player] ?? 0, e.id);
ok('親善の使者で心証が上がり、使者は行動済みになる', gw2 > gw && (await page.evaluate(() => window.__campaign.c.moved.size)) === moved0 + 1, `心証${gw}→${gw2}`);
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'diplomacy_envoy.png') });

// 5. 相手からの申し込み：同盟を受ける、従属を受ける、断る
const offer = (kind, id) => page.evaluate(([kind, id]) => { const s = window.__campaign; s.c.offers.push({ kind, from: id, until: s.c.gs.tick + 3 }); s.refresh(); }, [kind, id]);
const b = await pick('neutral', 10);
await offer('alliance', b.id);
ok('同盟の申し込みが画面の上に出る', (await panel()).includes(`${b.name}から同盟の申し込み`));
if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], 'diplomacy_offer.png') });
await page.click(`[data-offer="${b.id}"][data-yes]`); await page.click('.confirm [data-a="ok"]');
await select(b.id);
ok('受けると同盟になる', /味方/.test(await panel()) && !(await panel()).includes('申し込み'), b.name);
const v = await pick('neutral', 10);
await offer('vassal', v.id);
await page.click(`[data-offer="${v.id}"][data-yes]`); await page.click('.confirm [data-a="ok"]');
await select(v.id);
ok('従属の申し出を受けると、味方（従属）になる', /味方/.test(await panel()) && (await log()).includes('従属した'), v.name);
const d = await pick('neutral', 10);
await offer('alliance', d.id);
await page.click(`[data-offer="${d.id}"]:not([data-yes])`); await page.click('.confirm [data-a="ok"]');
const after = await page.evaluate((id) => { const s = window.__campaign; return { offers: s.c.offers.length, op: s.c.gs.factions[id].opinions[s.c.player] }; }, d.id);
ok('断ると申し込みが消え、相手の心証が下がる', after.offers === 0 && after.op < 10, JSON.stringify(after));

// 6. そのまま月を進められる（申し込みや戦争が残っていても壊れない）
for (let m = 0; m < 3; m++) {
  await page.click('#next');
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(150); if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]'); else if (await page.$('#next:not(:disabled)')) break; }
}
ok('外交のあとも3か月進められる', !!(await page.$('#next')));
ok('ページのエラーなし', errors.length === 0, errors.join(' / '));
console.log(ng ? `NG ${ng}件` : 'すべて OK');
await browser.close();
process.exit(ng ? 1 : 0);
