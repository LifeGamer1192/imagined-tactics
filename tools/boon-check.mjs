// 天佑（P102）の札と始めの一手を、PC・スマホ縦・スマホ横で確かめる。開発サーバー（5183）が要る。
// 戦国の見本で、守り手に真田昌幸（守備の名将）、攻め手に織田信長（格上）を置いた戦いを開き、札・効き目・始めの一手・上の帯を見る。
// 使い方：node tools/boon-check.mjs [画面を撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
process.env.HEX_KEEP_BOON = '1';   // 札を自動で閉じない
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', { ...devices['iPhone 13'] }], ['spl', { ...devices['iPhone 13 landscape'] }]]) {
  const page = await (await browser.newContext(opts)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', tag, name, extra); };
  const shot = async (n) => { if (out) await page.screenshot({ path: path.join(out, `boon_${tag}_${n}.png`) }); };
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await page.click('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeLocal');
  await page.click('#modeLocal');
  await page.waitForSelector('#start');
  await page.evaluate(async () => {
    const { mapFromProvince } = await import('/src/battle/map.ts');
    const { createBattle } = await import('/src/battle/setup.ts');
    const a = window.__app, gs = a.gs;
    const by = (n) => Object.values(gs.generals).find((g) => (g.recordName ?? g.name.ja) === n);
    const hero = by('真田昌幸'), foe = by('織田信長');
    const map = mapFromProvince(a.save.world, gs.factions[hero.faction].capital, { capital: true, fort: 0.6 });
    const st = createBattle(gs, map, [[foe.id], [hero.id]], 'boon-check', [gs.factions[foe.faction].name.ja, gs.factions[hero.faction].name.ja]);
    a.openBattle(st, new Set([1]), () => null, { label: '戻る', fn: () => a.setupScreen() }, true);
  });
  await page.waitForSelector('.boon-cut', { timeout: 8000 }).catch(() => null);
  const card = await page.$('.boon-cut');
  ok('天佑の札が出る', !!card);
  await page.waitForTimeout(900);
  await shot('1_card');
  if (card) {
    const text = await page.textContent('.boon-cut');
    ok('札に名前・条件・効き目・始めの一手', /守備の名将/.test(text) && /満たした条件/.test(text) && /格上の敵/.test(text) && /敵の駒みな：攻撃-10%/.test(text) && /始めの一手/.test(text), text.slice(0, 80));
    const t0 = Date.now();
    await page.click('.boon-cut [data-a="next"]');
    ok('閉じるのが速い', Date.now() - t0 < 400, `${Date.now() - t0}ms`);
    await page.waitForTimeout(450);
    await shot('2_opening');
    await page.waitForTimeout(1500);
  }
  ok('札を閉じると消える', !(await page.$('.boon-cut')));
  ok('上の帯に天佑', /天佑 守備の名将/.test(await page.textContent('#sky').catch(() => '')));
  await shot('3_after');
  ok('ページのエラーが無い', !errors.length, errors.join(' / '));
  await page.close();
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
