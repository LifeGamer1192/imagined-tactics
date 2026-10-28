// 遊び方の案内（src/ui/help.ts）の確認。開発サーバー（5183）を動かしてから実行する。
// PC幅（1280×800）とスマホ幅（390×780）で、開く・タブ・閉じる（Esc、外側のクリック）を確かめ、画面を撮る。
// 使い方：node tools/help-check.mjs [画面の保存先=shots/help]
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import playwright from './pw.mjs';
const { chromium } = playwright;
const url = process.env.HEX_URL ?? 'http://localhost:5183/';
const out = process.argv[2] ?? 'shots/help';
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? `  … ${detail}` : ''}`); };
const browser = await chromium.launch();
const errors = [];

for (const [label, viewport] of [['pc', { width: 1280, height: 800 }], ['sp', { width: 390, height: 780 }]]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.accept(); });
  const shot = (name) => page.screenshot({ path: path.join(out, `${label}_${name}.png`) });
  const open = () => page.isVisible('.help');
  /** 案内の中身が、横にはみ出していないか（表は自分の枠の中で横に動く） */
  const fits = () => page.evaluate(() => {
    const b = document.querySelector('.help-body'), h = document.querySelector('.help').getBoundingClientRect();
    return b.scrollWidth <= b.clientWidth + 1 && h.left >= 0 && h.right <= innerWidth && h.bottom <= innerHeight;
  });

  // タイトル：「遊び方」の入口と、右下の「？」
  await page.goto(url);
  await page.waitForSelector('[data-sample]');
  check(`${label} 右下に「？」がある`, await page.isVisible('.help-btn'));
  await page.click('[data-help]');
  check(`${label} タイトルの「遊び方」で開き、はじめにが出る`, (await open()) && (await page.textContent('.help nav .on')) === 'はじめに');
  for (const [tab, word] of [['intro', '始め方'], ['strategy', '諸国巡り'], ['battle', '采配の範囲'], ['terms', '戦略の言葉']]) {
    await page.click(`.help [data-tab="${tab}"]`);
    const text = await page.textContent('.help-body');
    check(`${label} タブ ${tab}`, text.includes(word) && !/undefined|NaN|null/.test(text) && (await fits()));
    await shot(`help_${tab}`);
    // 長いタブは、下まで送ったところも撮る
    await page.evaluate(() => { const b = document.querySelector('.help-body'); b.scrollTop = b.scrollHeight; });
    await shot(`help_${tab}_end`);
  }
  await page.keyboard.press('Escape');
  check(`${label} Esc で閉じる`, !(await open()));
  await page.click('.help-btn');
  await page.mouse.click(3, 3);
  check(`${label} 外側のクリックで閉じる`, !(await open()));
  await page.click('.help-btn');
  await page.click('.help-close');
  check(`${label} 「閉じる」で閉じる`, !(await open()));

  // モード選び・国選び・編成：右下のボタンと重ならない
  const clear = () => page.evaluate(() => {
    const h = document.querySelector('.help-btn').getBoundingClientRect();
    return [...document.querySelectorAll('#app button, #app select, #app input')].every((el) => {
      const r = el.getBoundingClientRect();
      return r.width === 0 || r.right <= h.left || r.left >= h.right || r.bottom <= h.top || r.top >= h.bottom;
    });
  });
  await page.click('[data-sample="sengoku_fid5_1575"]');
  await page.waitForSelector('#modeLocal');
  check(`${label} モードを選ぶ画面で「？」が操作の上に重ならない`, await clear());
  await shot('modes');
  await page.click('#modeNation');
  await page.waitForSelector('#campaign');
  check(`${label} 国を選ぶ画面で「？」が操作の上に重ならない`, await clear());
  await shot('nations');
  await page.click('#toModes');
  await page.waitForSelector('#modeLocal');
  await page.click('#modeLocal');
  await page.waitForSelector('#start');
  check(`${label} 編成の画面で「？」が操作の上に重ならない`, await clear());
  await shot('setup');

  // 戦闘：開くと戦闘のタブ。Esc は案内だけを閉じ、選んだユニットはそのまま
  await page.click('#start');
  await page.waitForSelector('.battle canvas');
  // 自分で戦う戦いは配置の段階から始まる。配置完了のボタンが「？」に隠れないこと
  await page.waitForSelector('#deployDone');
  await page.waitForTimeout(400);
  check(`${label} 配置完了のボタンが「？」と重ならない`, await page.evaluate(() => {
    const h = document.querySelector('.help-btn').getBoundingClientRect(), r = document.querySelector('#deployDone').getBoundingClientRect();
    return r.right <= h.left || r.left >= h.right || r.bottom <= h.top || r.top >= h.bottom;
  }));
  await shot('battle_deploy');
  await page.click('#deployDone');
  await page.waitForSelector('#end');
  await page.waitForTimeout(800);
  await shot('battle');
  await page.click('.help-btn');
  check(`${label} 戦闘の画面では戦闘のタブが開く`, (await page.textContent('.help nav .on')) === '戦闘');
  await page.keyboard.press('Escape');
  check(`${label} 戦闘の画面でも Esc で閉じる`, !(await open()));
  await page.click('#quit'); await page.click('.confirm [data-a="ok"]');
  await page.waitForSelector('#start');

  // 中国版：能力値の名前が今の版になる
  await page.selectOption('#variant', 'cn');
  await page.waitForSelector('#start');
  await page.click('.help-btn');
  await page.click('.help [data-tab="terms"]');
  check(`${label} 中国版では能力値の名前が変わる`, (await page.textContent('.help-body')).includes('血気'));
  await shot('help_terms_cn');
  await page.keyboard.press('Escape');
  await page.selectOption('#variant', 'jp');
  await page.waitForSelector('#start');

  // 戦略：開くと戦略のタブ（編成 →「モードを選ぶ」→ 国モード → 始める）
  await page.click('#toModes');
  await page.waitForSelector('#modeNation');
  await page.click('#modeNation');
  await page.waitForSelector('#campaign');
  await page.click('#campaign');
  await page.waitForSelector('#next');
  await page.waitForTimeout(800);
  await shot('strategy');
  await page.click('.help-btn');
  check(`${label} 戦略の画面では戦略のタブが開く`, (await page.textContent('.help nav .on')) === '戦略');
  await page.keyboard.press('Escape');
  check(`${label} alert などの窓を出していない`, dialogs === 0);
  await page.close();
}
check('ページのエラーが無い', errors.length === 0, errors.slice(0, 3).join(' / '));
await browser.close();
const ng = results.filter((r) => !r).length;
console.log(ng ? `NG ${ng}件` : `すべて OK（${results.length}項目）`);
process.exit(ng ? 1 : 0);
