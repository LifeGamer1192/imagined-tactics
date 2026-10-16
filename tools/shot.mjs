// 見た目の確認用に、戦闘と戦略マップの画面を撮る。開発サーバー（5183）を動かしてから実行する。
// 使い方：node tools/shot.mjs [出力先のフォルダ]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
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

for (const sample of ['sengoku_fid5_1575', 'shunju_fid5_259bc']) {
  await page.goto(url);
  await page.screenshot({ path: path.join(out, 'title.png') });
  if (!(await page.$(`[data-sample="${sample}"]`))) { console.log('見本なし：', sample); continue; }
  await page.click(`[data-sample="${sample}"]`);
  await page.waitForSelector('#modeLocal');
  await page.click('#modeLocal');
  await page.waitForSelector('#start');
  await page.screenshot({ path: path.join(out, `${sample}_setup.png`) });
  await page.click('#start');
  // 自分で戦う戦いは配置の段階から始まる：配置の画面も撮ってから、配置完了を押す
  await page.waitForSelector('#deployDone');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${sample}_deploy.png`) });
  await page.click('#deployDone');
  await page.waitForSelector('#end');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `${sample}_battle.png`) });
  // 城攻めの戦場と天気：同じ編成のまま、戦場と天気だけを替えて撮る
  const scenes = [
    ['siege_clear', { capital: true, walls: true }, { weather: 'clear', night: false }],
    ['siege_rain', { capital: true, walls: true }, { weather: 'rain', night: false }],
    ['siege_snow_night', { capital: true, walls: true }, { weather: 'snow', night: true }],
    ['fort_fog', { capital: false, fort: 0.4 }, { weather: 'fog', night: false }],
    ['camp_clear', { capital: false, fort: 0 }, { weather: 'clear', night: false }],
  ];
  for (const [name, mapOpts, sky] of scenes) {
    await page.evaluate(async ([mapOpts, sky]) => {
      const { mapFromProvince } = await import('/src/battle/map.ts');
      const { createBattle } = await import('/src/battle/setup.ts');
      const a = window.__app, gs = a.gs;
      const atk = gs.factions[a.setup.attacker], def = gs.factions[a.setup.defender];
      const map = mapFromProvince(a.save.world, def.capital, mapOpts);
      const st = createBattle(gs, map, a.setup.picks, 'shot', [atk.name.ja, def.name.ja], undefined, sky);
      a.openBattle(st, new Set([0]), () => null, { label: '編成に戻る', fn: () => a.setupScreen() }, true);
    }, [mapOpts, sky]);
    await page.waitForSelector('#deployDone');
    await page.click('#deployDone');
    await page.waitForSelector('#end');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${sample}_${name}.png`) });
  }
  // 演出の途中：観戦にして、動いているところを何枚か撮る
  await page.click('[data-speed="1"]');
  await page.click('#watch');
  for (let k = 0; k < 6; k++) {
    await page.waitForTimeout(k < 3 ? 2600 : 170);
    await page.screenshot({ path: path.join(out, `${sample}_fx${k}.png`) });
  }
  await page.goto(url);
  await page.click(`[data-sample="${sample}"]`);
  await page.waitForSelector('#modeNation');
  await page.click('#modeNation');
  await page.waitForSelector('#campaign');
  await page.click('#campaign');
  await page.waitForSelector('#next');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, `${sample}_strategy.png`) });
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'ページのエラーなし');
await browser.close();
