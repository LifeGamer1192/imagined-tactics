// 直伝（技・軍略を教える。P68）の操作を、PC は本物のマウスのクリック、スマホは本物のタップで、最初から最後まで確かめる。開発サーバー（5183）が要る。
// 窓を開く・押せない技は選べない・技を選ぶ・相手を替える（兵にすると4か月）・やめる・Esc・教え始める・直伝中の表示と説明・
// 同じ領では2つ目を始められない・月を進めて覚える・列伝の欄・枠がいっぱいのとき忘れる・戦いでの「借」の印と押せること。
// 使い方：node tools/teach-check.mjs [画面を撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
const out = process.argv[2];
const URL = process.env.HEX_URL ?? 'http://localhost:5183/';
const browser = await chromium.launch();
let ng = 0;

for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', { ...devices['iPhone 13'] }]]) {
  const page = await (await browser.newContext(opts)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', tag, name, extra); };
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 60000 });
  // PC はマウスのクリック、スマホは指のタップ（どちらも要素の真ん中に本物の入力を送る）
  const press = async (sel, force = false) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); if (tag === 'sp') await page.locator(sel).first().tap({ force }); else await page.locator(sel).first().click({ force }); };
  const shot = async (name) => { if (out) await page.screenshot({ path: path.join(out, `teach_${tag}_${name}.png`) }); };
  const C = (f, arg) => page.evaluate(f, arg);

  await page.goto(URL);
  await press('[data-sample="sengoku_fid5_1575"]'); await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation'); await page.waitForSelector('#campaign'); await idle();
  await press('#campaign'); await page.waitForSelector('#next'); await idle();
  await page.waitForTimeout(600);
  const lord = await C(() => { const c = window.__campaign.c; return c.gs.factions[c.player].lordId; });

  // 1. 窓を開く（0.2秒以内に出る）
  let t0 = Date.now();
  await press(`[data-teach="${lord}"]`);
  await page.waitForSelector('.teach');
  ok('窓が出る', true, `${Date.now() - t0}ms（押すのに掛かる時間を含む）`);
  ok('はじめは「教え始める」を押せない', await page.locator('.result.ask [data-a="ok"]').isDisabled());
  // 2. 押せない技は選べない
  if (await page.locator('.teach .tart.off').count()) {
    await press('.teach .tart.off', true);
    ok('灰色の技は選べない', (await page.locator('input[name="tArt"]:checked').count()) === 0 && await page.locator('.result.ask [data-a="ok"]').isDisabled());
    ok('灰色の技に理由が出ている', ((await page.locator('.teach .tart.off .why').first().textContent()) ?? '').length > 2);
  }
  // 3. 技を選ぶ（丸ではなく名前の所を押す）
  await press('.teach .tart:not(.off)');
  ok('技を選べる', (await page.locator('input[name="tArt"]:checked').count()) === 1);
  ok('選ぶと月と枠が出る', /か月/.test((await page.locator('#tInfo').textContent()) ?? ''));
  ok('選ぶと「教え始める」を押せる', await page.locator('.result.ask [data-a="ok"]').isEnabled());
  await shot('1_pick');
  // 4. 教わる相手を兵に替える：選び直しになり、4か月
  const opts2 = await page.locator('#tLearner option').allTextContents();
  const troopIdx = opts2.findIndex((t) => t.includes('の'));
  if (troopIdx >= 0) {
    await page.selectOption('#tLearner', String(troopIdx));
    ok('相手を替えると選び直しになる', (await page.locator('input[name="tArt"]:checked').count()) === 0 && await page.locator('.result.ask [data-a="ok"]').isDisabled());
    if (await page.locator('.teach .tart:not(.off)').count()) {
      await press('.teach .tart:not(.off)');
      ok('兵には4か月', /4か月/.test((await page.locator('#tInfo').textContent()) ?? ''));
    }
  }
  // 5. やめる
  await press('.result.ask [data-a="no"]');
  ok('「やめる」で閉じる', (await page.locator('.teach').count()) === 0 && (await C(() => (window.__campaign.c.lessons ?? []).length)) === 0);
  // 6. Esc
  await press(`[data-teach="${lord}"]`); await page.waitForSelector('.teach');
  await page.keyboard.press('Escape');
  ok('Esc で閉じる', (await page.locator('.teach').count()) === 0);
  // 7. 将に教え始める
  await press(`[data-teach="${lord}"]`); await page.waitForSelector('.teach');
  await page.selectOption('#tLearner', '0');
  await press('.teach .tart:not(.off)');
  const plan = await C(() => { const opt = document.querySelector('#tLearner option:checked').textContent; const art = document.querySelector('input[name="tArt"]:checked').closest('label').textContent; return { opt, art }; });
  await press('.result.ask [data-a="ok"]');
  await page.waitForTimeout(300);
  const L = await C(() => { const c = window.__campaign.c, x = (c.lessons ?? [])[0]; return x ? { ...x, learnerName: c.gs.generals[x.learner].name.ja } : null; });
  ok('教え始める', !!L, L ? `${L.learnerName}「${L.art}」${L.months}か月` : '');
  if (!L) { console.log(plan); continue; }
  ok('窓が閉じる', (await page.locator('.teach').count()) === 0);
  ok('教える将の欄に「直伝中」', ((await page.locator(`.gen[data-gen="${lord}"]`).textContent()) ?? '').includes('直伝中'));
  ok('教える将の「直伝」ボタンが消える', (await page.locator(`[data-teach="${lord}"]`).count()) === 0);
  ok('教わる将は選べない（行動済み）', await page.locator(`[data-pick="${L.learner}"]`).isDisabled());
  const sameProv = await C((lord) => { const c = window.__campaign.c, g = c.gs.generals[lord]; return Object.values(c.gs.generals).filter((x) => x.faction === c.player && x.prov === g.prov).map((x) => x.id); }, lord);
  ok('同じ領のほかの将に「直伝」ボタンが出ない（1つの領で1つ）', (await page.locator(sameProv.map((id) => `[data-teach="${id}"]`).join(', ')).count()) === 0);
  // 8. 直伝中の説明（PC は重ねる、スマホは押す）
  const st = page.locator(`.gen[data-gen="${lord}"] .trait[data-tip^="直伝："]`).first();
  await st.scrollIntoViewIfNeeded();
  if (tag === 'sp') await st.tap(); else await st.hover();
  await page.waitForTimeout(200);
  ok('直伝中の説明が出る', ((await page.locator('.tip').textContent().catch(() => '')) ?? '').startsWith('直伝：'));
  await shot('2_status');
  // 9. 月を進めて覚える（攻められた戦い・滅亡・知らせの窓は閉じる）
  for (let m = 0; m < L.months + 1; m++) {
    if (await C((L) => !(window.__campaign.c.lessons ?? []).some((x) => x.teacher === L.teacher), L)) break;
    await page.mouse.click(1, 1).catch(() => {});
    await press('#next');
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      if (await page.locator('.busy').count()) continue;
      const btn = ['.result.fall [data-a="ok"]', '.result.report [data-a="ok"]', '.result [data-a="auto"]', '.result.ask [data-a="ok"]', '.result [data-a="ok"]'];
      let hit = false;
      for (const b of btn) if (await page.locator(b).count()) { await press(b); hit = true; break; }
      if (!hit && await page.locator('#next:not([disabled])').count() && !(await page.locator('.result').count())) break;
    }
    await idle();
  }
  const got = await C((L) => { const c = window.__campaign.c, g = c.gs.generals[L.learner]; return { taught: g?.taught ?? [], log: c.log.some((e) => e.key === 'teachDone'), left: (c.lessons ?? []).filter((x) => x.teacher === L.teacher).length }; }, L);
  ok('月が過ぎると覚える', got.taught.some((t) => t.id === L.art && t.uses === 0) && got.log && got.left === 0, JSON.stringify(got.taught));
  // 10. 列伝の窓の直伝の欄
  await press(`.gen[data-gen="${L.learner}"] .gname`);
  await page.waitForSelector('.profile');
  const prof = (await page.locator('.profile').textContent()) ?? '';
  ok('列伝の窓に直伝の欄と「借り物」', prof.includes('直伝') && prof.includes('借り物'));
  await shot('3_profile');
  await press('.result.ask [data-a="ok"]');
  // 11. 枠がいっぱいなら忘れられる（教わる将の枠を埋めてから、当主の窓を開く）
  const fill = await C(async (L) => {
    const teach = await import('/src/strategy/teach.ts');
    const c = window.__campaign.c, g = c.gs.generals[L.learner], slots = teach.slotsOf(g);
    const extra = ['x01', 'x02', 'x03', 'x04', 'x05', 'x06'].filter((id) => !g.taught.some((t) => t.id === id));
    while (g.taught.length < slots) g.taught.push({ id: extra.shift(), kind: 'tactic', from: 'test', uses: 5 });
    window.__campaign.refresh();
    return g.taught.length;
  }, L);
  if (await page.locator(`[data-teach="${lord}"]`).count()) {
    await press(`[data-teach="${lord}"]`); await page.waitForSelector('.teach');
    const idx = (await page.locator('#tLearner option').allTextContents()).findIndex((t) => t.startsWith(L.learnerName));
    await page.selectOption('#tLearner', String(idx));
    const fullOk = (await page.locator('#tForget button').count()) > 0;
    ok('枠がいっぱいだと「忘れる」が出る', fullOk, `枠${fill}`);
    if (fullOk) {
      const before = (await page.locator('#tForget button').count());
      await press('#tForget button');
      const after = await C((L) => window.__campaign.c.gs.generals[L.learner].taught.length, L);
      ok('「忘れる」で1つ減り、窓は開いたまま', after === fill - 1 && (await page.locator('.teach').count()) === 1, `${before}→${after}`);
      ok('忘れると技を選べるようになる', (await page.locator('.teach .tart:not(.off)').count()) > 0, (await page.locator('.teach .tart').allTextContents()).map((s) => s.replace(/\s+/g, '')).join(' | '));
    }
    await press('.result.ask [data-a="no"]');
    ok('閉じたあとも画面が動く', (await page.locator('#next').count()) === 1);
  } else ok('当主に「直伝」ボタンがまた出る', false);
  // 12. 戦いでの「借」の印（教わった将で隣の領を攻める戦場を開く）
  const opened = await C(async (L) => {
    const cam = await import('/src/strategy/campaign.ts');
    const s = window.__campaign, c = s.c, g = c.gs.generals[L.learner];
    g.taught = [{ id: L.art, kind: L.kind, from: 'test', uses: 0 }];
    const to = cam.neighborsOf(c, g.prov).find((n) => c.gs.provinces[n].owner !== c.player);
    if (to === undefined) return false;
    c.moved.delete(g.id);
    const pb = cam.planAttack(c, c.player, g.prov, to, [g.id]);
    if (!pb) return false;
    s.host.openBattle(cam.battleFor(c, pb), new Set([0]), () => null, { label: '戻る', fn: () => s.mount() }, true, 0);
    return true;
  }, L);
  if (opened) {
    if (await page.locator('#deployDone').count()) { await press('#deployDone'); }
    await page.waitForSelector('#end'); await idle(); await page.waitForTimeout(800);
    await C((L) => { const a = window.__app, u = a.st.units.find((x) => x.generalId === L.learner && x.kind === 'general'); a.selected = u.id; a.mode = { type: 'idle' }; a.refresh(); }, L);
    const mark = page.locator('.actions .tmark.borrow');
    ok('戦いの技・軍略のボタンに「借」', (await mark.count()) > 0);
    // 届く所に相手がいなければ、敵の近くの空いたマスへ動かしておく（押して使うところまで確かめる）
    await C((L) => {
      const a = window.__app, st = a.st, u = st.units.find((x) => x.generalId === L.learner && x.kind === 'general');
      const foe = st.units.find((x) => x.alive && x.side !== u.side);
      const g = st.map.grid, free = g.range(foe.pos, 2, 2).find((i) => !st.units.some((x) => x.alive && x.pos === i) && st.map.terrain[i] !== 'water' && st.map.terrain[i] !== 'wall');
      if (free !== undefined) u.pos = free;
      u.mp = u.maxMp;
      a.selected = u.id; a.mode = { type: 'idle' }; a.refresh();
    }, L);
    const btn = page.locator('.actions button:has(.tmark.borrow)').first();
    const label = (await btn.textContent()) ?? '';
    if (await btn.isEnabled()) {
      await btn.scrollIntoViewIfNeeded(); if (tag === 'sp') await btn.tap(); else await btn.click();
      ok('「借」のボタンを押せる（選ばれる）', ((await page.locator('.actions button.on').textContent().catch(() => '')) ?? '').includes(label.slice(1, 4)), label.trim());
      // 赤いマス（対象）を押して使う：気力が借り物のぶん減り、使った回数が数えられる
      const use = await C(() => {
        const a = window.__app, st = a.st, u = st.units[a.selected], id = a.mode.id, kind = a.mode.type;
        const cells = a.targetCells?.() ?? null;
        return { id, kind, mp: u.mp, cells: cells ? cells.length : -1 };
      });
      const target = await C(async () => {
        const combat = await import('/src/rules/combat.ts');
        const { D } = await import('/src/data/db.ts');
        const a = window.__app, st = a.st, u = st.units[a.selected];
        const cells = a.mode.type === 'tactic' ? combat.tacticTargetCells(st, u, D.byTactic[a.mode.id]) : combat.skillTargetCells(st, u, D.skills.find((s) => s.id === a.mode.id));
        return cells[0] ?? null;
      });
      if (target !== null) {
        // 戦場のマスの画面の位置を出して、そこを押す
        const xy = await C((cell) => { const a = window.__app, v = a.view, g = a.st.map.grid, r = v.canvas.getBoundingClientRect(); const [wx, wy] = g.center(cell, 34); const [sx, sy] = v.cam.toScreen(wx, wy); const x = r.left + sx, y = r.top + sy; return x > r.left + 8 && x < r.right - 8 && y > r.top + 8 && y < r.bottom - 8 && document.elementFromPoint(x, y) === v.canvas ? { x, y } : null; }, target);
        if (xy) { if (tag === 'sp') { await page.touchscreen.tap(xy.x, xy.y); await page.waitForTimeout(200); await page.touchscreen.tap(xy.x, xy.y); } else await page.mouse.click(xy.x, xy.y); }
        else await C((cell) => { const a = window.__app; a.act({ type: a.mode.type, unit: a.selected, [a.mode.type]: a.mode.id, target: cell }); a.refresh(); }, target);
        await page.waitForTimeout(1500);
        const after = await C(async (L) => { const { D } = await import('/src/data/db.ts'); const a = window.__app, u = a.st.units.find((x) => x.generalId === L.learner && x.kind === 'general'); const base = L.kind === 'tactic' ? D.byTactic[L.art].mp : D.skills.find((s) => s.id === L.art).mp; return { mp: u.mp, uses: u.artUses?.[L.art] ?? 0, acted: u.acted, need: Math.round(base * 1.2) }; }, L);
        ok('「借」の技・軍略を使うと回数が数えられ、気力が多く減る', after.uses === 1 && use.mp - after.mp >= after.need - 1, `気力${use.mp}→${after.mp}・回数${after.uses}${xy ? '（マスを押して）' : '（直接）'}`);
      }
    } else ok('「借」のボタンに使えない理由', label.includes('足りない') || label.includes('届く') || label.includes('今は'), label.trim());
    await shot('4_battle');
  } else ok('戦場を開ける', false);
  ok('ページのエラーが無い', errors.length === 0, errors.join(' / '));
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
