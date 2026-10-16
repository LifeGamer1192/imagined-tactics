// 観戦と手動の切り替え、速さの切り替えの確認。開発サーバー（5183）を動かしてから実行する。
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
await page.click('[data-sample="sengoku_fid5_1575"]');
await page.waitForSelector('#modeLocal');
await page.click('#modeLocal');
await page.waitForSelector('#start');
await page.click('#start');
await page.waitForSelector('#watch');
const log = async () => (await page.$$('#log > div')).length;
const ok = (name, v, extra = '') => console.log(v ? 'OK ' : 'NG ', name, extra);
ok('手動で始まり、ターン終了のボタンがある', !!(await page.$('#end')));
// 速さ5の観戦は1秒足らずで決着するので、切り替えの確認は速さ4で行う
await page.click('[data-speed="4"]');
ok('速さ5を選べる', (await page.getAttribute('[data-speed="4"]', 'class')).includes('on'));
await page.click('[data-speed="3"]');
ok('天気が出ている', /天気：(晴れ|雨|霧|雪)/.test(await page.textContent('#sky')), await page.textContent('#sky'));
await page.click('[data-vol="2"]');
ok('音量を選べて、ブラウザに覚える', (await page.getAttribute('[data-vol="2"]', 'class')).includes('on') && (await page.evaluate(() => localStorage.getItem('hexsim.volume'))) === '2');
const a = await log();
await page.click('#watch');
// 攻撃の記録がたまるまで、少し長めに見る
await page.waitForTimeout(6000);
const b = await log();
ok('観戦にすると自軍も勝手に動く', b > a && !(await page.$('#end')), `記録 ${a} → ${b}`);
// 速く動いている間でも、音量のボタンを押せる
await page.click('[data-vol="0"]');
ok('観戦中も音量を切り替えられる', (await page.getAttribute('[data-vol="0"]', 'class')).includes('on') && (await page.getAttribute('[data-speed="3"]', 'class')).includes('on'));
await page.click('[data-speed="0"]');
await page.waitForTimeout(300);
const c = await log();
await page.waitForTimeout(1500);
const d = await log();
ok('速さ1では遅くなる', d - c < b - a, `1.5秒で ${d - c} 行（速さ4では ${b - a} 行）`);
// 記録の細かさ（簡易・通常・詳細）：観戦中でも切り替えられ、すでに出ている記録も出し直す。速さは変わらない
const logText = async () => page.textContent('#log');
ok('記録の細かさは、はじめは通常', (await page.getAttribute('[data-log="1"]', 'class')).includes('on'));
await page.click('[data-log="2"]');
const detail = await logText();
// 戦いの始めは移動ばかりなので、攻撃の式（命中率）か、移動の内訳（使った移動力）のどちらかが出ていればよい
ok('詳細にすると、式や内訳が出る', /命中率 \d+%|移動力[\d.]+を使う/.test(detail) && (await page.getAttribute('[data-log="2"]', 'class')).includes('on'));
await page.click('[data-log="0"]');
const simple = await logText();
ok('簡易にすると、1件1行に戻る', !simple.includes('命中率') && !(await page.$('#log .blk')) && (await page.$$('#log > div')).length > 5);
await page.click('[data-log="1"]');
const normal = await logText();
ok('通常にすると、だれがだれに・体力の変化が出る', /体力 \d+→\d+/.test(normal) && !normal.includes('命中率') && !!(await page.$('#log .blk .s0, #log .blk .s1')));
ok('記録の細かさをブラウザに覚え、速さはそのまま', (await page.evaluate(() => localStorage.getItem('hexsim.logLevel'))) === '1' && (await page.getAttribute('[data-speed="0"]', 'class')).includes('on'));
await page.click('#watch');
await page.waitForFunction(() => !!document.querySelector('#end'), null, { timeout: 60000 });
ok('手動に戻すと、自軍の番で操作できる', !!(await page.$('#end')));
await page.screenshot({ path: process.argv[2] ?? 'watch.png' });
ok('ページのエラーなし', errors.length === 0, errors.join(' / '));
await browser.close();
