// 戦略画面の新しい操作（諸国巡り・外交・昇進）を、実際にボタンを押して確かめる。開発サーバー（5183）が要る。
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const errors = [];
const ok = (name, v, extra = '') => console.log(v ? 'OK ' : 'NG ', name, extra);
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await page.click('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeNation');
  await page.click('#modeNation');
  await page.waitForSelector('#campaign');
  await page.click('#campaign');
  await page.waitForSelector('#next');
  const tag = `[${vp.width}px] `;
  // まとめて選ぶ：全員 → レベルの高い3人 → 外す
  const boxes = () => page.$$eval('[data-pick]', (els) => ({ all: els.length, on: els.filter((e) => e.checked).length }));
  await page.click('#selAll');
  const all = await boxes();
  ok(tag + '「全員」で、その領の武将がすべて選ばれる', all.all > 3 && all.on === all.all, JSON.stringify(all));
  await page.click('#selTop');
  const top = await boxes();
  const topOk = await page.$$eval('[data-pick]', (els) => els.slice(0, 3).every((e) => e.checked) && els.slice(3).every((e) => !e.checked));
  ok(tag + '「レベルの高い3人」で、上から3人だけ選ばれる', top.on === 3 && topOk, JSON.stringify(top));
  // 移動：3つ先の自領まで青くなる（隣だけのときより多い）
  await page.click('#move');
  const reach = await page.evaluate(async () => {
    const s = window.__campaign, c = s.c, cam = await import('/src/strategy/campaign.ts');
    return { shown: s.targets('move').size, near: cam.moveTargets(c, s.selected, c.player, 1).size, far: cam.moveTargets(c, s.selected, c.player).size };
  });
  ok(tag + '移動先は、自領づたいに3つ先まで出る', reach.shown === reach.far && reach.far > reach.near, JSON.stringify(reach));
  await page.click('#move');
  await page.click('#selNone');
  ok(tag + '「外す」で選択が消える', (await boxes()).on === 0);
  // 深手：武将を1人深手にすると、選べる一覧から外れて「深手」と出る
  const hurtName = await page.evaluate(() => {
    const s = window.__campaign, c = s.c;
    const g = Object.values(c.gs.generals).find((x) => x.faction === c.player && x.prov === s.selected && !x.isLord);
    c.wounded[g.id] = c.gs.tick + 3;
    s.refresh();
    return g.name.ja;
  });
  ok(tag + '深手の武将は選べず、「深手（あと3か月）」と出る', new RegExp(`${hurtName} Lv\\d+：深手（あと3か月`).test(await page.textContent('#panel')) && (await boxes()).all === all.all - 1, hurtName);
  await page.click('[data-quest]'); await page.click('.confirm [data-a="ok"]');
  ok(tag + '諸国巡りに出すと記録に出る', (await page.textContent('#log')).includes('諸国巡りに出た'));
  // ほかの勢力の領を選ぶ（開発用の入口から）
  const rel = await page.evaluate(() => {
    const s = window.__campaign, c = s.c, me = c.player;
    const p = c.gs.provinces.find((x) => x.owner && x.owner !== me && !c.gs.wars.some((w) => [...w.attackers, ...w.defenders].includes(x.owner) && [...w.attackers, ...w.defenders].includes(me))
      && !c.gs.alliances.some(([a, b]) => (a === me && b === x.owner) || (b === me && a === x.owner)) && c.gs.factions[x.owner].overlord !== me && c.gs.factions[me].overlord !== x.owner
      && !c.gs.truces.some((t) => (t.a === me && t.b === x.owner) || (t.b === me && t.a === x.owner)));
    s.selected = p.id; s.refresh();
    return c.gs.factions[p.owner].name.ja;
  });
  ok(tag + '中立の勢力の領で外交のボタンが出る', !!(await page.$('[data-dip="war"]')) && !!(await page.$('[data-envoy="ally"]')), rel);
  await page.click('[data-dip="war"]'); await page.click('.confirm [data-a="ok"]');
  ok(tag + '戦を仕掛けると交戦中になり、停戦のボタンに変わる', (await page.textContent('#panel')).includes('交戦中') && !!(await page.$('[data-envoy="truce"]')));
  // 昇進：当主の兵を高いレベルにして、昇進のボタンを押す
  const before = await page.evaluate(() => {
    const s = window.__campaign, c = s.c, f = c.gs.factions[c.player], lord = c.gs.generals[f.lordId];
    lord.command = 999; lord.troops.forEach((t) => { t.level = 30; });
    s.selected = f.capital; s.refresh();
    return lord.troops.map((t) => t.unitId).join(',');
  });
  // 兵の札の隣の「▲◯◯」→ 比べ表と「戻れません」の確かめる窓 → 進める → 祝いの窓（P52）
  const up = await page.$('[data-up-ask]');
  let asked = '', party = '';
  if (up) {
    await up.click();
    await page.waitForSelector('.confirm');
    asked = await page.textContent('.confirm');
    await page.click('.confirm [data-a="ok"]');
    await page.waitForSelector('.cc-box');
    party = await page.textContent('.cc-box');
    await page.click('.cc-box [data-a="ok"]');
  }
  const after = await page.evaluate(() => { const c = window.__campaign.c; return c.gs.generals[c.gs.factions[c.player].lordId].troops.map((t) => t.unitId).join(','); });
  ok(tag + '兵の札の隣の昇進のボタンで、確かめる窓（比べ表・戻れない）を経て兵種が変わり、祝いの窓が出る', !!up && before !== after && /戻れません/.test(asked) && /進めたあと/.test(asked) && /昇格！/.test(party), `${before} → ${after}`);
  // 相手からの申し込み：停戦の申し込みを入れて、「受ける」を押す
  const offered = await page.evaluate(() => {
    const s = window.__campaign, c = s.c, me = c.player;
    const w = c.gs.wars.find((x) => x.attackers.includes(me) || x.defenders.includes(me));
    const from = w.attackers.includes(me) ? w.defenders[0] : w.attackers[0];
    c.offers.push({ kind: 'truce', from, until: c.gs.tick + 3 });
    s.refresh();
    return c.gs.factions[from].name.ja;
  });
  await page.click('[data-offer][data-yes]'); await page.click('.confirm [data-a="ok"]');
  ok(tag + '申し込みを受けると停戦になる', (await page.textContent('#log')).includes('停戦した'), offered);
  ok(tag + '難しさと兵糧の上限が出る', /ふつう/.test(await page.textContent('#panel')) && /兵糧\d+／\d+/.test(await page.textContent('#panel')));
  // 地図を拡大して動かしておく（月を進めても、拡大と位置がそのままか。P53）
  const cam0 = await page.evaluate(() => { const s = window.__campaign, cam = s.view.cam; cam.zoomAt(cam.vw / 3, cam.vh / 2, 2.5); cam.panBy(-60, 40); return { x: cam.x, y: cam.y, zoom: cam.zoom, month: s.c.gs.month }; });
  await page.click('#next');
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(200);
    if (await page.$('.result.fall [data-a="skip"]')) await page.click('.result.fall [data-a="skip"]'); else if (await page.$('.result.fall [data-a="ok"]')) await page.click('.result.fall [data-a="ok"]'); else if (await page.$('.result.report [data-a="ok"]')) await page.click('.result.report [data-a="ok"]'); else if (await page.$('.result [data-a="auto"]')) await page.click('.result [data-a="auto"]');
    else if ((await page.$('#next')) && (await page.evaluate((m) => window.__campaign.c.gs.month !== m, cam0.month))) break;
  }
  ok(tag + '月を進められる', !!(await page.$('#next')));
  const cam1 = await page.evaluate(() => { const cam = window.__campaign.view.cam; return { x: cam.x, y: cam.y, zoom: cam.zoom }; });
  ok(tag + '月を進めても、地図の拡大と位置がそのまま', Math.abs(cam1.zoom - cam0.zoom) < 1e-6 && Math.abs(cam1.x - cam0.x) < 1 && Math.abs(cam1.y - cam0.y) < 1, `${JSON.stringify(cam0)} → ${JSON.stringify(cam1)}`);
  const box = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  ok(tag + '横にはみ出さない', box.sw <= box.w, JSON.stringify(box));
  await page.screenshot({ path: `${process.argv[2] ?? '.'}/campaign_${vp.width}.png` });
  await page.close();
}
ok('ページのエラーなし', errors.length === 0, errors.join(' / '));
await browser.close();
