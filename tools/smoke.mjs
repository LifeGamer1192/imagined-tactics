// ブラウザでの動作確認。実際の画面を操作して、項目ごとに OK / NG を出す。
// Playwright は兄弟フォルダの hist-sim に入っているものを使う。
// 使い方：開発サーバー（npm run dev）を動かしてから  node tools/smoke.mjs [画面の保存先=shots]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const url = process.env.HEX_URL ?? 'http://localhost:5183/';

const results = [];
const errors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? `  … ${detail}` : ''}`);
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 820 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

/** 戦場のマス → 画面上の位置 */
const cellXY = (cell) => page.evaluate((c) => {
  const a = window.__app, v = a.view, g = a.st.map.grid;
  const [wx, wy] = g.center(c, 34);
  const [sx, sy] = v.cam.toScreen(wx, wy);
  const r = v.canvas.getBoundingClientRect();
  return [r.left + sx, r.top + sy];
}, cell);
const clickCell = async (cell) => { const [x, y] = await cellXY(cell); await page.mouse.click(x, y); await page.waitForTimeout(60); };
const battle = (fn, arg) => page.evaluate(fn, arg);

// ============================================================ 1. 読み込み
await page.goto(url);
await page.waitForSelector('[data-sample]');
check('タイトル画面が出る', await page.isVisible('h1'));
await shot(page, '01_title');

// 関係ないファイルを選ぶと、エラーの文が出て落ちない
writeFileSync(`${out}/bad.histsim`, 'これはセーブではありません');
await page.setInputFiles('input[type=file]', `${out}/bad.histsim`);
await page.waitForFunction(() => document.querySelector('.error')?.textContent?.length > 0);
check('関係ないファイルはエラー表示になる', (await page.textContent('.error')).includes('展開できません'), await page.textContent('.error'));

// サンプル3つとも開ける
for (const [id, word] of [['rome_fid3_212bc', 'ローマ'], ['invented_archipelago_y30', '31年'], ['sengoku_fid5_1575', '戦国']]) {
  await page.goto(url);
  await page.click(`[data-sample="${id}"]`);
  await page.waitForSelector('#modeLocal');
  check(`読み込むとモードを選ぶ画面が出る：${id}`, await page.isVisible('#modeNation') && await page.isVisible('#modeLocal'));
  await page.click('#modeLocal');
  await page.waitForSelector('#start');
  const head = await page.textContent('.setup header');
  check(`サンプルを読み込める：${id}`, head.includes(word), head.replace(/\s+/g, ' ').slice(0, 50));
}
await shot(page, '02_setup');
check('編成画面に性格が出る', (await page.textContent('.gens')).includes('性格：'));

// 実ファイルとして読み込む（サンプルのボタンではなく、ファイル選択から）
await page.goto(url);
await page.setInputFiles('input[type=file]', 'tests/fixtures/sengoku_fid5_1575.histsim');
await page.waitForSelector('#modeLocal');
await page.click('#modeLocal');
await page.waitForSelector('#start');
check('ファイル選択から .histsim を読み込める', (await page.textContent('.setup header')).includes('1575'));

// ============================================================ 2. 名前の版
await page.selectOption('#variant', 'cn');
await page.waitForSelector('#start');
const cnText = await page.textContent('.setup');
check('中国版に切り替えると兵種名が変わる', cnText.includes('徒卒') && !cnText.includes('雑兵'));
await shot(page, '03_setup_cn');
await page.selectOption('#variant', 'jp');
await page.waitForSelector('#start');
check('日本版に戻せる', (await page.textContent('.setup')).includes('雑兵'));

// 武将の選択：4人目は選べない
const boxes = page.locator('[data-side="0"][data-gen]');
const nBoxes = await boxes.count();
if (nBoxes >= 4) {
  for (let i = 0; i < nBoxes; i++) if (!(await boxes.nth(i).isChecked())) { await boxes.nth(i).click(); break; }
  check('武将は3人までしか選べない', await page.locator('[data-side="0"][data-gen]:checked').count() === 3);
}

// ============================================================ 3. 戦闘を自分で操作
await page.selectOption('#control', 'attack');
await page.click('#start');
await page.waitForSelector('canvas');
// 自分で動かす戦いは、まず配置の段階から始まる（巡を終えるボタンは無く、配置完了のボタンがある）
await page.waitForSelector('#deployDone');
await page.waitForTimeout(300);
check('自分で戦うと配置の段階から始まる', (await page.textContent('#panel')).includes('配置') && !(await page.$('#end')));
await shot(page, '04a_battle_deploy');
{
  const dpu = await battle(() => { const st = window.__app.st; const u = st.units.find((x) => x.side === 0 && x.kind === 'troop'); return { id: u.id, pos: u.pos }; });
  await clickCell(dpu.pos);
  const to = await battle(() => { const a = window.__app; return [...(a.view.hl.move ?? [])].find((c) => !a.st.units.some((u) => u.pos === c)) ?? [...(a.view.hl.move ?? [])][0] ?? -1; });
  if (to >= 0) await clickCell(to);
  check('配置の段階で、自分の駒を押して青いマスを押すと動く', to >= 0 && await battle(([id, d]) => window.__app.st.units[id].pos === d, [dpu.id, to]), `マス${dpu.pos}→${to}`);
}
await page.click('#deployDone');
await page.waitForSelector('#end');
await page.waitForTimeout(300);
await shot(page, '04_battle_start');
const s0 = await battle(() => {
  const st = window.__app.st;
  return { units: st.units.length, turn: st.turn, w: st.map.grid.w, h: st.map.grid.h, overlap: new Set(st.units.map((u) => u.pos)).size !== st.units.length };
});
check('戦闘が始まる（攻め手の番、ユニットの重なりなし）', s0.turn === 0 && !s0.overlap && s0.units >= 6, JSON.stringify(s0));

// 自軍の兵をクリックして選ぶ
const mine = await battle(() => { const st = window.__app.st; const u = st.units.find((x) => x.side === 0 && x.kind === 'troop'); return { id: u.id, pos: u.pos, name: u.name }; });
await clickCell(mine.pos);
check('自軍のユニットをクリックで選べる', await battle((id) => window.__app.selected === id, mine.id));
check('情報欄にユニットと行動が出る', (await page.textContent('#panel')).includes('待機'));
await shot(page, '05_battle_selected');

// 相手のユニットをクリックしても選択はされない（情報だけ出る）
const foe = await battle(() => { const u = window.__app.st.units.find((x) => x.side === 1); return { id: u.id, pos: u.pos, name: u.name }; });
await clickCell(foe.pos);
check('相手のユニットは情報だけ見られる', await battle((id) => window.__app.selected !== id && window.__app.inspect === id, foe.id));

// 移動：青いマスの1つへ動かす → 取り消す → もう一度動かす
await clickCell(mine.pos);
const dest = await battle((id) => {
  const a = window.__app; const cells = [...(a.view.hl.move ?? [])];
  const u = a.st.units[id]; const g = a.st.map.grid;
  return cells.sort((x, y) => g.col(y) - g.col(x))[0] ?? -1;
}, mine.id);
check('移動できるマスが表示される', dest >= 0);
await clickCell(dest);
check('クリックで移動できる', await battle(([id, d]) => window.__app.st.units[id].pos === d, [mine.id, dest]));
check('「移動を取り消す」が出る', await page.isVisible('#undo'));
await page.click('#undo');
check('移動を取り消せる', await battle(([id, p]) => window.__app.st.units[id].pos === p && !window.__app.st.units[id].moved, [mine.id, mine.pos]));
await clickCell(dest);
await page.click('#wait');
check('待機すると行動済みになる', await battle((id) => window.__app.st.units[id].acted, mine.id));

// 相手の番のユニットは動かせない／右クリックで選択を外せる
await clickCell(await battle(() => window.__app.st.units.find((x) => x.side === 0 && x.kind === 'general').pos));
await page.mouse.click(...(await cellXY(0)), { button: 'right' });
check('右クリックで選択を外せる', await battle(() => window.__app.selected === null));

// 巡を終える（全員待機） → 相手（おまかせ）が動く → 自分の番に戻る（まだ動ける駒があれば確かめる窓が出る）
await page.click('#end').then(async () => { await page.waitForTimeout(150); if (await page.$('.confirm [data-a="ok"]')) await page.click('.confirm [data-a="ok"]'); });
await page.waitForFunction(() => window.__app.st.turn === 0 && window.__app.st.round === 2, null, { timeout: 60000 });
check('巡を終える（全員待機）で相手が動き、自分の番に戻る', true, `2巡目・ログ${await battle(() => window.__app.st.log.length)}件`);
check('相手の行動がログに出る', (await page.textContent('#log')).includes('の番'));

// 攻撃：射程に入るまで近づき、技を選んで対象をクリックする（予測の表示も確かめる）
let attacked = false;
for (let round = 0; round < 12 && !attacked; round++) {
  const plan = await battle(() => {
    const a = window.__app, st = a.st, g = st.map.grid;
    if (st.winner !== null || st.turn !== 0) return null;
    const foes = st.units.filter((u) => u.alive && u.side === 1);
    for (const u of st.units.filter((x) => x.alive && x.side === 0 && !x.acted && !x.moved)) {
      for (const f of foes) if (g.distance(u.pos, f.pos) === 1) return { unit: u.id, pos: u.pos, skill: u.skills[0], target: f.pos, adjacent: true };
    }
    return { adjacent: false };
  });
  if (!plan) break;
  if (plan.adjacent) {
    await clickCell(plan.pos);
    await page.click(`[data-skill="${plan.skill}"]`);
    const [x, y] = await cellXY(plan.target);
    await page.mouse.move(x, y);
    await page.waitForTimeout(80);
    const fc = await page.textContent('#forecast');
    check('攻撃前に予測（ダメージ・命中率）が出る', /命中\d+%/.test(fc), fc.slice(0, 40));
    await shot(page, '06_battle_forecast');
    const before = await battle(() => window.__app.st.log.length);
    await page.mouse.click(x, y);
    await page.waitForTimeout(100);
    check('技を選んで対象をクリックすると攻撃できる', await battle((b) => window.__app.st.log.length > b, before));
    attacked = true;
    break;
  }
  // まだ届かない：この巡はおまかせの手で全員を動かして近づく
  await battle(() => {
    const a = window.__app;
    a.human = new Set();
  });
  await page.evaluate(() => window.__app.maybeAi());
  await page.waitForFunction((r) => window.__app.st.winner !== null || window.__app.st.round > r, await battle(() => window.__app.st.round), { timeout: 90000 });
  await page.waitForFunction(() => window.__app.st.winner !== null || window.__app.st.turn === 0, null, { timeout: 90000 });
  await battle(() => { window.__app.human = new Set([0]); clearTimeout(window.__app.aiTimer); window.__app.refresh(); });
}
check('接近して攻撃するところまで操作できた', attacked);

// 軍略：使える武将がいれば、軍略のボタンが出て対象のマスが光る
const tac = await battle(() => {
  const a = window.__app, st = a.st;
  for (const u of st.units) if (u.alive && u.side === st.turn && u.tactics.length && !u.acted && !u.moved) return { pos: u.pos, id: u.id };
  return null;
});
if (tac && await battle(() => window.__app.st.winner === null && window.__app.st.turn === 0)) {
  await clickCell(tac.pos);
  const n = await page.locator('[data-tactic]').count();
  check('軍略を持つユニットには軍略のボタンが出る', n > 0, `${n}個`);
  const enabled = page.locator('[data-tactic]:not([disabled])');
  if (await enabled.count()) {
    await enabled.first().click();
    check('軍略を選ぶと対象のマスが表示される', await battle(() => (window.__app.view.hl.target?.size ?? 0) > 0 || window.__app.mode.type === 'idle'));
    await page.keyboard.press('Escape');
    check('Esc で取り消せる', await battle(() => window.__app.mode.type === 'idle'));
  }
}

// 「編成に戻る」で途中でやめられる
await page.click('#quit'); await page.click('.confirm [data-a="ok"]');
await page.waitForSelector('#start');
check('戦闘を途中でやめて編成に戻れる', true);

// ============================================================ 4. 観戦で決着まで
await page.selectOption('#control', 'watch');
await page.click('#start');
await page.waitForSelector('canvas');
await page.waitForTimeout(2500);
await shot(page, '07_battle_watch');
check('観戦中、ユニットの情報に性格と構えが出る', await (async () => {
  const pos = await battle(() => window.__app.st.units.find((u) => u.alive && u.kind === 'general').pos);
  await clickCell(pos);
  const t = await page.textContent('#panel');
  return t.includes('性格：') && t.includes('構え：');
})());
await page.waitForSelector('.result', { timeout: 240000 });
const resText = (await page.textContent('.result')).replace(/\s+/g, ' ');
check('観戦で決着がつき、結果が出る', resText.includes('の勝ち'), resText.slice(0, 90));
await shot(page, '08_result');
const lv = await battle(() => {
  const txt = document.querySelector('.result').textContent;
  const ups = [...txt.matchAll(/Lv(\d+) → Lv(\d+)/g)].map((m) => Number(m[2]) - Number(m[1]));
  return ups.length ? Math.max(...ups) : 0;
});
// 大物を倒した低レベルの兵が一気に何レベルも上がるのは、決まりどおり（上限は設けない）。ここでは値が壊れていないことだけを見る
  check('1戦でのレベル上昇の値が壊れていない', Number.isFinite(lv) && lv >= 0 && lv < 30, `最大 +${lv}`);
await page.click('.result button');
await page.waitForSelector('#start');

// ============================================================ 5. 戦略パート
// 局地戦の編成 →「モードを選ぶ」→ 国モード → 国を選ぶ画面（初めは一番大きな国が選ばれている）
await page.click('#toModes');
await page.waitForSelector('#modeNation');
await page.click('#modeNation');
await page.waitForSelector('#campaign');
check('国を選ぶ画面に国の一覧が出る', await page.locator('input[name="nation"]').count() >= 2 && await page.locator('input[name="nation"]:checked').count() === 1);
await page.click('#campaign');
await page.waitForSelector('#next');
await shot(page, '09_campaign');
const c0 = await page.evaluate(() => { const c = window.__campaign.c; return { player: c.player, provs: c.gs.provinces.filter((p) => p.owner === c.player).length, supply: c.gs.factions[c.player].supply }; });
check('戦略パートが始まる', c0.player > 0 && c0.provs > 0, JSON.stringify(c0));

// 徴兵：兵が増えて兵糧が減る
const rec = page.locator('[data-recruit]').first();
if (await rec.count()) {
  const gid = await rec.getAttribute('data-recruit');
  const n0 = await page.evaluate((g) => window.__campaign.c.gs.generals[g].troops.length, gid);
  await rec.click();
  const r1 = await page.evaluate((g) => { const c = window.__campaign.c; return { n: c.gs.generals[g].troops.length, supply: c.gs.factions[c.player].supply }; }, gid);
  check('徴兵できる（兵が増え、兵糧が減る）', r1.n === n0 + 1 && r1.supply < c0.supply, `兵${n0}→${r1.n} 兵糧${c0.supply}→${r1.supply}`);
}

// 領をクリックして情報を見る
const other = await page.evaluate(() => {
  const s = window.__campaign, c = s.c;
  const p = c.gs.provinces.find((x) => x.owner && x.owner !== c.player);
  const [sx, sy] = s.view.cam.toScreen(p.cx, p.cy);
  const r = s.view.canvas.getBoundingClientRect();
  return { id: p.id, x: r.left + sx, y: r.top + sy, name: p.name.ja };
});
await page.mouse.click(other.x, other.y);
await page.waitForTimeout(80);
check('領をクリックすると情報が出る', (await page.textContent('#panel')).includes(other.name));

// 侵攻：守る武将のいる隣の領へ。自分で戦う → おまかせで決着 → 戦略マップへ
const atk = await page.evaluate(() => {
  const s = window.__campaign, c = s.c, all = Object.values(c.gs.generals);
  const isDefended = (t) => all.some((g) => g.prov === t && g.faction === c.gs.provinces[t].owner);
  const own = c.gs.provinces.filter((p) => p.owner === c.player);
  const from = own.find((p) => [...p.nb, ...p.sea].some((n) => c.gs.provinces[n].owner !== c.player && c.gs.provinces[n].owner && isDefended(n)));
  if (!from) return 'no defended neighbour';
  const gens = all.filter((g) => g.faction === c.player).sort((a, b) => b.level - a.level).slice(0, 3);
  gens.forEach((g) => { g.prov = from.id; });
  s.selected = from.id; s.picked.clear(); gens.forEach((g) => s.picked.add(g.id));
  s.order = 'attack';
  const t = [...s.targets('attack')].find(isDefended);
  if (t === undefined) return 'cannot attack';
  s.onClick(t);
  return 'ok';
});
if (atk === 'ok') {
  // 戦をしていない国の領なら、開戦の確認の窓（P41）が出るので「開戦して攻める」を押す
await page.waitForSelector('.confirm, .result [data-a="auto"]', { timeout: 30000 });
if (await page.$('.confirm [data-a="ok"]')) { const tx = await page.textContent('.confirm'); if (/開戦/.test(tx)) await page.click('.confirm [data-a="ok"]'); }
await page.waitForSelector('.result [data-a="play"]');
  await shot(page, '10_campaign_attack');
  await page.click('.result [data-a="play"]');
  await page.waitForSelector('#deployDone');
  await page.click('#deployDone');
  await page.waitForSelector('#auto');
  check('戦略から戦闘に入れる（途中でやめるボタンは無く、おまかせで決着がある）', !(await page.isVisible('#quit')));
  // 退く：ボタンがあり、押すと罰の説明の窓が出る（ここでは退かずに続ける）
  check('戦略の戦いに「退く」ボタンがある', await page.isVisible('#retreat'));
  await page.click('#retreat');
  await page.waitForSelector('.confirm');
  // 始めは全部隊が初期配置のマスにいるので、軽い退却（翌月の休養）の説明になる。マスの外の部隊があると、重い罰（兵糧を失う など）も出る
  check('退くを押すと、負けになることと罰（休養・兵糧など）の説明の窓が出る', /負け/.test(await page.textContent('.confirm')) && /(休養|兵糧の\d+%を失う)/.test(await page.textContent('.confirm')));
  await page.screenshot({ path: path.join(out, '10b_retreat_confirm.png') }).catch(() => {});
  await page.click('.confirm [data-a="no"]');
  await page.click('#auto'); await page.click('.confirm [data-a="ok"]');
  await page.waitForSelector('.result button');
  check('戦闘の結果が戦略に戻る', (await page.textContent('.result')).includes('の勝ち'));
  await page.click('.result button');
  await page.waitForSelector('#next');
} else check('侵攻の確認（隣に守りのいる領が無いので省略）', true, atk);

// 月を進める（攻められたら、おまかせで片づける）
const date0 = await page.textContent('.turn');
await page.click('#next');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  if (await page.$('.result.fall [data-a="skip"]')) await page.click('.result.fall [data-a="skip"]'); else if (await page.$('.result.fall [data-a="ok"]')) await page.click('.result.fall [data-a="ok"]'); else if (await page.$('.result.report [data-a="ok"]')) await page.click('.result.report [data-a="ok"]'); else if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]'); else if (await page.$('#next')) break;
}
await page.waitForSelector('#next');
const date1 = await page.textContent('.turn');
check('月を進められる', date0 !== date1, `${date0.trim().slice(0, 12)} → ${date1.trim().slice(0, 12)}`);

// ============================================================ 6. セーブと読み込み
const snap = () => page.evaluate(() => { const c = window.__campaign.c; return JSON.stringify([c.gs.tick, c.months, c.gs.provinces.map((p) => p.owner), c.gs.factions[c.player]?.supply, Object.values(c.gs.generals).map((g) => [g.id, g.level, g.troops.length, g.prov])]); });
await page.waitForTimeout(400);
await page.click('#saves');
await page.waitForSelector('.savemenu');
await shot(page, '11_save_menu');
check('セーブのメニューに自動の枠が入っている', (await page.textContent('.savemenu')).includes('か月経過'));
await page.click('[data-save="1"]');
await page.waitForSelector('[data-load="1"]');
check('枠1に保存できる', true);
const saved = await snap();
// ファイルに書き出す
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
const file = `${out}/test.hexsim`;
await download.saveAs(file);
check('ファイルに書き出せる', download.suggestedFilename().endsWith('.hexsim'), download.suggestedFilename());
await page.click('#closeMenu');

// さらに1か月進めてから、枠1を読み込むと、保存したときの状態に戻る
await page.click('#next');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  if (await page.$('.result.fall [data-a="skip"]')) await page.click('.result.fall [data-a="skip"]'); else if (await page.$('.result.fall [data-a="ok"]')) await page.click('.result.fall [data-a="ok"]'); else if (await page.$('.result.report [data-a="ok"]')) await page.click('.result.report [data-a="ok"]'); else if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]'); else if (await page.$('#next')) break;
}
await page.waitForSelector('#next');
check('進めると状態が変わる', (await snap()) !== saved);
await page.click('#saves');
await page.waitForSelector('[data-load="1"]');
await page.click('[data-load="1"]');
// 読み込みは「読み込んでいます…」の表示を出してから行うので、表示が消えるまで待つ
await page.waitForFunction(() => !document.querySelector('.savemenu') && !document.querySelector('.busy'));
await page.waitForSelector('#next');
check('枠1を読み込むと、保存したときの状態に戻る', (await snap()) === saved);

// ページを開き直しても「つづきから」で続けられる
await page.goto(url);
await page.waitForSelector('#continue:not([hidden])');
check('開き直すと「つづきから」が出る', true);
await page.click('#continue');
await page.waitForSelector('[data-load="1"]');
await page.click('[data-load="1"]');
await page.waitForSelector('#next');
await page.waitForFunction(() => !!window.__campaign);
check('開き直したあと、枠1から続けられる', (await snap()) === saved);
await shot(page, '12_campaign_loaded');

// 書き出したファイルから読み込む
await page.goto(url);
await page.waitForSelector('[data-sample]');
await page.setInputFiles('input[type=file]', file);
await page.waitForSelector('#next');
check('書き出したファイルから続けられる', (await snap()) === saved);

// 読み込んだあとも遊び続けられる（月を進められる）
await page.click('#next');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  if (await page.$('.result.fall [data-a="skip"]')) await page.click('.result.fall [data-a="skip"]'); else if (await page.$('.result.fall [data-a="ok"]')) await page.click('.result.fall [data-a="ok"]'); else if (await page.$('.result.report [data-a="ok"]')) await page.click('.result.report [data-a="ok"]'); else if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]'); else if (await page.$('#next')) break;
}
await page.waitForSelector('#next');
check('読み込んだあとも月を進められる', (await snap()) !== saved);

// 枠を削除できる
await page.click('#saves');
await page.waitForSelector('[data-del="1"]');
await page.click('[data-del="1"]');
await page.waitForFunction(() => !document.querySelector('[data-load="1"]'));
check('枠を削除できる', true);
await page.click('#closeMenu');

// ============================================================ 7. 観戦の戦略、狭い画面
await page.click('#exit'); await page.click('.confirm [data-a="ok"]');
await page.waitForSelector('#modeNation');
check('戦略をやめるとモードを選ぶ画面に戻る', await page.isVisible('#modeLocal'));
await page.click('#modeNation');
await page.waitForSelector('#campaignWatch');
await page.click('#campaignWatch');
await page.waitForSelector('#run');
const f0 = await page.evaluate(() => Object.keys(window.__campaign.c.gs.factions).length);
await page.click('#run');
await page.waitForFunction(() => window.__campaign.c.months >= 12, null, { timeout: 240000 });
const f1 = await page.evaluate(() => Object.keys(window.__campaign.c.gs.factions).length);
check('観戦で12か月進められる', true, `勢力 ${f0} → ${f1}`);
await shot(page, '13_campaign_watch_12m');
await page.click('#exit'); await page.click('.confirm [data-a="ok"]');
await page.waitForSelector('#modeLocal');
await page.click('#modeLocal');
await page.waitForSelector('#start');

await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(200);
await shot(page, '14_narrow_setup');
await page.selectOption('#control', 'watch');
await page.click('#start');
await page.waitForSelector('canvas');
await page.waitForTimeout(1500);
const narrow = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), scroll: document.documentElement.scrollWidth }; });
check('狭い画面（スマホ幅）でも戦場が表示される', narrow.w > 300 && narrow.h > 200 && narrow.scroll <= 400, JSON.stringify(narrow));
await shot(page, '15_narrow_battle');

// ============================================================ まとめ
check('ページのエラーが出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
const ng = results.filter((r) => !r.ok);
console.log(`\n${results.length}項目中 ${results.length - ng.length}項目 OK${ng.length ? `、NG：${ng.map((r) => r.name).join('、')}` : ''}`);
await browser.close();
process.exit(ng.length ? 1 : 0);
