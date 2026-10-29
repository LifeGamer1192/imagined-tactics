// 図鑑（P90）の確認：タイトル画面の「図鑑」から開き、兵種の対応表・技・軍略・レベルの各タブが出るか、名前で探せるか、
// 名前の版を切り替えられるか、横にはみ出さないかを、PC とスマホ（縦・横）で見る。開発サーバー（5183）が要る。
// 使い方：node tools/zukan-check.mjs [撮る先のフォルダ]
import path from 'node:path';
import playwright from './pw.mjs';
const { chromium, devices } = playwright;
const out = process.argv[2];
const browser = await chromium.launch();
let ng = 0;
const ok = (name, v, extra = '') => { if (!v) ng++; console.log(v ? 'OK ' : 'NG ', name, extra); };
const { defaultBrowserType, ...phone } = devices['iPhone 13'];
const { defaultBrowserType: _d, ...land } = devices['iPhone 13 landscape'];
for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 800 } }], ['sp', phone], ['spland', land]]) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const press = (sel) => (opts.hasTouch ? page.tap(sel) : page.click(sel));
  const shot = async (n) => { if (out) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, `zukan_${tag}_${n}.png`) }); } };
  const fits = () => page.evaluate(() => { const h = document.querySelector('.zukan .help').getBoundingClientRect(); return h.left >= -1 && h.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
  await page.goto(process.env.HEX_URL ?? 'http://localhost:5183/');
  await page.waitForSelector('[data-zukan]');
  await press('[data-zukan]');
  await page.waitForSelector('.zukan:not([hidden]) .zk-units');
  const units = await page.$$eval('.zukan .zk-units tr', (r) => r.length);
  ok(`[${tag}] タブが10（名将を足した。P102）`, (await page.$$eval('[data-ztab]', (b) => b.length)) === 10);
  ok(`[${tag}] 兵種の対応表：50種と見出し`, units >= 50 + 18, `${units}行`);
  ok(`[${tag}] 兵種の対応表に3つの版の名前（雑兵・徒卒・民兵）`, /雑兵[\s\S]*徒卒[\s\S]*民兵/.test(await page.textContent('.zukan .help-body')));
  ok(`[${tag}] 窓が横にはみ出さない`, await fits());
  await shot('1_units');
  for (const [t, want, min] of [['classes', '侍大将', 30], ['skills', '通常攻撃', 10], ['tactics', '気力', 10], ['statuses', '解け方', 20], ['terrain', '天気', 10], ['traits', '戦場', 10], ['levels', '累計', 49]]) {
    await press(`[data-ztab="${t}"]`);
    await page.waitForFunction(() => !document.querySelector('.busy'));
    const rows = await page.$$eval('.zukan .help-body table tr', (r) => r.length);
    ok(`[${tag}] ${t} のタブ`, rows > min && (await page.textContent('.zukan .help-body')).includes(want), `${rows}行`);
    ok(`[${tag}] ${t}：窓が横にはみ出さない`, await fits());
    await shot(`2_${t}`);
  }
  // 行き来のリンク（P93）：兵種 → 技 → 兵種、軍略 → 役職
  await press('[data-ztab="units"]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  ok(`[${tag}] 兵種の表に気力と、技・軍略のリンク`, (await page.$$('.zk-units a.zk-go[data-zgo^="skills:"]')).length >= 50 && (await page.$$('.zk-units a.zk-go[data-zgo^="tactics:"]')).length > 5 && /気力/.test(await page.textContent('.zk-units')));
  const toSkill = await page.$eval('#zk-units-u05b a.zk-go[data-zgo^="skills:"]', (a) => a.dataset.zgo.split(':')[1]);
  await page.$eval('#zk-units-u05b a.zk-go[data-zgo^="skills:"]', (a) => a.scrollIntoView({ block: 'center' }));
  await press('#zk-units-u05b a.zk-go[data-zgo^="skills:"]');
  await page.waitForFunction((id) => !document.querySelector('.busy') && !!document.querySelector(`#zk-skills-${id}.zk-hit`), toSkill, { timeout: 5000 }).catch(() => {});
  const seen = await page.$eval(`#zk-skills-${toSkill}`, (r) => { const b = r.getBoundingClientRect(), h = document.querySelector('.zukan .help-body').getBoundingClientRect(); return r.classList.contains('zk-hit') && b.top >= h.top - 1 && b.bottom <= h.bottom + 1; }).catch(() => false);
  ok(`[${tag}] 兵種の技のリンクで、技の表のその行へ（見える所で光る）`, seen, toSkill);
  await shot('4_link_skill');
  await press(`#zk-skills-${toSkill} a.zk-go[data-zgo="units:u05b"]`);
  await page.waitForFunction(() => !document.querySelector('.busy') && !!document.querySelector('#zk-units-u05b.zk-hit'), null, { timeout: 5000 }).catch(() => {});
  ok(`[${tag}] 技の表から兵種へ戻れる`, !!(await page.$('#zk-units-u05b.zk-hit')));
  await press('[data-ztab="tactics"]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  const cl = await page.$eval('.zukan .help-body a.zk-go[data-zgo^="classes:"]', (a) => a.dataset.zgo.split(':')[1]);
  await page.$eval('.zukan .help-body a.zk-go[data-zgo^="classes:"]', (a) => a.scrollIntoView({ block: 'center' }));
  await press('.zukan .help-body a.zk-go[data-zgo^="classes:"]');
  await page.waitForFunction((id) => !document.querySelector('.busy') && !!document.querySelector(`#zk-classes-${id}.zk-hit`), cl, { timeout: 5000 }).catch(() => {});
  ok(`[${tag}] 軍略の表から役職へ`, !!(await page.$(`#zk-classes-${cl}.zk-hit`)), cl);
  await shot('5_link_class');
  // 状態（P94）：軍略の効き目に説明が入っていて、状態の名前から状態のページへ移れる
  await press('[data-ztab="tactics"]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  const blank = await page.$$eval('.zukan .help-body tr', (rs) => rs.slice(1).filter((r) => r.children[5]?.textContent.trim() === '—').map((r) => r.children[0].textContent.trim()));
  ok(`[${tag}] 軍略の効き目がどれも空でない`, blank.length === 0, blank.join(' '));
  await page.$eval('.zukan .help-body a.zk-go[data-zgo="statuses:poison"]', (a) => a.scrollIntoView({ block: 'center' }));
  await press('.zukan .help-body a.zk-go[data-zgo="statuses:poison"]');
  await page.waitForFunction(() => !document.querySelector('.busy') && !!document.querySelector('#zk-statuses-poison.zk-hit'), null, { timeout: 5000 }).catch(() => {});
  ok(`[${tag}] 軍略の状態の名前から、状態のページへ`, !!(await page.$('#zk-statuses-poison.zk-hit')));
  await shot('6_status');
  // 西洋版の名前（P94）
  await page.selectOption('[data-zk="ver"]', 'west');
  await press('[data-ztab="skills"]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  ok(`[${tag}] 名前を西洋版にすると、技も西洋の名前（盾列突き）`, /盾列突き/.test(await page.textContent('.zukan .help-body')));
  await page.selectOption('[data-zk="ver"]', 'jp');
  // 昇格の系図：兵と武将の木が出る
  await press('[data-ztab="tree"]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  const nodes = await page.$$eval('.zukan .zk-node', (n) => n.length);
  ok(`[${tag}] 昇格の系図：兵と武将の木`, nodes >= 50 + 30 && /長柄足軽/.test(await page.textContent('.zukan .help-body')) && /侍大将/.test(await page.textContent('.zukan .help-body')), `${nodes}個`);
  ok(`[${tag}] 昇格の系図：窓が横にはみ出さない`, await fits());
  await shot('3_tree');
  await press('[data-ztab="levels"]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  // レベル表：役職・兵種を選び直すと数が変わる
  const before = await page.textContent('.zk-levels');
  await page.selectOption('[data-zk="unit"]', 'u15c');
  ok(`[${tag}] レベル表：兵種を選び直すと数が変わる`, (await page.textContent('.zk-levels')) !== before);
  // 軍略：名前で探す・名前の版
  await press('[data-ztab="tactics"]');
  const all = await page.$$eval('.zukan .help-body table tr', (r) => r.length);
  await page.fill('[data-zk="q"]', '火');
  const some = await page.$$eval('.zukan .help-body table tr', (r) => r.length);
  ok(`[${tag}] 名前で探すと絞られる`, some > 1 && some < all, `${all} → ${some}行`);
  await page.fill('[data-zk="q"]', '');
  await page.selectOption('[data-zk="ver"]', 'cn');
  ok(`[${tag}] 名前を中国版に切り替えられる`, (await page.textContent('.zukan .help-body')) !== '' && (await page.$eval('[data-zk="ver"]', (s) => s.value)) === 'cn');
  await page.selectOption('[data-zk="ver"]', 'jp');
  await press('.zukan .help-close');
  ok(`[${tag}] 閉じられる`, await page.$eval('.zukan', (e) => e.hidden));
  ok(`[${tag}] ページのエラーなし`, errors.length === 0, errors.join(' / '));
  await context.close();
}
await browser.close();
console.log(ng ? `NG ${ng}件` : 'すべて OK');
process.exit(ng ? 1 : 0);
