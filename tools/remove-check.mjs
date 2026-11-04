// 再移動（騎馬の系統の特技 remove）を手で操作して確かめる：
// 攻撃したあとも番が勝手に終わらず、残りの移動力のマスが光り、押すと動ける。
// 使い方：node tools/remove-check.mjs [撮る先]（vite を 5183 で立ち上げておく）
import playwright from './pw.mjs';
const out = process.argv[2];
let fails = 0;
const ok = (name, cond, note = '') => { console.log(`${cond ? 'OK ' : 'NG '} ${name}${note ? `  … ${note}` : ''}`); if (!cond) fails++; };
const b = await playwright.chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1360, height: 820 } })).newPage();
page.on('dialog', (d) => d.accept());
const ev = (fn, arg) => page.evaluate(fn, arg);
const cellXY = (cell) => ev((c) => { const a = window.__app, v = a.view, g = a.st.map.grid; const [wx, wy] = g.center(c, 34); const [sx, sy] = v.cam.toScreen(wx, wy); const r = v.canvas.getBoundingClientRect(); return [r.left + sx, r.top + sy]; }, cell);
const clickCell = async (cell) => { const [x, y] = await cellXY(cell); await page.mouse.click(x, y); await page.waitForTimeout(80); };

await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
await page.click('[data-sample="sengoku_fid5_1575"]');
await page.waitForSelector('#modeLocal'); await page.click('#modeLocal');
await page.waitForSelector('#start');
await page.selectOption('#control', 'attack');
await page.click('#start');
await page.waitForSelector('#deployDone'); await page.click('#deployDone');
await page.waitForSelector('#end'); await page.waitForTimeout(400);

// 自分の駒を1つだけ残して「行動済み」にし、その駒を騎馬（再移動あり）にして、隣に硬い敵を置く。
// 隣が空いていて、まわりに空きの多いマスを選ぶ
const setup = await ev(() => {
  const a = window.__app, st = a.st, g = st.map.grid;
  const mine = st.units.filter((u) => u.alive && u.side === st.turn);
  const u = mine.find((x) => x.kind === 'troop') ?? mine[0];
  for (const x of mine) if (x !== u) { x.acted = true; x.moved = true; x.postMoved = true; }
  if (!u.passives.some((p) => p.type === 'remove')) u.passives.push({ type: 'remove' });
  const free = (c) => !st.units.some((x) => x.alive && x.pos === c) && g.inBounds?.(c) !== false;
  const foe = st.units.find((x) => x.alive && x.side !== st.turn);
  const spot = g.neighbors(u.pos).find((c) => free(c) && st.map.terrain?.[c] !== 'water');
  foe.pos = spot ?? g.neighbors(u.pos)[0];
  foe.hp = foe.maxHp = 99999;
  u.moveSpent = 0; u.moved = false; u.acted = false;
  a.selected = u.id; a.mode = { type: 'idle' }; a.refresh();
  return { id: u.id, foe: foe.id, foePos: foe.pos, skill: u.skills[0] };
});
// 技を選んで、敵を押す（マウスなので1回で使える）
await page.click(`[data-skill="${setup.skill}"]`);
await clickCell(setup.foePos);
await page.waitForTimeout(1500);
const after = await ev((id) => { const a = window.__app, st = a.st, u = st.units[id]; return { acted: u.acted, turn: st.turn, sel: a.selected, move: [...(a.view.hl.move ?? [])], panel: document.querySelector('#panel')?.textContent ?? '' }; }, setup.id);
ok('攻撃したあと、番が勝手に終わらない', after.acted && after.turn === 0, `turn=${after.turn}`);
ok('攻撃したあとも駒が選ばれたまま、動けるマスが光る', after.sel === setup.id && after.move.length > 0, `${after.move.length}マス`);
ok('残りの移動力の案内が出る', /残りの移動力（\d+）で動けます/.test(after.panel));
if (out) await page.screenshot({ path: `${out}/remove_after_attack.png` });
const to = after.move[after.move.length - 1];
const round0 = await ev(() => window.__app.st.round);
if (to !== undefined) await clickCell(to);
await page.waitForTimeout(600);
const moved = await ev(([id, to]) => window.__app.st.units[id].pos === to, [setup.id, to]);
ok('光ったマスを押すと動ける', moved, `→${to}`);
await page.waitForTimeout(2500);
ok('動いたあとは全員終わったので、番を終える', await ev((r) => window.__app.st.turn !== 0 || window.__app.st.round !== r, round0));
await b.close();
console.log(fails ? `NG ${fails}件` : 'すべて OK');
process.exit(fails ? 1 : 0);
