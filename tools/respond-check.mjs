// 操作への反応の速さの確認。決まり：どの操作でも、何の反応もない時間は0.2秒以内。
// 押してから次に画面が描かれるまでの時間を測る（重い処理をクリックの中でそのまま走らせると、終わるまで描かれない）。
// 時間のかかる処理は、その間「◎◎中…」（.busy）が出ていればよい。
// 開発サーバー（5183）か、HEX_URL の場所に対して使う。開発用の入口が無くても動く（画面の操作だけ）。
// 使い方：node tools/respond-check.mjs [見本の名前=sengoku_fid5_1575]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium } = playwright;
const url = process.env.HEX_URL ?? 'http://localhost:5183/';
const sample = process.argv[2] ?? 'sengoku_fid5_1575';
const LIMIT = 200;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  window.__lat = [];
  for (const type of ['click', 'pointerup', 'change']) {
    addEventListener(type, () => {
      const t = performance.now();
      // ハンドラが終わって、次に画面が描かれるときに呼ばれる
      requestAnimationFrame(() => window.__lat.push({ type, ms: performance.now() - t, busy: !!document.querySelector('.busy') }));
    }, true);
  }
});
let ng = 0;
const rows = [];
/** 操作を1つ行い、押してから描かれるまでの最大の時間と、「◎◎中…」が出たかを記録する */
async function act(name, fn, { settle = 400 } = {}) {
  await page.evaluate(() => { window.__lat = []; });
  const t0 = Date.now();
  await fn();
  await page.waitForTimeout(60);
  let sawBusy = !!(await page.$('.busy'));
  await page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 180000 });
  const total = Date.now() - t0;
  await page.waitForTimeout(settle);
  const lat = await page.evaluate(() => window.__lat);
  const worst = lat.reduce((m, x) => Math.max(m, x.ms), 0);
  sawBusy ||= lat.some((x) => x.busy);
  const ok = worst <= LIMIT;
  if (!ok) ng++;
  rows.push({ name, worst: Math.round(worst), busy: sawBusy, total, ok });
  console.log(ok ? 'OK ' : 'NG ', name.padEnd(26), `無反応 ${String(Math.round(worst)).padStart(5)}ms`, sawBusy ? `／表示あり（全体 ${total}ms）` : '');
}
const center = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

await page.goto(url);
await act('見本を選ぶ', () => page.click(`[data-sample="${sample}"]`));
await page.waitForSelector('#modeLocal');
await act('国モードを選ぶ', () => page.click('#modeNation'));
await page.waitForSelector('#campaign');
await act('モードの画面に戻る', () => page.click('#toModes'));
await page.waitForSelector('#modeLocal');
await act('局地戦モードを選ぶ', () => page.click('#modeLocal'));
await page.waitForSelector('#start');
await act('名前の版を切り替える', async () => { const v = await page.$eval('#variant', (el) => el.value); await page.selectOption('#variant', v === 'jp' ? 'cn' : 'jp'); });
await page.waitForSelector('#start');
await act('名前の版を戻す', async () => { const v = await page.$eval('#variant', (el) => el.value); await page.selectOption('#variant', v === 'jp' ? 'cn' : 'jp'); });
await page.waitForSelector('#start');
await act('戦闘開始', () => page.click('#start'));
await page.waitForSelector('#deployDone');
await act('配置完了', () => page.click('#deployDone'));
await page.waitForSelector('#end');
const [cx, cy] = await center('.battle canvas');
await act('戦場をクリック', () => page.mouse.click(cx - 300, cy));
await act('設定を開く', () => page.click('#ctlMore'));
await act('記録を詳細にする', () => page.click('[data-log]:last-of-type'));
await act('速さを5にする', () => page.click('[data-speed="4"]'));
await act('巡を終える（全員待機）', () => page.click('#end'), { settle: 300 });
if (await page.$('.confirm [data-a="ok"]')) await act('巡を終えるを確かめる', () => page.click('.confirm [data-a="ok"]'), { settle: 1500 });
// 速さ5の観戦は1秒足らずで決着するので、切り替えを試す前に遅くしておく
await act('速さを1にする', () => page.click('[data-speed="0"]'));
await act('観戦にする', () => page.click('#watch'), { settle: 800 });
await act('手動にする', () => page.click('#watch'));
await act('遊び方を開く', () => page.click('.help-fab, [data-help], #helpBtn').catch(() => {}));
await page.keyboard.press('Escape');
await act('編成に戻る', () => page.click('#quit').then(() => page.click('.confirm [data-a="ok"]')));
await page.waitForSelector('#start');
await act('編成からモードの画面へ', () => page.click('#toModes'));
await page.waitForSelector('#modeNation');
await act('国モードを選ぶ（2回目）', () => page.click('#modeNation'));
await page.waitForSelector('#campaign');
await act('戦略を始める', () => page.click('#campaign'));
await page.waitForSelector('#next');
const [sx, sy] = await center('.battle canvas');
await act('領をクリック', () => page.mouse.click(sx + 40, sy - 60));
await act('地図を動かす（ドラッグ）', async () => { await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 80, sy + 30, { steps: 4 }); await page.mouse.up(); });
await act('地図を拡大する', () => page.mouse.wheel(0, -400));
await act('自分の本拠を選び直す', () => page.evaluate(() => { /* 画面の操作だけで戻すのは場所に依るので、ここでは月送りの前に何もしない */ }));
await act('セーブの画面を開く', () => page.click('#saves'));
await page.keyboard.press('Escape');
if (await page.$('.savemenu')) await page.click('.savemenu button:has-text("閉じる")').catch(() => {});
await act('月を進める', () => page.click('#next'), { settle: 300 });
// 攻められた戦いをおまかせにすると、結果の窓が出る（P55）。「確かめた」で閉じると次の戦い
for (let i = 0; i < 12; i++) {
  if (await page.$('.result.fall [data-a="ok"]')) await act(`滅亡の窓を閉じる ${i + 1}`, () => page.click('.result.fall [data-a="ok"]'));
  else if (await page.$('.result.report [data-a="ok"]')) await act(`戦いの結果を確かめる ${i + 1}`, () => page.click('.result.report [data-a="ok"]'));
  else if (await page.$('.result [data-a="auto"]')) await act(`攻められた戦いをおまかせ ${i + 1}`, () => page.click('.result [data-a="auto"]'));
  else break;
}
await page.waitForSelector('#next');
// 攻める：自分の本拠の武将を1人選び、赤くなった領を押す（画面の操作だけ）
const pick = await page.$('[data-pick]:not(:disabled)');
if (pick) {
  await act('武将にチェックを入れる', () => pick.click());
  if (await page.$('#attack:not(:disabled)')) {
    await act('「攻める」を押す', () => page.click('#attack'));
    // 赤い領の場所は開発用の入口があれば調べる。無ければ飛ばす
    const spot = await page.evaluate(() => {
      const s = window.__campaign;
      if (!s) return null;
      const t = [...s.targets('attack')][0];
      if (t === undefined) return null;
      const p = s.c.gs.provinces[t], r = document.querySelector('.battle canvas').getBoundingClientRect();
      const [x, y] = s.view.cam.toScreen(p.cx, p.cy);
      return [r.x + x, r.y + y];
    });
    if (spot) {
      await act('攻める領をクリック', () => page.mouse.click(spot[0], spot[1]));
      if (await page.$('.result [data-a="play"]')) {
        await act('自分で戦う', () => page.click('.result [data-a="play"]'));
        await page.waitForSelector('#deployDone');
        await act('配置完了（戦略の戦い）', () => page.click('#deployDone'));
        await page.waitForSelector('#auto');
        await act('おまかせで決着', () => page.click('#auto').then(() => page.click('.confirm [data-a="ok"]')));
        await page.waitForSelector('.result button');
        await act('戦略マップへ', () => page.click('.result button'));
      }
    }
  }
}
await page.waitForSelector('#next');
// 攻め取ったときは祝いの窓（P38）が出る
await page.waitForTimeout(300);
if (await page.$('.victory-box')) await act('勝鬨をあげる（祝いの窓を閉じる）', () => page.click('.victory-box [data-a="ok"]'));
await act('やめる', () => page.click('#exit').then(() => page.click('.confirm [data-a="ok"]')));
console.log('');
console.log(errors.length ? `ページのエラー：${errors.join(' / ')}` : 'ページのエラーなし');
console.log(ng ? `NG ${ng}件（無反応が ${LIMIT}ms を超えた操作）` : `すべて ${LIMIT}ms 以内`);
await browser.close();
process.exit(ng || errors.length ? 1 : 0);
