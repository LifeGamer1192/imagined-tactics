// 攻撃のエフェクトと、記録の3段階（簡易・通常・詳細）を撮る。開発サーバー（5183）を動かしてから実行する。
// 使い方：node tools/fx-shot.mjs [出力先のフォルダ]
// エフェクトは、時計を止めて、決めた時刻のコマを描かせて撮る（何度撮っても同じコマになる）。1つの技が横1列、時刻が左から右。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const url = process.env.HEX_URL ?? 'http://localhost:5183/';
const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

await page.goto(url);
await page.click('[data-sample="sengoku_fid5_1575"]');
await page.waitForSelector('#start');
await page.click('#start');
await page.waitForSelector('#watch');

// ---- 記録の3段階：観戦でしばらく進めてから、同じ記録を3通りに出して撮る
await page.click('[data-speed="4"]');
await page.click('#watch');
await page.waitForTimeout(2500);
await page.click('#watch');
await page.waitForTimeout(300);
for (const [i, name] of [[0, 'simple'], [1, 'normal'], [2, 'detail']]) {
  await page.click(`[data-log="${i}"]`);
  await page.waitForTimeout(150);
  await (await page.$('.battle aside')).screenshot({ path: path.join(out, `log_${name}.png`) });
  writeFileSync(path.join(out, `log_${name}.txt`), await page.evaluate(() => {
    const el = document.querySelector('#log');
    return [...el.children].slice(-14).map((d) => d.innerText).join('\n');
  }));
}
console.log('記録の細かさを覚えている：', await page.evaluate(() => localStorage.getItem('hexsim.logLevel')));

// ---- エフェクト：[名前, 技か軍略の番号, 相手までの距離, 撮る時刻（ミリ秒）, そのほか]
const scenes = [
  ['斬撃 k044', { skill: 'k044', dist: 1 }, [130, 200, 300, 520, 1000]],
  ['斬撃・会心 k044', { skill: 'k044', dist: 1, crit: true }, [130, 200, 300, 520, 1000]],
  ['突き k001', { skill: 'k001', dist: 1 }, [130, 200, 300, 520, 1000]],
  ['打撃 k039', { skill: 'k039', dist: 1 }, [130, 200, 300, 520, 1000]],
  ['外れ k001', { skill: 'k001', dist: 1, miss: true }, [130, 200, 300, 520, 1000]],
  ['弓 k025', { skill: 'k025', dist: 3 }, [60, 150, 240, 330, 600]],
  ['手裏剣 k022', { skill: 'k022', dist: 3 }, [50, 110, 170, 260, 600]],
  ['鉄砲 k016（直線3）', { skill: 'k016', dist: 1, second: true }, [20, 60, 110, 260, 600]],
  ['大筒 k042', { skill: 'k042', dist: 3 }, [40, 180, 330, 470, 800]],
  ['岩 k055（周囲2）', { skill: 'k055', dist: 2 }, [80, 200, 330, 470, 800]],
  ['火 k071（直線3）', { skill: 'k071', dist: 1, second: true }, [60, 160, 290, 450, 800]],
  ['声 k007（周囲2）', { skill: 'k007', dist: 2 }, [60, 160, 260, 420, 800]],
  ['軍略・火 x09（範囲）', { tactic: 'x09', dist: 2, second: true }, [80, 230, 330, 520, 900]],
  ['軍略・火矢 x02', { tactic: 'x02', dist: 3 }, [80, 300, 420, 600, 900]],
  ['軍略・水 x03', { tactic: 'x03', dist: 2 }, [80, 230, 330, 520, 900]],
  ['軍略・落石 x07', { tactic: 'x07', dist: 2 }, [80, 300, 420, 560, 900]],
  ['軍略・回復 x16', { tactic: 'x16', dist: 2, ally: true }, [80, 230, 330, 520, 900]],
  ['軍略・補助 x25', { tactic: 'x25', dist: 2, ally: true }, [80, 230, 330, 520, 900]],
  ['軍略・妨害 x34', { tactic: 'x34', dist: 2 }, [80, 230, 330, 520, 900]],
  ['続けて当たる k001 + 反撃', { skill: 'k001', dist: 1, twice: true }, [200, 420, 700, 1000, 1500]],
];
const FW = 400, FH = 250, ROWS = 4;
await page.evaluate(() => { window.__t = 100000; performance.now = () => window.__t; });
let sheet = 0;
for (let s0 = 0; s0 < scenes.length; s0 += ROWS) {
  const part = scenes.slice(s0, s0 + ROWS);
  await page.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; window.__sheet = c; }, [FW * 5, FH * part.length]);
  for (let row = 0; row < part.length; row++) {
    const [name, sc, times] = part[row];
    const info = await page.evaluate(async ([sc]) => {
      const { mapFromProvince } = await import('/src/battle/map.ts');
      const { createBattle } = await import('/src/battle/setup.ts');
      const a = window.__app, gs = a.gs;
      const atk = gs.factions[a.setup.attacker], def = gs.factions[a.setup.defender];
      const map = mapFromProvince(a.save.world, def.capital, { capital: false, fort: 0 });
      const st = createBattle(gs, map, a.setup.picks, 'fx', [atk.name.ja, def.name.ja], undefined, { weather: 'clear', night: false });
      a.openBattle(st, new Set([0, 1]), () => null, { label: '編成に戻る', fn: () => a.setupScreen() }, true);
      const g = st.map.grid;
      const A = st.units.find((u) => u.side === 0 && u.kind === 'troop');
      const foes = st.units.filter((u) => (sc.ally ? u.side === 0 && u.id !== A.id : u.side === 1) && u.kind === 'troop');
      const T = foes[0], T2 = foes[1];
      // 平らなマスが右下へ5つ続く所を探して、そこに並べる
      const free = (i) => i >= 0 && (st.map.terrain[i] === 'plain' || st.map.terrain[i] === 'road') && !st.units.some((u) => u.alive && u.pos === i);
      let c0 = -1, line = [];
      for (let i = 0; i < g.n && c0 < 0; i++) {
        const l = g.line(i, 0, 5);
        if (l.length === 5 && free(i) && l.every(free) && g.col(i) > 3 && g.row(i) > 2) { c0 = i; line = l; }
      }
      A.pos = c0; T.pos = line[sc.dist - 1];
      if (sc.second && T2) T2.pos = line[sc.dist];
      for (const u of [T, T2]) if (u) { u.hp = u.maxHp = 3000; }
      st.turn = 0;
      A.mp = A.maxMp = 999; A.int = 90; A.moved = false; A.acted = false; A.statuses = [];
      if (sc.skill) A.skills = [sc.skill]; else { A.tactics = [sc.tactic]; }
      if (sc.crit) A.critPct = 100; else A.critPct = -100;
      if (sc.miss) A.agi = -9999; else if (!sc.twice) A.agi = 9999;
      if (sc.ally) T.hp = 1200;
      const [ax, ay] = g.center(A.pos, 34), [tx, ty] = g.center(T.pos, 34);
      const cam = a.view.cam;
      cam.zoom = 1.9; cam.centerOn((ax + tx) / 2, (ay + ty) / 2);
      const act = sc.skill ? { type: 'skill', unit: A.id, skill: sc.skill, target: st.units.some((u) => u.pos === A.pos && false) ? A.pos : T.pos } : { type: 'tactic', unit: A.id, tactic: sc.tactic, target: T.pos };
      // 周囲に効く技は、自分のマスが対象
      const { skillTargetCells, tacticTargetCells } = await import('/src/rules/combat.ts');
      const { skillOf } = await import('/src/rules/stats.ts');
      const { D } = await import('/src/data/db.ts');
      const cells = sc.skill ? skillTargetCells(st, A, skillOf(sc.skill)) : tacticTargetCells(st, A, D.byTactic[sc.tactic]);
      if (!cells.includes(act.target)) act.target = cells.includes(A.pos) ? A.pos : cells[0];
      let r = null, tries = 0, keys = [];
      for (; tries < 80; tries++) {
        const n0 = st.log.length;
        a.view.clearFx();
        A.acted = false; A.mp = 999; T.hp = sc.ally ? 1200 : 3000; A.hp = A.maxHp;
        r = a.perform([act], 1);
        keys = st.log.slice(n0).map((e) => e.key);
        if (!r.ok) break;
        const missed = keys.includes('miss') && !keys.includes('hit') && !keys.includes('hit.crit');
        if (sc.skill && !sc.twice && !!sc.miss !== missed) continue;
        break;
      }
      if (sc.twice) { A.acted = false; window.__t += 330; const r2 = a.perform([act], 1); window.__t -= 330; keys.push('|', ...st.log.slice(-6).map((e) => e.key)); r.dur = Math.max(r.dur, r2.dur + 330); }
      a.selected = null; a.inspect = null; a.hoverCell = -1;
      a.refresh();
      const [sx, sy] = cam.toScreen((ax + tx) / 2, (ay + ty) / 2);
      return { ok: r.ok, dur: Math.round(r.dur), tries, keys: keys.join(' '), sx, sy, dpr: cam.dpr, target: act.target, cells: cells.length };
    }, [sc]);
    console.log(`${name}：${info.ok ? 'OK' : '実行できず'}　次の手まで ${info.dur} ミリ秒　${info.keys}`);
    for (let k = 0; k < times.length; k++) {
      await page.evaluate(([t, k, row, FW, FH, info, label]) => {
        window.__t = 100000 + t;
        const a = window.__app;
        a.view.draw();
        const cv = a.view.canvas, ctx = window.__sheet.getContext('2d');
        const d = info.dpr;
        ctx.drawImage(cv, (info.sx - FW / 2) * d, (info.sy - FH / 2) * d, FW * d, FH * d, k * FW, row * FH, FW, FH);
        ctx.fillStyle = 'rgba(20,18,15,0.8)'; ctx.fillRect(k * FW, row * FH, k === 0 ? 250 : 70, 20);
        ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.textBaseline = 'top';
        ctx.fillText(k === 0 ? `${label}  ${t}ms` : `${t}ms`, k * FW + 4, row * FH + 3);
        ctx.strokeStyle = '#000'; ctx.strokeRect(k * FW, row * FH, FW, FH);
      }, [times[k], k, row, FW, FH, info, name]);
    }
    await page.evaluate(() => { window.__t = 100000; });
  }
  const data = await page.evaluate(() => window.__sheet.toDataURL('image/png'));
  writeFileSync(path.join(out, `fx_sheet${sheet++}.png`), Buffer.from(data.split(',')[1], 'base64'));
}
// エフェクトが終わったら、描き直しが止まること
const still = await page.evaluate(async () => {
  window.__t = 100000 + 60000;
  const a = window.__app;
  a.view.draw();
  let frames = 0;
  const orig = a.view.draw.bind(a.view);
  a.view.draw = () => { frames++; orig(); };
  await new Promise((r) => setTimeout(r, 400));
  a.view.draw = orig;
  return { frames, left: a.view.fx.length };
});
console.log(`エフェクトが終わったあとの描き直し：${still.frames}回、残りの演出 ${still.left}`);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'ページのエラーなし');
await browser.close();
