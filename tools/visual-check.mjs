// 絵や表示を変えた箇所を、ひととおり画面に出して撮る（目で確かめるため）。あわせて、出るべきものが出ているかを確かめる。
// 開発サーバー（5183）が要る。使い方：node tools/visual-check.mjs <画面を撮る先のフォルダ>
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium, devices } = require('playwright');
const out = process.argv[2];
if (!out) { console.error('撮る先のフォルダを指定してください'); process.exit(1); }
mkdirSync(out, { recursive: true });
const URL = process.env.HEX_URL ?? 'http://localhost:5183/';
const browser = await chromium.launch();
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };

async function run(tag, ctxOpts) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url()) && !/ABORTED/.test(r.failure()?.errorText ?? '')) errors.push(`読めない：${r.url()}`); });
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy'));
  let n = 0;
  const shot = async (name) => { n++; await page.waitForTimeout(150); await page.screenshot({ path: path.join(out, `${tag}_${String(n).padStart(2, '0')}_${name}.png`) }); };
  const touch = !!ctxOpts.hasTouch;
  const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
  const loaded = (sel) => page.$$eval(sel, (els) => els.every((e) => e.complete ? e.naturalWidth > 0 : true));
  const bgOk = (sel, prop = 'backgroundImage') => page.$eval(sel, (el, p) => getComputedStyle(el)[p].includes('url('), prop);

  // ---- 題
  await page.goto(URL);
  await page.waitForSelector('[data-sample]');
  await page.waitForTimeout(600);
  await shot('title');
  ok(`[${tag}] アイコンとマニフェストが読める`, await page.evaluate(async () => (await fetch('icon-180.png')).ok && (await fetch('manifest.webmanifest').then((r) => r.json())).icons.length === 2));

  for (const [sample, v] of [['sengoku_fid5_1575', 'jp'], ['shunju_fid5_259bc', 'cn']]) {
    await page.goto(URL);
    await press(`[data-sample="${sample}"]`);
    // ---- モードを選ぶ画面
    await page.waitForSelector('#modeLocal'); await idle(); await page.waitForTimeout(500);
    ok(`[${tag}] モードを選ぶ画面に国モードと局地戦モードのボタン（${v}）`, (await page.isVisible('#modeNation')) && (await page.isVisible('#modeLocal')));
    await shot(`modes_${v}`);
    if (v === 'jp') {
      // ---- 別のセーブ：確かめる窓
      await press('#back');
      await page.waitForSelector('.confirm');
      await shot('confirm_back');
      await press('.confirm [data-a="no"]');
      // ---- 国を選ぶ画面
      await press('#modeNation');
      await page.waitForSelector('#campaign'); await idle(); await page.waitForTimeout(300);
      ok(`[${tag}] 国を選ぶ画面に国の一覧と始めるボタン`, (await page.$$('input[name="nation"]')).length >= 2 && (await page.isVisible('#campaign')) && (await page.isVisible('#campaignWatch')));
      ok(`[${tag}] 国を選ぶ画面に広域地図`, await page.$eval('.nation-map canvas', (el) => el.width > 100 && el.height > 50));
      await shot('nations_jp');
      // ランダム：選ばれる国が変わり、地図も描き直される
      const nBefore = await page.$eval('input[name="nation"]:checked', (el) => el.value);
      const mapBefore = await page.$eval('.nation-map canvas', (el) => el.toDataURL());
      await press('#nationRandom');
      await page.waitForTimeout(250);
      const nAfter = await page.$eval('input[name="nation"]:checked', (el) => el.value);
      ok(`[${tag}] ランダムで国が変わり、地図のハイライトも変わる`, nAfter !== nBefore && (await page.$eval('.nation-map canvas', (el) => el.toDataURL())) !== mapBefore && /で始める/.test(await page.textContent('#campaign')));
      await page.$eval('.nation-map', (el) => el.scrollIntoView({ block: 'center' }));
      await shot('nations_random');
      await press('#toModes');
      await page.waitForSelector('#modeLocal'); await idle();
    }
    await press('#modeLocal');
    await page.waitForSelector('#start'); await idle(); await page.waitForTimeout(300);
    ok(`[${tag}] 編成の画面に陣営の絵（${v}）`, await page.evaluate((v) => getComputedStyle(document.body).backgroundImage.includes(`setup_${v}`), v));
    await shot(`setup_${v}`);
    if (v === 'cn') break;

    // ---- 戦闘：まず配置の段階
    await press('#start');
    await page.waitForSelector('#deployDone'); await idle();
    await page.waitForTimeout(300);
    ok(`[${tag}] 自分で戦うと配置の段階から始まる（見出し「配置」と配置完了のボタン、ターン終了は無い）`,
      /配置/.test(await page.textContent('#panel .turn')) && (await page.isVisible('#deployDone')) && !(await page.$('#end')) && !(await page.$('#quit')));
    await shot('battle_deploy');
    // 配置：自分の駒を押してから青いマスを押すと動く（画面の上で本当に押す）
    const dp = await page.evaluate(() => {
      const a = window.__app, v = a.view, st = a.st, g = st.map.grid, r = v.canvas.getBoundingClientRect();
      const xy = (c) => { const [wx, wy] = g.center(c, 34); const [sx, sy] = v.cam.toScreen(wx, wy); return [r.left + sx, r.top + sy]; };
      const vis = (c) => { const [x, y] = xy(c); return x > r.left + 8 && x < r.right - 8 && y > r.top + 8 && y < r.bottom - 8 && document.elementFromPoint(x, y) === v.canvas; };
      for (const u of st.units.filter((x) => x.side === 0 && x.alive && vis(x.pos))) {
        const to = a.deployCells(u).find((c) => vis(c) && !st.units.some((x) => x.pos === c));
        if (to !== undefined) return { id: u.id, from: xy(u.pos), to: xy(to), cell: to };
      }
      return null;
    });
    const tapAt = async ([x, y]) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await page.waitForTimeout(120); };
    if (dp) {
      await tapAt(dp.from);
      ok(`[${tag}] 配置で自分の駒を押すと選ばれ、青いマスが出る`, await page.evaluate((id) => window.__app.selected === id && (window.__app.view.hl.move?.size ?? 0) > 0, dp.id));
      await shot('battle_deploy_selected');
      await tapAt(dp.to);
    }
    ok(`[${tag}] 配置で駒を選ぶと青いマスが出て、押すとそこへ動く`, !!dp && await page.evaluate(([id, c]) => window.__app.st.units[id].pos === c && window.__app.deploying, [dp.id, dp.cell]), dp ? '' : '押せる駒と空きマスが見つからない');
    await press('#deployDone');
    await page.waitForSelector('#end'); await idle();
    await page.waitForTimeout(250);
    ok(`[${tag}] 開戦の筆の帯が出る`, !!(await page.$('.splash')) && (await bgOk('.splash')));
    await shot('battle_splash');
    await page.waitForTimeout(1700);
    ok(`[${tag}] 天気の欄に天気の帯の絵`, await page.$eval('#sky', (el) => el.getAttribute('style')?.includes('weather_')));
    await shot('battle_sky_flash');
    const w0 = await page.evaluate(() => window.__app.st.weather ?? 'clear');
    for (const w of ['rain', 'snow', 'fog', 'clear'].filter((x) => x !== w0).concat(w0)) {
      await page.evaluate((w) => { const a = window.__app; a.st.weather = w; a.refresh(); }, w);
      await page.waitForTimeout(250);
      ok(`[${tag}] 天気が変わると光る（${w}）`, await page.$eval('#sky', (el) => el.classList.contains('flash')));
      await page.screenshot({ path: path.join(out, `${tag}_sky_${w}.png`), clip: await page.$eval('#sky', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 }; }) });
    }
    // 技を選ぶ：説明と期待値の表
    const plan = await page.evaluate(async () => {
      const { skillTargetCells, canUseSkill } = await import('/src/rules/combat.ts');
      const { skillOf } = await import('/src/rules/stats.ts');
      const a = window.__app, st = a.st, g = st.map.grid, used = new Set(st.units.filter((x) => x.alive).map((x) => x.pos));
      for (const f of st.units.filter((x) => x.alive && x.side === 1)) for (const u of st.units.filter((x) => x.alive && x.side === 0)) {
        const home = u.pos, s = skillOf(u.skills[0]);
        for (let c = 0; c < st.map.terrain.length; c++) {
          if (used.has(c) || g.distance(c, f.pos) !== 1) continue;
          u.pos = c;
          if (canUseSkill(st, u, s) && skillTargetCells(st, u, s).includes(f.pos)) { a.selected = u.id; a.refresh(); return { id: u.id, skill: u.skills[0], tac: st.units.find((x) => x.alive && x.side === 0 && x.tactics.length)?.id ?? -1 }; }
        }
        u.pos = home;
      }
      return null;
    });
    await press(`[data-skill="${plan.skill}"]`);
    await page.waitForTimeout(200);
    ok(`[${tag}] 技を選ぶと説明と期待値の表`, !!(await page.$('.minfo')) && /期待値/.test(await page.textContent('table.expect')));
    await shot('battle_skill_info');
    if (!touch) {
      // 欄が送られると小窓は消える作りなので、先にボタンを見える所に出して、送りが収まってから重ねる
      await page.$eval(`[data-skill="${plan.skill}"]`, (el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
      await page.hover(`[data-skill="${plan.skill}"]`);
      await page.waitForTimeout(200);
      ok(`[${tag}] 技のボタンに重ねると小窓`, !!(await page.$('.tip')));
      await shot('battle_skill_tip');
      await page.mouse.move(5, 5);
    }
    if (plan.tac >= 0) {
      await page.evaluate((id) => { const a = window.__app; a.selected = id; a.mode = { type: 'idle' }; a.refresh(); }, plan.tac);
      const tb = await page.$('[data-tactic]:not([disabled])');
      if (tb) { await tb.click(); await page.waitForTimeout(200); ok(`[${tag}] 軍略を選ぶと説明`, !!(await page.$('.minfo'))); await shot('battle_tactic_info'); }
    }
    await page.evaluate(() => { const a = window.__app; a.mode = { type: 'idle' }; a.selected = null; a.refresh(); });
    // P32：駒を選んでマスに乗せると、そのマスで起きることの説明。待機した駒は「済」（行動済み）
    const p32 = await page.evaluate(async () => {
      const { apply } = await import('/src/battle/engine.ts');
      const a = window.__app, st = a.st, g = st.map.grid;
      const mine = st.units.filter((x) => x.alive && x.side === st.turn && !x.acted);
      if (mine.length < 2) return null;
      const u = mine[0];
      const cell = g.neighbors(u.pos).find((c) => st.map.terrain[c] !== 'void' && !st.units.some((x) => x.alive && x.pos === c));
      a.selected = u.id; a.hoverCell = cell ?? u.pos; a.refresh();
      const info = document.querySelector('#cellinfo')?.textContent ?? '';
      const w = mine[1];
      apply(st, { type: 'wait', unit: w.id });
      a.selected = null; a.refresh();
      return { info, done: a.view.hl.done?.has(w.id) ?? false, readyOthers: !a.view.hl.done?.has(u.id) };
    });
    if (p32) {
      ok(`[${tag}] 駒を選んでマスに乗せると、そのマスで起きることが出る`, /命中・回避/.test(p32.info) && /(移動できる|いまいるマス|入れない|届かない|いる)/.test(p32.info), p32.info.slice(0, 60));
      ok(`[${tag}] 待機した駒は行動済み（済）、まだの駒は違う見た目`, p32.done && p32.readyOthers);
      await shot('battle_done_mark');
    }
    // 部隊ごとの退却：初期配置のマスにいる武将を選ぶと「退却（この部隊）」が出る
    const wd = await page.evaluate(() => {
      const a = window.__app, st = a.st;
      const g = st.units.find((u) => u.alive && u.kind === 'general' && u.side === st.turn && st.map.spawn[u.home].includes(u.pos));
      if (!g) return false;
      a.selected = g.id; a.mode = { type: 'idle' }; a.refresh();
      return true;
    });
    if (wd) {
      ok(`[${tag}] 初期配置のマスにいる武将には「退却（この部隊）」が出る`, !!(await page.$('#withdraw')));
      await press('#withdraw');
      await page.waitForSelector('.confirm');
      ok(`[${tag}] 退却の窓に、兵を失わず翌月休養と出る`, /兵は失わず/.test(await page.textContent('.confirm')) && /休養/.test(await page.textContent('.confirm')));
      await shot('battle_withdraw');
      await press('.confirm [data-a="no"]');
      await page.evaluate(() => { const a = window.__app; a.selected = null; a.refresh(); });
    }
    // 一部だけおまかせ（P44）：駒を選んで「この駒をおまかせ」→ その駒が自動で動き「任」が付く。「おまかせを外す」で全員手動
    const au = await page.evaluate(() => {
      const a = window.__app, st = a.st;
      const u = st.units.find((x) => x.alive && x.side === st.turn && !x.acted && !x.moved && x.kind === 'troop');
      if (!u) return null;
      a.selected = u.id; a.mode = { type: 'idle' }; a.refresh();
      return u.id;
    });
    if (au !== null) {
      ok(`[${tag}] 自分の駒には「この駒をおまかせ」が出る`, !!(await page.$('#autoUnit')));
      await press('#autoUnit');
      await page.waitForFunction((id) => { const a = window.__app, u = a.st.units[id]; return a.autoUnits.has(id) && (u.acted || u.moved || !u.alive); }, au, { timeout: 8000 }).catch(() => {});
      const st1 = await page.evaluate((id) => { const a = window.__app, u = a.st.units[id]; return { auto: a.autoUnits.has(id), went: u.acted || u.moved || !u.alive, mark: a.view.hl.auto?.has(id) ?? false }; }, au);
      ok(`[${tag}] おまかせにした駒が自動で動き、地図に「任」の印`, st1.auto && st1.went && st1.mark, JSON.stringify(st1));
      await shot('battle_auto_unit');
      ok(`[${tag}] 「おまかせを外す（全員手動）」が出る`, !!(await page.$('#autoOff')));
      await press('#autoOff');
      ok(`[${tag}] おまかせを外すと、全員手動に戻る`, await page.evaluate(() => window.__app.autoUnits.size === 0));
    }
    // 巡を終える（全員待機）：まだ動ける駒があると、確かめる窓が出る
    ok(`[${tag}] 「巡を終える（全員待機）」のボタンだけがある（全員待機の別ボタンは無い）`, /巡を終える（全員待機）/.test(await page.textContent('#end')) && !(await page.$('#waitAll')));
    await press('#end');
    await page.waitForSelector('.confirm');
    await shot('battle_endturn_confirm');
    await press('.confirm [data-a="no"]');
    // 方位の印と、番の交代の帯（「開戦」は始めの1回だけ）
    ok(`[${tag}] 戦場に方位の印`, !!(await page.$('.compass .needle')));
    // 城の戦場：天守の取り合いの説明（攻め手を天守に置くと「押さえている」と出る）
    const hasKeep = await page.evaluate(() => !!window.__app.st.hold);
    if (hasKeep) {
      ok(`[${tag}] 城の戦場は天気の欄に天守の勝ち方`, /天守：/.test(await page.textContent('#sky')));
      await page.evaluate(() => { const a = window.__app, st = a.st, cell = st.hold.cell; for (const u of st.units) if (u.pos === cell) u.pos = st.map.spawn[1].find((i) => !st.units.some((x) => x.pos === i)); st.units.find((u) => u.side === 0 && u.alive).pos = cell; st.hold.count = 1; a.refresh(); });
      await page.waitForTimeout(200);
      ok(`[${tag}] 天守を押さえると、押さえている駒と巡の数が出る`, /が押さえている/.test(await page.textContent('#sky')));
      await shot('battle_keep');
    }
    // 飛び地の戦い：天気の欄と駒の欄に出て、攻撃・防御が下がる
    const cutInfo = await page.evaluate(async () => {
      const { attackPower } = await import('/src/rules/stats.ts');
      const a = window.__app, st = a.st, u = st.units.find((x) => x.alive && x.home === 1);
      const before = attackPower(st, u);
      st.supplyMult = [1, 0.9]; a.inspect = u.id; a.refresh();
      return { before, after: attackPower(st, u) };
    });
    await page.waitForTimeout(200);
    ok(`[${tag}] 飛び地の戦いは天気の欄に出て、攻撃が下がる`, /飛び地で戦う/.test(await page.textContent('#sky')) && cutInfo.after < cutInfo.before, `${Math.round(cutInfo.before)}→${Math.round(cutInfo.after)}`);
    await shot('battle_exclave');
    await page.evaluate(() => { const a = window.__app; a.st.supplyMult = undefined; a.inspect = null; a.refresh(); });
    // P32：自分の陣営の全員が行動済みになると、自動でターンが終わる
    await page.evaluate(async () => {
      const { apply } = await import('/src/battle/engine.ts');
      const a = window.__app, st = a.st;
      a.human = new Set([0, 1]); window.__turn0 = st.turn;
      for (const x of st.units) if (x.alive && x.side === st.turn && !x.acted) apply(st, { type: 'wait', unit: x.id });
      a.refresh(); a.checkAutoEnd();
    });
    const autoEnded = await page.waitForFunction(() => window.__app.st.turn !== window.__turn0, null, { timeout: 5000 }).then(() => true).catch(() => false);
    ok(`[${tag}] 全員の行動が終わると、自動でターンが終わる`, autoEnded);
    await page.waitForTimeout(150);
    const turnText = await page.$eval('.splash', (el) => el.textContent).catch(() => '');
    ok(`[${tag}] 番が替わると「◯◯の番」（開戦ではない）`, /の番$/.test(turnText ?? '') && !(turnText ?? '').includes('開戦'), turnText ?? '');
    await shot('battle_turn_splash');
    await page.waitForTimeout(1200);
    // 東から攻める戦場：攻め手が右、城が左
    const flipInfo = await page.evaluate(async () => {
      const { mapFromProvince } = await import('/src/battle/map.ts');
      const { createBattle } = await import('/src/battle/setup.ts');
      const a = window.__app, gs = a.gs, def = gs.factions[a.setup.defender], atk = gs.factions[a.setup.attacker];
      const p = gs.provinces[def.capital], from = [...p.nb].find((n) => gs.provinces[n].cx > p.cx);
      if (from === undefined) return null;
      const map = mapFromProvince(a.save.world, def.capital, { capital: true, from });
      const st = createBattle(gs, map, a.setup.picks, 'flip', [atk.name.ja, def.name.ja], undefined, { weather: 'clear', night: false });
      a.openBattle(st, new Set([0]), () => null, { label: '編成に戻る', fn: () => a.setupScreen() }, true);
      const g = map.grid, cx = g.center(map.seat, 1)[0], mid = g.pixelSize(1)[0] / 2;
      // 攻め手は攻めてきた側（東寄りの辺）、城は反対（西寄り）
      const atkUnits = st.units.filter((u) => u.side === 0);
      return { edge: map.edgeName, atkEast: atkUnits.reduce((s, u) => s + g.center(u.pos, 1)[0], 0) / atkUnits.length > mid, castleWest: cx < mid };
    });
    if (flipInfo) {
      await page.waitForSelector('#deployDone');
      await press('#deployDone');
      await page.waitForSelector('#end');
      await page.waitForTimeout(1900);
      ok(`[${tag}] 東寄りから攻めると攻め手が東の辺・城が西`, /東/.test(flipInfo.edge) && flipInfo.atkEast && flipInfo.castleWest, flipInfo.edge);
      await shot('battle_flipped');
    }
    // 砦の戦場：柵・砦の門・物見櫓が描かれ、砦の門の隣の攻め手に「壊す」が出る
    const fortInfo = await page.evaluate(async () => {
      const { mapFromProvince } = await import('/src/battle/map.ts');
      const { createBattle } = await import('/src/battle/setup.ts');
      const a = window.__app, gs = a.gs, atk = gs.factions[a.setup.attacker], def = gs.factions[a.setup.defender];
      const p = gs.provinces.find((x) => !x.out && x.owner === def.id && x.id !== def.capital) ?? gs.provinces[def.capital];
      const map = mapFromProvince(a.save.world, p.id, { fort: 0.4, capital: false });
      const st = createBattle(gs, map, a.setup.picks, 'fortview', [atk.name.ja, def.name.ja], undefined, { weather: 'clear', night: false });
      a.openBattle(st, new Set([0]), () => null, { label: '編成に戻る', fn: () => a.setupScreen() }, true);
      const g = map.grid, gate = map.terrain.indexOf('fortgate');
      if (gate < 0) return null;
      const spot = g.neighbors(gate).find((j) => map.terrain[j] !== 'palisade' && map.terrain[j] !== 'fort' && map.terrain[j] !== 'void' && map.depth[j] < map.depth[gate]);
      for (const u of st.units) if (u.pos === spot) u.pos = st.map.spawn[u.side].find((i) => !st.units.some((x) => x.pos === i));
      const t = st.units.find((u) => u.side === 0 && u.kind === 'troop' && u.alive);
      t.pos = spot; a.refresh();
      return { kinds: ['palisade', 'fortgate', 'lookout'].map((k) => map.terrain.includes(k)), id: t.id };
    });
    if (!fortInfo && await page.$('#deployDone')) await press('#deployDone');
    if (fortInfo) {
      // 配置を終えてから、門の隣の攻め手を選ぶ
      await page.waitForSelector('#deployDone');
      await press('#deployDone');
      await page.waitForSelector('#end');
      await page.evaluate((id) => { const a = window.__app; a.selected = id; a.mode = { type: 'idle' }; a.refresh(); }, fortInfo.id);
      await page.waitForTimeout(1900);
      ok(`[${tag}] 砦の戦場に柵・砦の門・物見櫓`, fortInfo.kinds.every(Boolean), JSON.stringify(fortInfo.kinds));
      ok(`[${tag}] 砦の門の隣の攻め手に「壊す」ボタン`, !!(await page.$('[data-breach]')));
      await press('[data-breach]');
      await page.waitForTimeout(250);
      ok(`[${tag}] 壊すを選ぶと、造りの耐久と見込みの表`, /造り/.test((await page.textContent('table.expect').catch(() => '')) ?? ''));
      await shot('battle_fort_breach');
    }
    // 編成に戻るの窓
    await press('#quit');
    await page.waitForSelector('.confirm');
    await shot('battle_quit_confirm');
    await press('.confirm [data-a="no"]');
    // 勝ちの結果（筆の帯・四隅・勝ちの絵）
    await page.evaluate(() => { const a = window.__app; a.st.winner = 0; a.finish(); });
    await page.waitForSelector('.result h2.brushed', { timeout: 10000 });
    await page.waitForTimeout(400);
    ok(`[${tag}] 勝ちの見出しは朱の帯・勝ちの絵`, !(await page.$('.result h2.lost')) && (await page.$eval('.result .banner', (el) => el.style.backgroundImage.includes('victory'))));
    await shot('battle_result_win');
    await press('.result button.primary');
    await page.waitForSelector('#start'); await idle();
    // 負けの結果：手動で守り手が勝つ
    await press('#start');
    await page.waitForSelector('#deployDone'); await idle();
    await press('#deployDone');
    await page.waitForSelector('#end'); await idle();
    await page.evaluate(() => { const a = window.__app; a.st.winner = 1; a.finish(); });
    await page.waitForSelector('.result h2.brushed', { timeout: 10000 });
    await page.waitForTimeout(400);
    ok(`[${tag}] 負けの見出しは薄墨の帯・負けの絵`, !!(await page.$('.result h2.lost')) && (await page.$eval('.result .banner', (el) => el.style.backgroundImage.includes('defeat'))));
    await shot('battle_result_lose');
    await press('.result button.primary');
    await page.waitForSelector('#start'); await idle();
  }

  // ---- 戦略
  await page.goto(URL);
  await press('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeNation'); await idle();
  await press('#modeNation');
  await page.waitForSelector('#campaign'); await idle();
  await press('#campaign');
  await page.waitForSelector('#next'); await idle(); await page.waitForTimeout(900);
  ok(`[${tag}] 見出しの帯に季節の絵`, await page.$eval('.turn', (el) => el.getAttribute('style')?.includes('season_')));
  ok(`[${tag}] 情報欄に和紙と陣営の絵`, await page.evaluate(() => getComputedStyle(document.querySelector('.battle aside')).backgroundImage.includes('setup_jp')));
  ok(`[${tag}] 武将の後ろ姿が出る`, (await page.$$('.gen .fig')).length > 0 && (await loaded('.gen .fig')));
  ok(`[${tag}] 領の欄に町の絵`, !!(await page.$('.card .town')) && (await loaded('.card .town')));
  ok(`[${tag}] 地図の外側に机の布（絵が読めている）`, await page.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('bg/desk'))));
  await shot('campaign_top');
  // 戦場の下見と普請：建てると、その領の戦場が変わる
  await page.evaluate(() => { const s = window.__campaign; s.c.gs.factions[s.c.player].supply = 5000; s.refresh(); });
  await press('details.bmap summary');
  await page.waitForTimeout(200);
  ok(`[${tag}] 領の欄に戦場の下見`, await page.$eval('details.bmap img', (el) => el.naturalWidth > 100));
  await page.$eval('details.bmap', (el) => el.scrollIntoView({ block: 'start' }));
  await shot('map_preview');
  const pvBefore = await page.$eval('details.bmap img', (el) => el.src);
  await page.selectOption('#buildKind', 'temple');
  await page.$eval('.card.build', (el) => el.scrollIntoView({ block: 'center' }));
  await shot('build_card');
  await press('#buildGo');
  await page.waitForSelector('.result.ask');
  await shot('build_confirm');
  await press('.result.ask [data-a="ok"]');
  await page.waitForTimeout(300);
  ok(`[${tag}] 普請すると戦場の下見が変わる`, (await page.$eval('details.bmap img', (el) => el.src)) !== pvBefore && /寺/.test(await page.textContent('details.bmap summary')));
  ok(`[${tag}] 同じ月にもう一度は普請できない`, await page.$eval('#buildGo', (el) => el.disabled));
  await page.$eval('details.bmap', (el) => el.scrollIntoView({ block: 'start' }));
  await shot('map_preview_after');
  // 飛び地の警告と直し方
  const exName = await page.evaluate(async () => {
    const cam = await import('/src/strategy/campaign.ts');
    const s = window.__campaign, c = s.c;
    for (const f of Object.values(c.gs.factions)) { const e = [...cam.exclavesOf(c, f.id)]; if (e.length) { s.selected = e[0]; s.refresh(); document.querySelector('.exclave')?.scrollIntoView({ block: 'center' }); return c.gs.provinces[e[0]].name.ja; } }
    return null;
  });
  if (exName) {
    await page.waitForTimeout(200);
    ok(`[${tag}] 飛び地の領に警告と直し方`, /飛び地です/.test(await page.textContent('.exclave')) && /直し方：/.test(await page.textContent('.exclave')), exName);
    await shot('exclave_warning');
  }
  // 本拠を移す：本拠でない自分の領に欄があり、押すと確かめる窓
  await page.evaluate(() => { const s = window.__campaign, c = s.c, me = c.gs.factions[c.player]; s.c.gs.factions[c.player].supply = 99999; const p = c.gs.provinces.find((x) => x.owner === me.id && x.id !== me.capital); s.selected = p.id; s.refresh(); document.querySelector('#moveCapital')?.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(200);
  ok(`[${tag}] 本拠でない自分の領に「本拠を移す」`, !!(await page.$('#moveCapital:not([disabled])')));
  await press('#moveCapital');
  await page.waitForSelector('.result.ask');
  ok(`[${tag}] 本拠を移す窓に兵糧と月数`, /兵糧を\d+使い/.test(await page.textContent('.result.ask')) && /か月/.test(await page.textContent('.result.ask')));
  await shot('capital_confirm');
  await press('.result.ask [data-a="no"]');
  await page.evaluate(() => { const s = window.__campaign; s.selected = s.c.gs.factions[s.c.player].capital; s.refresh(); });
  // 特性・性格・兵の小窓
  if (touch) { await page.$eval('.trait', (el) => el.scrollIntoView({ block: 'center' })); const r = await page.$eval('.trait', (el) => { const q = el.getClientRects()[0]; return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }); await page.touchscreen.tap(r.x, r.y); } else { await page.hover('.trait'); }
  await page.waitForTimeout(250);
  ok(`[${tag}] 特性を${touch ? '押す' : '重ねる'}と小窓`, !!(await page.$('.tip')) && /能力：/.test(await page.textContent('.tip')));
  await shot('tip_trait');
  if (touch) await page.tap('.turn');
  const pers = await page.$$('.trait');
  const p2 = await page.$$eval('.trait', (els) => els.findIndex((e) => e.textContent.startsWith('性格')));
  if (touch) await pers[p2].tap(); else await pers[p2].hover();
  await page.waitForTimeout(250);
  ok(`[${tag}] 性格の小窓`, /性格：/.test((await page.textContent('.tip').catch(() => '')) ?? ''));
  await shot('tip_personality');
  if (touch) await page.tap('.turn');
  if (!touch) {
    await page.hover('.gen [data-troop]');
    await page.waitForTimeout(250);
    ok(`[${tag}] 兵に重ねると兵種の小窓`, /得意な地形/.test((await page.textContent('.tip').catch(() => '')) ?? ''));
    await shot('tip_unit');
    await page.mouse.move(5, 5);
  }
  // 兵の欄（兵種の説明つき）
  await press('.gen [data-troop]');
  await page.waitForSelector('.tmenu .udesc');
  await page.$eval('.tmenu', (el) => el.scrollIntoView({ block: 'center' }));
  await shot('troop_menu');
  // 手放す：確かめる窓
  await press('[data-dismiss]');
  await page.waitForSelector('.result.ask');
  await shot('dismiss_confirm');
  await press('.result.ask [data-a="no"]');
  // 武将にする：名前の窓（取り立ての絵）
  await page.evaluate(() => { const s = window.__campaign, g = s.c.gs.generals[document.querySelector('.gen [data-troop]').dataset.troop]; g.troops[0].level = 12; s.c.gs.factions[s.c.player].supply = 3000; s.refresh(); });
  await press('.gen [data-troop]');
  await press('[data-raise]');
  await page.waitForSelector('.result.ask input');
  ok(`[${tag}] 武将にする窓に取り立ての絵`, await page.$eval('.result.ask .banner', (el) => el.style.backgroundImage.includes('promote')));
  await shot('raise_dialog');
  await press('.result.ask [data-a="no"]');
  // 兵にする
  await page.$eval('[data-lower]', (el) => el.scrollIntoView({ block: 'center' }));
  await press('[data-lower]');
  await page.waitForSelector('.result.ask');
  await shot('lower_dialog');
  await press('.result.ask [data-a="no"]');
  // 諸国巡り（旅の絵）
  await page.$eval('[data-quest]', (el) => el.scrollIntoView({ block: 'center' }));
  await press('[data-quest]');
  await page.waitForSelector('.confirm');
  ok(`[${tag}] 諸国巡りの窓に名前と旅の絵`, /を諸国巡りに出す/.test(await page.textContent('.confirm h2')) && (await page.textContent('.confirm h2')).length > 9 && (await page.$eval('.confirm .banner', (el) => el.style.backgroundImage.includes('travel'))));
  await shot('quest_confirm');
  await press('.confirm [data-a="no"]');
  // 外交（ほかの勢力の領を選ぶ）
  await page.evaluate(() => { const s = window.__campaign, c = s.c; const p = c.gs.provinces.find((x) => x.owner && x.owner !== c.player && document); s.selected = p.id; s.refresh(); });
  await page.waitForSelector('[data-dip]:not([disabled])');
  await page.$eval('[data-dip]:not([disabled])', (el) => el.scrollIntoView({ block: 'center' }));
  await press('[data-dip]:not([disabled])');
  await page.waitForSelector('.confirm');
  ok(`[${tag}] 外交の窓に相手の名前と使者の絵`, /に/.test(await page.textContent('.confirm h2')) && (await page.$eval('.confirm .banner', (el) => el.style.backgroundImage.includes('envoy'))));
  await shot('diplomacy_confirm');
  await press('.confirm [data-a="no"]');
  // 申し込みの欄（使者の絵）と、その窓
  await page.evaluate(() => { const s = window.__campaign, c = s.c; const o = Object.values(c.gs.factions).find((f) => f.id !== c.player); c.offers.push({ kind: 'truce', from: o.id, until: c.gs.tick + 2 }); s.selected = c.gs.factions[c.player].capital; s.refresh(); document.querySelector('#panel').scrollTop = 0; });
  ok(`[${tag}] 申し込みの欄に使者の絵`, !!(await page.$('.card .vignette')));
  await shot('offer_card');
  await press('[data-offer][data-yes]');
  await page.waitForSelector('.confirm');
  await shot('offer_confirm');
  await press('.confirm [data-a="no"]');
  // 攻められたとき：地図で朱と金、矢印
  await page.evaluate(async () => {
    const s = window.__campaign, c = s.c, cam = await import('/src/strategy/campaign.ts');
    for (const p of c.gs.provinces.filter((x) => x.owner === c.player)) for (const n of cam.neighborsOf(c, p.id)) {
      const o = c.gs.provinces[n].owner;
      if (!o || o === c.player) continue;
      const atk = cam.generalsAt(c, n, o).slice(0, 2).map((g) => g.id);
      if (!atk.length) continue;
      s.fight({ attacker: o, defender: c.player, prov: p.id, from: n, atk, def: cam.generalsAt(c, p.id, c.player).slice(0, 2).map((g) => g.id) }, 1, () => s.mount());
      return;
    }
  });
  await page.waitForSelector('.result.low');
  ok(`[${tag}] 攻められた窓に「どこからどこへ」`, /から .* へ/.test(await page.textContent('.result.low .where')) && (await page.evaluate(() => !!window.__campaign.view.hl.alarm)));
  await shot('attacked');
  const al = await page.evaluate(() => { const s = window.__campaign, a = s.view.hl.alarm, c = s.c, r = document.querySelector('.battle canvas').getBoundingClientRect(), w = document.querySelector('.result.low').getBoundingClientRect(); return [a.from, a.to].map((id) => { const p = c.gs.provinces[id], [x, y] = s.view.cam.toScreen(p.cx, p.cy); return { x: r.x + x, y: r.y + y, hidden: r.y + y > w.top && r.x + x > w.left && r.x + x < w.right }; }); });
  const wtop = await page.$eval('.result.low', (w) => w.getBoundingClientRect().top);
  ok(`[${tag}] 攻めてきた領と攻められた領が、窓より十分上に見える`, al.every((q) => !q.hidden && q.y < wtop - 40), JSON.stringify(al.map((q) => [Math.round(q.x), Math.round(q.y)])));
  await page.evaluate(() => { const s = window.__campaign; s.alarm = null; document.querySelector('.result.low')?.remove(); s.refresh(); });
  // 今月の知らせ（訃報）
  await page.evaluate(() => { const s = window.__campaign, c = s.c, me = c.gs.factions[c.player]; const mark = c.log.length; c.log.push({ key: 'death', vars: { faction: me.name.ja, name: '試しの武将', age: 70 } }, { key: 'defect', vars: { name: '裏切りの武将', from: me.name.ja, to: '他家' } }); s.showNews(mark); });
  await page.waitForSelector('.confirm');
  ok(`[${tag}] 今月の知らせに訃報の絵`, await page.$eval('.confirm .banner', (el) => el.style.backgroundImage.includes('death')));
  await shot('news');
  await press('.confirm [data-a="ok"]');
  // 史実の出来事：その月が来ると起き、今月の知らせに【史実】として出る
  const histN = await page.evaluate(async () => {
    const h = await import('/src/strategy/history.ts');
    const ev = await import('/src/strategy/events.ts');
    const s = window.__campaign, c = s.c, mark = c.log.length;
    const first = h.pendingEvents(c.world).find((e) => !c.history.done.includes(e.id));
    if (!first) return -1;
    const keep = [c.gs.year, c.gs.month];
    c.gs.year = first.y; c.gs.month = first.m;
    h.historyMonth(c, { dies: (g) => ev.generalDies(c, g), note: (key, vars) => c.log.push({ key, vars }) });
    [c.gs.year, c.gs.month] = keep;
    for (const e of c.log.slice(mark)) if (e.key === 'history') e.vars.imp = 3;
    s.showNews(mark);
    return c.log.slice(mark).filter((e) => e.key === 'history').length;
  });
  if (histN > 0) {
    await page.waitForSelector('.confirm');
    ok(`[${tag}] 史実の出来事が今月の知らせに【史実】で出る`, /【史実】/.test(await page.textContent('.confirm')), String(histN));
    await shot('news_history');
    await press('.confirm [data-a="ok"]');
  }
  // 史実の領の動き（自分の家にかかわるもの）：受けるか断るかの欄が出て、断ると消える
  await page.evaluate(() => {
    const s = window.__campaign, c = s.c;
    const p = c.gs.provinces.find((x) => x.owner && x.owner !== c.player && !x.out);
    (c.history.choices ??= []).push({ id: 'vc:0', kind: 'give', text: '試しの出来事', provs: [p.id], to: c.player, until: c.gs.tick + 3 });
    s.refresh();
  });
  await page.waitForSelector('.hchoice');
  ok(`[${tag}] 史実の領の動きの欄が出る（受ける・断る）`, (await page.$$('[data-hchoice="vc:0"]')).length === 2, await page.textContent('.hchoice'));
  await shot('history_choice');
  await press('[data-hchoice="vc:0"]:not([data-yes])');
  await page.waitForSelector('.confirm');
  ok(`[${tag}] 断るときは、起きることを書いた確かめる窓が出る`, /何も起きません/.test(await page.textContent('.confirm')));
  await press('.confirm [data-a="ok"]');
  await page.waitForTimeout(150);
  // 将の名前を押すと、能力と列伝の窓（P29）
  if (await page.$('.gname')) {
    await press('.gname');
    await page.waitForSelector('.confirm .profile');
    const pf = await page.textContent('.confirm .profile');
    ok(`[${tag}] 将の名前で、能力と列伝の窓が開く`, /列伝/.test(pf) && /采配/.test(pf), pf.slice(0, 60));
    await shot('profile');
    await press('.confirm [data-a="ok"]');
  }
  // 訓練（P30）：ずっと訓練を入れると欄に出る。もう一度押すと切れる
  const ta = await page.$('[data-train-always]');
  if (ta) {
    await press('[data-train-always]');
    await page.waitForTimeout(150);
    ok(`[${tag}] ずっと訓練を入れると、武将の欄に出る`, /ずっと訓練：入/.test(await page.textContent('#panel')));
    await shot('train');
    await press('[data-train-always]');
    await page.waitForTimeout(150);
  }
  // 偵察度（P33）：離れた敵の領はほとんど見えず、偵察度の欄と「偵察させる」が出る
  const farProv = await page.evaluate(async () => {
    const cam = await import('/src/strategy/campaign.ts');
    const s = window.__campaign, c = s.c, close = new Set();
    for (const p of c.gs.provinces) if (p.owner === c.player) { close.add(p.id); for (const n of cam.neighborsOf(c, p.id)) { close.add(n); for (const m of cam.neighborsOf(c, n)) close.add(m); } }
    const p = c.gs.provinces.find((q) => q.owner && q.owner !== c.player && !close.has(q.id) && !q.out);
    if (!p) return null;
    s.selected = p.id; s.refresh(); document.querySelector('.scout')?.scrollIntoView({ block: 'center' });
    return p.name.ja;
  });
  if (farProv) {
    await page.waitForTimeout(200);
    const pt = await page.textContent('#panel');
    ok(`[${tag}] 離れた敵の領は様子が分からず、偵察度と「偵察させる」が出る`, /様子が分からない/.test(pt) && /偵察度/.test(pt) && !!(await page.$('#scoutGo')), farProv);
    await shot('scout');
  }
  // 複数の領から攻める（P35）：2つの領で武将を選ぶと、両方に隣り合う領が攻め先になり、押すと戦場の向きを選ぶ窓が出る
  const multi = await page.evaluate(async () => {
    const cam = await import('/src/strategy/campaign.ts');
    const s = window.__campaign, c = s.c, gs = c.gs, me = c.player;
    for (const p of gs.provinces) {
      if (!p.owner || p.owner === me || p.out || !cam.canAttack(c, me, p.owner)) continue;
      const srcs = cam.neighborsOf(c, p.id).filter((n) => gs.provinces[n].owner === me);
      if (srcs.length < 2) continue;
      // まだ動いていない武将を2人、その2つの領に置く
      const free = Object.values(gs.generals).filter((g) => g.faction === me && !c.moved.has(g.id) && !g.isLord && !(g.id in c.away) && !(g.id in c.wounded)).slice(0, 2);
      if (free.length < 2) return null;
      free[0].prov = srcs[0]; free[1].prov = srcs[1];
      s.picked = new Set(free.map((g) => g.id));
      s.selected = srcs[0]; s.order = 'attack'; s.refresh();
      return { to: p.id, ok: s.targets('attack').has(p.id) };
    }
    return null;
  });
  if (multi) {
    ok(`[${tag}] 2つの領で武将を選ぶと、両方に隣り合う領が攻め先になる`, multi.ok && /ほかの領で選んだ武将/.test(await page.textContent('#panel')));
    await page.evaluate((to) => window.__campaign.onClick(to), multi.to);
    await page.waitForSelector('.confirm #atkFrom');
    ok(`[${tag}] 複数の領から攻めるときは、戦場の向きを選ぶ窓が出る`, (await page.$$('.confirm #atkFrom option')).length >= 2);
    await shot('multi_attack');
    await press('.confirm [data-a="no"]');
    await page.evaluate(() => { const s = window.__campaign; s.picked.clear(); s.order = 'none'; s.refresh(); });
  }
  ok(`[${tag}] 領の画面の国名は、国の色の札`, !!(await page.$('#panel .fac')));
  ok(`[${tag}] 断ると欄が消え、記録に残る`, !(await page.$('[data-hchoice="vc:0"]')) && await page.evaluate(() => window.__campaign.c.log.some((e) => e.key === 'historyChoice')));
  // 月送りの演出（P31）：ほかの国どうしの戦いを、矢印・顔ぶれ・小さな戦場・結果で見せる。飛ばすボタン2つ
  const reelOk = await page.evaluate(async () => {
    const cam = await import('/src/strategy/campaign.ts');
    const s = window.__campaign, c = s.c, gs = c.gs;
    for (const p of gs.provinces) {
      if (!p.owner || p.owner === c.player || p.out) continue;
      const q = p.nb.map((n) => gs.provinces[n]).find((x) => x && x.owner && x.owner !== p.owner && x.owner !== c.player && !x.out);
      if (!q) continue;
      const side = (f) => Object.values(gs.generals).filter((g) => g.faction === f).slice(0, 2).map((g) => ({ name: g.name.ja, lv: g.level, troops: g.troops.length }));
      const owners = [p.owner, q.owner];
      // 3巡ごとの駒の並び（P43）：攻め手・守り手の配置場所に駒を置き、巡ごとに少しずつ寄せる
      const map = cam.provinceMap(c, p.id, q.id);
      const frames = map ? [1, 4, 7].map((round, k) => ({ round, units: [...map.spawn[0].slice(0, 5).map((pos) => ({ pos, side: 0, general: false, hp: 1 - k * 0.2 })), ...map.spawn[1].slice(0, 5 - k).map((pos) => ({ pos, side: 1, general: false, hp: 1 }))] })) : undefined;
      window.__reelDone = false;
      s.playReel([
        { from: q.id, prov: p.id, attacker: q.owner, defender: p.owner, atk: side(q.owner), def: side(p.owner), winner: 0, captured: true, map, frames, detail: true, rounds: 7, beaten: [{ name: '試しの守将', side: 1 }], lost: [1, 3] },
        { from: p.id, prov: q.id, attacker: p.owner, defender: q.owner, atk: side(p.owner), def: side(q.owner), winner: 1, captured: false },
      ], () => { window.__reelDone = true; });
      return owners;
    }
    return null;
  });
  if (reelOk) {
    await page.waitForSelector('.result.reel');
    const rt = await page.textContent('.result.reel');
    ok(`[${tag}] 他国の戦いの演出：攻め手・守り手・飛ばすボタン`, /攻め手/.test(rt) && /守り手/.test(rt) && /この戦いを飛ばす/.test(rt) && /この月をすべて飛ばす/.test(rt), rt.slice(0, 50));
    ok(`[${tag}] 他国の戦いの演出：地図に矢印、小さな戦場`, await page.evaluate(() => !!window.__campaign.alarm) && !!(await page.$('.reel-map')));
    await page.waitForFunction(() => /巡目/.test(document.querySelector('.reel-round')?.textContent ?? ''), null, { timeout: 4000 }).catch(() => {});
    ok(`[${tag}] 他国の戦いの演出：駒の並びを巡ごとに描き直す（◯巡目）`, /巡目/.test(await page.textContent('.reel-round').catch(() => '') ?? ''));
    await shot('reel');
    await page.waitForFunction(() => /の勝ち/.test(document.querySelector('.reel-result')?.textContent ?? ''), null, { timeout: 5000 });
    ok(`[${tag}] 他国の戦いの演出：結果が出て、移った領が光る`, await page.evaluate(() => window.__campaign.flash !== null));
    ok(`[${tag}] 様子の分かる領の戦いは、結果の詳細（巡の数・失った兵・倒された武将）が出る`, /巡で決着/.test(await page.textContent('.reel-detail').catch(() => '') ?? '') && /試しの守将/.test(await page.textContent('.reel-detail').catch(() => '') ?? ''));
    await shot('reel_result');
    await press('[data-r="all"]');
    await page.waitForFunction(() => window.__reelDone === true, null, { timeout: 3000 });
    const restored = await page.evaluate((o) => { const gs = window.__campaign.c.gs; return !document.querySelector('.result.reel') && window.__campaign.alarm === null; }, reelOk);
    ok(`[${tag}] すべて飛ばすと、演出が閉じて地図が元に戻る`, restored);
  }
  // 戦をしていない国の領へ攻めるときは、開戦の確認の窓（P41）
  const neutral = await page.evaluate(async () => {
    const cam = await import('/src/strategy/campaign.ts');
    const s = window.__campaign, c = s.c, gs = c.gs, me = c.player;
    for (const p of gs.provinces) {
      if (!p.owner || p.owner === me || p.out || cam.relation(c, me, p.owner) !== 'neutral') continue;
      const from = cam.neighborsOf(c, p.id).find((n) => gs.provinces[n].owner === me);
      const g = Object.values(gs.generals).find((x) => x.faction === me && !c.moved.has(x.id) && !x.isLord && !(x.id in c.away) && !(x.id in c.wounded));
      if (from === undefined || !g) continue;
      g.prov = from; s.picked = new Set([g.id]); s.selected = from; s.order = 'attack'; s.refresh();
      s.onClick(p.id);
      return p.name.ja;
    }
    return null;
  });
  if (neutral) {
    await page.waitForSelector('.confirm');
    ok(`[${tag}] 戦をしていない国の領へ攻めると、開戦の確認の窓が出る`, /開戦して攻める/.test(await page.textContent('.confirm')) && /戦をしていません/.test(await page.textContent('.confirm')), neutral);
    await shot('war_confirm');
    await press('.confirm [data-a="no"]');
    await page.evaluate(() => { const s = window.__campaign; s.picked.clear(); s.order = 'none'; s.refresh(); });
  }
  // 勝って領を取ったときの祝いの窓（P38）：実際に攻めて、おまかせで勝ったことにする
  const vic = await page.evaluate(async () => {
    const cam = await import('/src/strategy/campaign.ts');
    const s = window.__campaign, c = s.c, gs = c.gs, me = c.player;
    for (const p of gs.provinces) {
      if (!p.owner || p.owner === me || p.out || !cam.canAttack(c, me, p.owner)) continue;
      const from = cam.neighborsOf(c, p.id).find((n) => gs.provinces[n].owner === me && cam.generalsAt(c, n, me).some((g) => !c.moved.has(g.id)));
      if (from === undefined) continue;
      const pb = cam.planAttack(c, me, from, p.id, cam.generalsAt(c, from, me).filter((g) => !c.moved.has(g.id)).slice(0, 1).map((g) => g.id));
      if (!pb) continue;
      const st = cam.battleFor(c, pb); st.winner = 0;
      const mark = c.log.length, prev = p.owner;
      const sum = cam.resolveBattle(c, pb, st);
      s.mount(); s.celebrate(pb, sum, mark, prev);
      return p.name.ja;
    }
    return null;
  });
  if (vic) {
    await page.waitForSelector('.victory-box');
    const vt = await page.textContent('.victory-box');
    ok(`[${tag}] 勝って領を取ると、祝いの窓（勝利！・攻め取った・戦果・手に入れた領）`, /勝利！/.test(vt) && /攻め取った/.test(vt) && /手に入れた領/.test(vt), vic);
    await page.waitForTimeout(900);
    await shot('victory');
    await press('.victory-box [data-a="ok"]');
  }
  // 1か月オート・ずっとオート
  await press('#autoMonth');
  await page.waitForTimeout(700); await idle();
  await shot('after_auto_month');
  if (!touch) {
    await page.dblclick('#autoMonth');
    await page.waitForTimeout(1500);
    ok(`[${tag}] ずっとオート中の表示`, await page.$eval('#autoMonth', (el) => el.classList.contains('autoing')));
    await shot('autoing');
    await page.mouse.click(300, 300);
    await page.waitForTimeout(1200);
    ok(`[${tag}] 押すと手動に戻る`, !(await page.evaluate(() => window.__campaign.autoOn)));
  }
  // 記録の欄・やめるの窓
  await press('#exit');
  await page.waitForSelector('.confirm');
  await shot('exit_confirm');
  await press('.confirm [data-a="no"]');
  // 天下を取った・滅びた
  await page.evaluate(() => { const s = window.__campaign; s.c.over = 'win'; s.refresh(); document.querySelector('#panel').scrollTop = 0; });
  ok(`[${tag}] 天下を取った欄に勝ちの絵`, await page.$eval('.over .banner', (el) => el.style.backgroundImage.includes('victory')));
  await shot('over_win');
  await page.evaluate(() => { const s = window.__campaign; s.c.over = 'lose'; s.refresh(); });
  await shot('over_lose');
  // 遊び方の案内
  await press('.help-btn');
  await page.waitForSelector('.help');
  await shot('help');
  ok(`[${tag}] ページのエラーと、読めない絵・曲が無い`, errors.length === 0, errors.slice(0, 3).join(' / '));
  await context.close();
}

await run('pc', { viewport: { width: 1366, height: 800 } });
const { defaultBrowserType, ...phone } = devices['iPhone 13'];
await run('sp', phone);
console.log(ng ? `NG ${ng}件` : 'すべて OK');
await browser.close();
process.exit(ng ? 1 : 0);
