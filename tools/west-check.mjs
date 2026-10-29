// 西洋版の絵（P87）の確認：ローマの見本で、戦略の画面・外交の窓・武将の欄・戦場を開き、日本版・中国版の絵を1枚も読み込まないか、
// 西洋版の絵（場面・人物・兵の駒）を使っているかを見る。開発サーバー（5183）が要る。
// 使い方：node tools/west-check.mjs [撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium } = playwright;
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
const errors = [], arts = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => { const u = r.url(); if (/\/art\//.test(u)) arts.push(u.replace(/^.*\/art\//, '')); });
const shot = async (n) => { if (out) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, `west_${n}.png`) }); } };
// ほかの版の絵：日本版・中国版の場面・人物・兵の駒・城と町・城壁の記号
const foreign = () => arts.filter((a) => /(_jp|_cn)\.webp|\/(jp|cn)\//.test(a) && !a.startsWith('faces/'));

await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
await page.click('[data-sample="rome_fid3_212bc"]');
await page.waitForSelector('#modeNation');
await page.click('#modeNation');
await page.waitForSelector('#campaign');
await page.click('#campaign');
await page.waitForSelector('#next');
await page.waitForTimeout(800);
await shot('1_campaign');
// 本拠の欄（武将の後ろ姿・兵の駒）
const icons = (await page.$$eval('#panel img', (els) => els.map((e) => e.getAttribute('src')))).filter((s) => !s.startsWith('data:'));
ok('武将の欄の絵は西洋版（兵の駒・後ろ姿）', icons.length > 0 && icons.every((s) => !/\/(jp|cn)\//.test(s)) && icons.some((s) => /\/west\//.test(s)), icons.slice(0, 4).join(' '));
const panelText = await page.textContent('#panel');
// 日本版の兵種の名前（役職の「足軽」などは兵種でないので数えない）
const jpUnits = ['雑兵', '足軽槍組', '鉄砲足軽', '素破', '金瘡医', '竹束衆', '黒鍬衆', '大太刀衆', '騎馬武者', '野伏', '焙烙衆', '安宅船', '使番衆'];
ok('武将の欄の兵種は西洋の名前', !jpUnits.some((n) => panelText.includes(n)), jpUnits.filter((n) => panelText.includes(n)).join(' '));
// 外交の窓（よその勢力の領を選んで、同盟の使者の窓を開く）
await page.evaluate(() => { const s = window.__campaign, c = s.c, me = c.player; const p = c.gs.provinces.find((x) => x.owner && x.owner !== me); s.selected = p.id; s.refresh(); });
const env = await page.$('[data-envoy]');
if (env) {
  await env.click();
  await page.waitForSelector('.confirm');
  const banner = await page.$eval('.confirm', (el) => el.innerHTML.match(/scene\/[a-z]+_[a-z]+\.webp/)?.[0] ?? '');
  ok('外交の窓の絵は西洋版', /envoy_west/.test(banner), banner);
  await shot('2_envoy');
  await page.click('.confirm [data-a="no"]');
} else ok('外交のボタンがある', false);
// 戦場（局地戦）
await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
await page.click('[data-sample="rome_fid3_212bc"]');
await page.waitForSelector('#modeLocal');
await page.click('#modeLocal');
await page.waitForSelector('#start');
await shot('3_setup');
await page.click('#start');
await page.waitForSelector('#deployDone, #end', { timeout: 60000 });
await page.waitForTimeout(1200);
await shot('4_battle');
ok('戦場で西洋版の兵の駒を使う', arts.some((a) => a.startsWith('unit/west/')), arts.filter((a) => a.startsWith('unit/')).slice(0, 3).join(' '));
const f = foreign();
ok('日本版・中国版の絵を1枚も読み込まない', f.length === 0, f.slice(0, 6).join(' '));
ok('ページのエラーなし', errors.length === 0, errors.join(' / '));
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
