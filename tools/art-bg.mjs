// 背景画を、幅を決めた webp にして置く。
// 使い方：node tools/art-bg.mjs <元の画像> <出力先（.webp）> [幅=1600]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import playwright from './pw.mjs';
const { chromium } = playwright;
const [src, out, wArg] = process.argv.slice(2);
if (!src || !out) { console.error('使い方：node tools/art-bg.mjs <元の画像> <出力先> [幅]'); process.exit(1); }
const width = Number(wArg ?? 1600);
const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
const browser = await chromium.launch();
const page = await browser.newPage();
const url = await page.evaluate(async ({ dataUrl, width }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = Math.min(width, img.naturalWidth), h = Math.round(w * img.naturalHeight / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/webp', 0.82);
}, { dataUrl: `data:${mime};base64,${readFileSync(src).toString('base64')}`, width });
await browser.close();
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log(out);
