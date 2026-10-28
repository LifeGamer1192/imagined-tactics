// 切り分けた兵の駒の絵を、番号つきの一覧の画像にする（絵の取り違えを目で確かめる用）。
// 使い方：node tools/art-contact.mjs <jp|cn> <出力する png>
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import playwright from './pw.mjs';
const { chromium } = playwright;
const [variant, out] = process.argv.slice(2);
const dir = `public/art/unit/${variant}`;
const units = JSON.parse(readFileSync('data/system/units.json', 'utf8'));
const have = new Set(readdirSync(dir));
const cells = units.map((u) => {
  const file = `${u.id}.webp`;
  const src = have.has(file) ? `data:image/webp;base64,${readFileSync(path.join(dir, file)).toString('base64')}` : '';
  return `<div><img src="${src}"><span>${u.id} ${u.name[variant]}</span></div>`;
}).join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent(`<style>body{margin:8px;display:grid;grid-template-columns:repeat(10,1fr);gap:4px;font:12px sans-serif;background:#f4efe2}
div{text-align:center}img{width:100%;aspect-ratio:1;mix-blend-mode:multiply;display:block}</style>${cells}`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
