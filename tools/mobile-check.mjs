// スマホ・タブレットの画面で、指だけで一通り遊べるかを確かめる。開発サーバー（5183）が要る。
// 機種ごとに：題の画面 → 編成 → 戦い（選ぶ・動かす・技の見込み・実行・取り消し・つまんで寄せる・2本指で拡大）→ 戦略の画面。
// 指の動きは、ブラウザに本物のタッチとして送る。
// 使い方：node tools/mobile-check.mjs [画面を撮る先のフォルダ]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium, devices } = require('playwright');
const URL = process.env.HEX_URL ?? 'http://localhost:5183/';
const DEV = !process.env.HEX_URL;
const LIST = [
  ['phone', 'iPhone 13'], ['phone-land', 'iPhone 13 landscape'], ['phone-small', 'iPhone SE'], ['android', 'Pixel 7'],
  ['ipad', 'iPad (gen 7)'], ['ipad-land', 'iPad (gen 7) landscape'], ['ipad-pro-land', 'iPad Pro 11 landscape'],
];
const browser = await chromium.launch();
let ng = 0;
for (const [tag, name] of LIST) {
  const { defaultBrowserType, ...dev } = devices[name];
  const context = await browser.newContext(dev);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ok = (what, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', `[${tag}] ${what}`, extra); };
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy'));
  const shot = async (n) => { if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], `m_${tag}_${n}.png`) }); };
  /** 画面が横にはみ出していないか、押す所が小さすぎないか */
  const layout = () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const small = [...document.querySelectorAll('button, select, .chip')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0 && (r.height < 32 || r.width < 30); }).map((b) => `${(b.textContent || b.id).trim().slice(0, 8)}:${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
    const off = [...document.querySelectorAll('button, select, canvas, aside')].filter((b) => !b.closest('.speed')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); }).length;
    return { over: document.documentElement.scrollWidth - vw, tall: document.documentElement.scrollHeight - vh, small, off };
  });
  const fits = async (what) => { const l = await layout(); ok(`${what}：横にはみ出さない・押す所が小さすぎない`, l.over <= 1 && l.off === 0 && l.small.length === 0, `はみ出し${l.over}px 画面外${l.off} 小さい：${l.small.slice(0, 4).join(' ') || 'なし'}`); };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const tapXY = async (x, y) => { await page.touchscreen.tap(x, y); await page.waitForTimeout(90); };

  await page.goto(URL);
  await page.waitForSelector('[data-sample]');
  await fits('題の画面');
  await page.tap('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeLocal');
  await idle();
  await fits('モードを選ぶ画面');
  await shot('0_modes');
  await page.tap('#modeLocal');
  await page.waitForSelector('#start');
  await idle();
  await fits('編成の画面');
  await shot('1_setup');

  if (DEV) {
    // ---- 戦い
    await page.tap('#start');
    // 自分で戦う戦いは、配置の段階から始まる
    await page.waitForSelector('#deployDone', { timeout: 60000 });
    await idle();
    await page.waitForTimeout(200);
    await fits('配置の画面');
    ok('配置の画面：見出し「配置」と、画面内に「配置完了」のボタン', /配置/.test(await page.textContent('#panel .turn')) && await page.evaluate(() => { const r = document.querySelector('#deployDone').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width > 0; }));
    await shot('1c_deploy');
    await page.tap('#deployDone');
    await page.waitForSelector('#end', { timeout: 60000 });
    await idle();
    await fits('戦いの画面');
    const size = await page.evaluate(() => { const c = document.querySelector('.battle canvas').getBoundingClientRect(), p = document.querySelector('#panel').getBoundingClientRect(); return { cw: c.width, ch: c.height, pw: p.width, ph: p.height, vw: innerWidth, vh: innerHeight }; });
    ok('戦いの画面：地図と情報欄の両方に十分な広さがある', size.cw >= 240 && size.ch >= 150 && size.pw >= 240 && size.ph >= 90, `地図${Math.round(size.cw)}x${Math.round(size.ch)} 欄${Math.round(size.pw)}x${Math.round(size.ph)}`);
    const cellXY = (cell) => page.evaluate((c) => { const a = window.__app, v = a.view, [wx, wy] = a.st.map.grid.center(c, 34), [sx, sy] = v.cam.toScreen(wx, wy), r = v.canvas.getBoundingClientRect(); return [r.left + sx, r.top + sy]; }, cell);
    /** マスが地図の中に見えるように寄せてから、その位置を返す */
    const showCell = async (cell) => {
      await page.evaluate((c) => { const a = window.__app, v = a.view, [wx, wy] = a.st.map.grid.center(c, 34), [sx, sy] = v.cam.toScreen(wx, wy), r = v.canvas.getBoundingClientRect(); v.cam.panBy(r.width / 2 - sx, r.height / 2 - sy); a.refresh(); }, cell);
      return cellXY(cell);
    };
    // 自分の兵を、相手の隣へ置く（確かめるための下ごしらえ）
    const plan = await page.evaluate(async () => {
      const { skillTargetCells, canUseSkill } = await import('/src/rules/combat.ts');
      const { skillOf } = await import('/src/rules/stats.ts');
      const a = window.__app, st = a.st, g = st.map.grid;
      const used = new Set(st.units.filter((x) => x.alive).map((x) => x.pos));
      // 置いてみて、技が相手に届く組み合わせを探す
      for (const f of st.units.filter((x) => x.alive && x.side === 1)) for (const u of st.units.filter((x) => x.alive && x.side === 0)) {
        const home = u.pos, skill = skillOf(u.skills[0]);
        for (let c = 0; c < st.map.terrain.length; c++) {
          if (used.has(c) || g.distance(c, f.pos) !== 1) continue;
          u.pos = c;
          if (canUseSkill(st, u, skill) && skillTargetCells(st, u, skill).includes(f.pos)) { a.refresh(); return { id: u.id, pos: u.pos, skill: u.skills[0], target: f.pos }; }
        }
        u.pos = home;
      }
      return null;
    });
    // 1本指で地図を寄せる、2本指で拡大する
    const cam0 = await page.evaluate(() => { const c = window.__app.view.cam; return { x: c.x, y: c.y, zoom: c.zoom }; });
    const box = await (await page.$('.battle canvas')).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx - 30 - i * 8, cy], [cx + 30 + i * 8, cy]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(80);
    const cam2 = await page.evaluate(() => { const c = window.__app.view.cam; return { x: c.x, y: c.y, zoom: c.zoom }; });
    ok('2本指を広げると、地図が大きくなる', cam2.zoom > cam0.zoom * 1.2, `${cam0.zoom.toFixed(2)} → ${cam2.zoom.toFixed(2)}`);
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[cx - i * 10, cy - i * 6]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(80);
    const cam1 = await page.evaluate(() => { const c = window.__app.view.cam; return { x: c.x, y: c.y, zoom: c.zoom, sel: window.__app.selected }; });
    ok('1本指でなぞると、地図が動く（押したことにはならない）', (cam1.x !== cam2.x || cam1.y !== cam2.y) && cam1.sel === null);
    const scrolled = await page.evaluate(() => scrollY);
    ok('地図をなぞっても、ページそのものは動かない', scrolled === 0);
    // 兵を押して選ぶ → 技を選ぶ → 対象を1度押すと見込み、もう1度で実行
    await tapXY(...(await showCell(plan.pos)));
    ok('自分の兵を指で押すと、選べる', await page.evaluate((id) => window.__app.selected === id, plan.id));
    ok('「選択を解く」のボタンが出る', !!(await page.$('#cancel')));
    await fits('兵を選んだ画面');
    await page.tap(`[data-skill="${plan.skill}"]`);
    const log0 = await page.evaluate(() => window.__app.st.log.length);
    await tapXY(...(await showCell(plan.target)));
    const fc = (await page.textContent('#forecast')) ?? '';
    ok('対象を1度押すと、見込みが出るだけで実行はされない', /命中\s*\d+%/.test(fc) && fc.includes('もう1度押すと実行') && (await page.evaluate(() => window.__app.st.log.length)) === log0, fc.slice(0, 30));
    await shot('2_forecast');
    // 「技・軍略をやめる」で取り消せる
    await page.tap('#cancel');
    ok('「技・軍略をやめる」で、技の選択を取り消せる', await page.evaluate(() => window.__app.mode.type === 'idle'));
    await page.tap(`[data-skill="${plan.skill}"]`);
    await tapXY(...(await showCell(plan.target)));
    await tapXY(...(await cellXY(plan.target)));
    await page.waitForTimeout(150);
    ok('同じ対象をもう1度押すと、実行される', (await page.evaluate(() => window.__app.st.log.length)) > log0);
    // 空いたマスを押して動かす
    const mv = await page.evaluate(() => { const a = window.__app, st = a.st; const u = st.units.find((x) => x.alive && x.side === 0 && !x.acted && !x.moved && x.kind === 'general'); return u ? { id: u.id, pos: u.pos } : null; });
    if (mv) {
      await tapXY(...(await showCell(mv.pos)));
      const dest = await page.evaluate(() => [...(window.__app.view.hl.move ?? [])][0] ?? -1);
      if (dest >= 0) {
        await tapXY(...(await showCell(dest)));
        ok('青いマスを指で押すと、動かせる', await page.evaluate(([id, d]) => window.__app.st.units[id].pos === d, [mv.id, dest]));
      }
      await page.tap('#cancel');
      ok('「選択を解く」で、選択が外れる', await page.evaluate(() => window.__app.selected === null));
    }
    await page.tap('#end');
await page.waitForTimeout(200);
if (await page.$('.confirm [data-a="ok"]')) await page.tap('.confirm [data-a="ok"]');
    await page.waitForFunction(() => window.__app.st.winner !== null || (window.__app.st.turn === 0 && window.__app.st.round >= 2), null, { timeout: 90000 });
    ok('「巡を終える（全員待機）」で相手が動き、自分の番に戻る', true);
    await shot('3_battle');
    await page.tap('#quit'); await page.tap('.confirm [data-a="ok"]');
    await page.waitForSelector('#start');
    await idle();
  }

  // ---- 戦略（編成 →「モードを選ぶ」→ 国モード → 国を選ぶ画面）
  await page.tap('#toModes');
  await page.waitForSelector('#modeNation');
  await page.tap('#modeNation');
  await page.waitForSelector('#campaign');
  await idle();
  await fits('国を選ぶ画面');
  await shot('1b_nations');
  await page.tap('#campaign');
  await page.waitForSelector('#next');
  await idle();
  await fits('戦略の画面');
  const s2 = await page.evaluate(() => { const c = document.querySelector('.battle canvas').getBoundingClientRect(), p = document.querySelector('#panel').getBoundingClientRect(), n = document.querySelector('#next').getBoundingClientRect(); return { cw: c.width, ch: c.height, pw: p.width, ph: p.height, next: n.top >= 0 && n.bottom <= innerHeight, scroll: document.querySelector('#panel').scrollHeight > document.querySelector('#panel').clientHeight }; });
  ok('戦略の画面：地図と情報欄に十分な広さがあり、「月を進める」が見えている', s2.cw >= 240 && s2.ch >= 150 && s2.pw >= 240 && s2.ph >= 90 && s2.next, `地図${Math.round(s2.cw)}x${Math.round(s2.ch)} 欄${Math.round(s2.pw)}x${Math.round(s2.ph)}`);
  await shot('4_campaign');
  // 情報欄は指でなぞって送れる
  const pb = await (await page.$('#panel')).boundingBox();
  const px = pb.x + 12, py = pb.y + pb.height - 30;
  await touch('touchStart', [[px, py]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[px, py - i * 12]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await page.waitForTimeout(250);
  ok('情報欄は、指でなぞって送れる', !s2.scroll || (await page.evaluate(() => document.querySelector('#panel').scrollTop)) > 0);
  await page.evaluate(() => { document.querySelector('#panel').scrollTop = 0; });
  // なぞって送った直後の1回めの「押す」は、送りを止める操作として扱われる（ブラウザの決まり）。何もない所を1度押しておく
  await page.tap('.turn');
  await page.waitForTimeout(400);
  // 月を進める（攻められたら、おまかせで決着）
  await page.tap('#next');
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(250);
    if (await page.evaluate(() => /1575年2月/.test(document.querySelector('.turn')?.textContent ?? '') && !document.querySelector('.busy') && !document.querySelector('.result'))) break;
    if (await page.$('.busy')) continue;
    const b = (await page.$('.result [data-a="auto"]')) ?? (await page.$('#auto')) ?? (await page.$('.result button'));
    if (b) await b.tap().catch(() => {});
  }
  ok('「月を進める」で、次の月になる', await page.evaluate(() => /1575年2月/.test(document.querySelector('.turn').textContent)), (await page.textContent('.turn')).slice(0, 12));
  // 遊び方の案内
  await page.tap('.help-btn');
  await page.waitForSelector('.help');
  const hb = await page.evaluate(() => { const h = document.querySelector('.help').getBoundingClientRect(); return h.left >= 0 && h.right <= innerWidth + 1 && h.top >= 0 && h.bottom <= innerHeight + 1; });
  ok('遊び方の案内が、画面に収まって開く', hb);
  await shot('5_help');
  ok('ページのエラーなし', errors.length === 0, errors.join(' / '));
  await context.close();
}
console.log(ng ? `NG ${ng}件` : 'すべて OK');
await browser.close();
process.exit(ng ? 1 : 0);
