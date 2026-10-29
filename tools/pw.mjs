// Playwright の読み込み。兄弟フォルダ ../hist-sim にあればそれを借り、無ければこのリポジトリ（と NODE_PATH・全体に入れたもの）から探す。
import { createRequire } from 'node:module';
import path from 'node:path';
const bases = [path.resolve('../hist-sim/package.json'), path.resolve('package.json')];
let found;
for (const base of bases) {
  try { found = createRequire(base)('playwright'); break; } catch { /* 次を探す */ }
}
if (!found) {
  console.error('Playwright が見つからない。`npm i -D playwright` と `npx playwright install chromium` で入れる（または ../hist-sim に置く）。');
  process.exit(1);
}
// 天佑の札（P102）：戦いを開くと出て、閉じるまで戦いが始まらない。確かめの道具では、出たらすぐ閉じる
// （札そのものを確かめる道具は、process.env.HEX_KEEP_BOON = '1' にしてから開く）
const closeBoonCards = () => {
  const watch = () => new MutationObserver(() => document.querySelector('.boon-cut [data-a="next"]')?.click()).observe(document.body, { childList: true, subtree: true });
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
};
const launch = found.chromium.launch.bind(found.chromium);
found.chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const addScript = async (ctx) => { if (process.env.HEX_KEEP_BOON !== '1') await ctx.addInitScript(closeBoonCards); return ctx; };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => addScript(await newContext(...a));
  browser.newPage = async (...a) => (await browser.newContext(...a)).newPage();
  return browser;
};
export default found;
