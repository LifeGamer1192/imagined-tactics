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
    await page.waitForSelector('#campaign'); await idle(); await page.waitForTimeout(500);
    ok(`[${tag}] 編成の画面に陣営の絵（${v}）`, await page.evaluate((v) => getComputedStyle(document.body).backgroundImage.includes(`setup_${v}`), v));
    await shot(`setup_${v}`);
    if (v === 'cn') break;
    // ---- 別のセーブ：確かめる窓
    await press('#back');
    await page.waitForSelector('.confirm');
    await shot('confirm_back');
    await press('.confirm [data-a="no"]');

    // ---- 戦闘
    await press('#start');
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
    // 全員待機の窓
    await press('#waitAll');
    await page.waitForSelector('.confirm');
    await shot('battle_waitall_confirm');
    await press('.confirm [data-a="no"]');
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
    await page.waitForSelector('#campaign'); await idle();
    // 負けの結果：手動で守り手が勝つ
    await press('#start');
    await page.waitForSelector('#end'); await idle();
    await page.evaluate(() => { const a = window.__app; a.st.winner = 1; a.finish(); });
    await page.waitForSelector('.result h2.brushed', { timeout: 10000 });
    await page.waitForTimeout(400);
    ok(`[${tag}] 負けの見出しは薄墨の帯・負けの絵`, !!(await page.$('.result h2.lost')) && (await page.$eval('.result .banner', (el) => el.style.backgroundImage.includes('defeat'))));
    await shot('battle_result_lose');
    await press('.result button.primary');
    await page.waitForSelector('#campaign'); await idle();
  }

  // ---- 戦略
  await page.goto(URL);
  await press('[data-sample="sengoku_fid5_1575"]');
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
