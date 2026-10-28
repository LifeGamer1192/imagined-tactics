// 白い紙に描いた絵（筆の帯、飾り、人物の後ろ姿のシート）を、白い所を透かした webp にする。
// 暗い画面の上に重ねるので、乗算ではなく、紙の白さに応じて透明にする（墨や色の濃い所ほど不透明）。
// 使い方：
//   node tools/art-ui.mjs alpha <元の画像> <出力.webp> [幅=1200]            … 1枚。絵のある所だけに切り詰める
//   node tools/art-ui.mjs grid <元の画像> <列> <行> <出力フォルダ> <名前,…> [幅=240] [高さ=320]
//                                                                          … 等分したマスごとに切り出し、下ぞろえで置く
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import playwright from './pw.mjs';
const { chromium } = playwright;
const [mode, src, ...rest] = process.argv.slice(2);
const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(src).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage();

/** ページの中で使う：白を透かし、絵のある所の四角を返す */
const prelude = `
  async function load(u) { const img = new Image(); img.src = u; await img.decode(); return img; }
  function keyOut(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h), p = d.data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, lo = Math.min(p[i], p[i + 1], p[i + 2]);
      // 白に近いほど透明。紙のむら（245より明るい所）は消す
      const a = Math.max(0, Math.min(255, Math.round((245 - lo) * 255 / 120)));
      if (a > 0) {
        // 透かしたぶん、色を濃い方へ戻す（白とまざって薄く見えないように）
        const k = a / 255;
        for (let c = 0; c < 3; c++) p[i + c] = Math.max(0, Math.min(255, Math.round((p[i + c] - 255 * (1 - k)) / k)));
      }
      p[i + 3] = a;
      if (a > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    ctx.putImageData(d, 0, 0);
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }`;

if (mode === 'alpha') {
  const [out, wArg] = rest;
  const url = await page.evaluate(`(async () => { ${prelude}
    const img = await load(${JSON.stringify(dataUrl)});
    const W = img.naturalWidth, H = img.naturalHeight, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const b = keyOut(ctx, W, H) ?? [0, 0, W, H], pad = 8;
    const bx = Math.max(0, b[0] - pad), by = Math.max(0, b[1] - pad), bw = Math.min(W, b[2] + pad) - bx, bh = Math.min(H, b[3] + pad) - by;
    const ow = Math.min(${Number(wArg ?? 1200)}, bw), oh = Math.round(ow * bh / bw), o = document.createElement('canvas');
    o.width = ow; o.height = oh;
    const octx = o.getContext('2d'); octx.imageSmoothingQuality = 'high';
    octx.drawImage(c, bx, by, bw, bh, 0, 0, ow, oh);
    return o.toDataURL('image/webp', 0.86);
  })()`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(out);
} else if (mode === 'grid') {
  const [cols, rows, outDir, namesArg, wArg, hArg] = rest;
  const names = namesArg.split(',');
  const urls = await page.evaluate(`(async () => { ${prelude}
    const img = await load(${JSON.stringify(dataUrl)});
    const W = img.naturalWidth, H = img.naturalHeight, C = ${Number(cols)}, R = ${Number(rows)}, OW = ${Number(wArg ?? 240)}, OH = ${Number(hArg ?? 320)};
    const out = [];
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      const cx = Math.round(q * W / C), cy = Math.round(r * H / R), cw = Math.round((q + 1) * W / C) - cx, ch = Math.round((r + 1) * H / R) - cy;
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
      const b = keyOut(ctx, cw, ch) ?? [0, 0, cw, ch];
      const bw = b[2] - b[0], bh = b[3] - b[1], s = Math.min((OW - 8) / bw, (OH - 6) / bh);
      const o = document.createElement('canvas'); o.width = OW; o.height = OH;
      const octx = o.getContext('2d'); octx.imageSmoothingQuality = 'high';
      // 足もとをそろえる（下ぞろえ・左右は中央）
      octx.drawImage(c, b[0], b[1], bw, bh, (OW - bw * s) / 2, OH - 3 - bh * s, bw * s, bh * s);
      out.push(o.toDataURL('image/webp', 0.86));
    }
    return out;
  })()`);
  mkdirSync(outDir, { recursive: true });
  urls.forEach((u, i) => { if (names[i] && names[i] !== '-') { const f = path.join(outDir, `${names[i]}.webp`); writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); console.log(f); } });
} else {
  console.error('使い方はファイルの先頭を見てください');
}
await browser.close();
