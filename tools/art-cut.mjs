// 生成した絵のシート（縦横 N 個ずつ並んだ1枚）を、1個ずつの絵に切り分けて webp にする。
// 紙の地（白っぽい所）は真っ白に寄せる。ゲームでは乗算で重ねるので、白は透けて和紙の色になる。
// 絵の部分だけを囲む四角を求め、正方形の中央に置き直してから縮める。
// 使い方：node tools/art-cut.mjs <シートの画像> <N> <出力先のフォルダ> <名前,名前,…（左上から右へ。- は飛ばす）> [大きさ=192]
//   最後に tile を付けると、地形のタイル用（白へ寄せない・余白なし）。例：… a,b,c 256 tile
// 例：node tools/art-cut.mjs sheet.jpg 3 public/art/unit/jp u01a,u01b,u01c,u02a,u02b,u03a,u03b,-,-
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('../hist-sim/package.json'));
const { chromium } = require('playwright');
const [src, nArg, outDir, namesArg, sizeArg, modeArg] = process.argv.slice(2);
// tile：マスに敷く絵（四角いっぱいに塗ってある絵）。白へ寄せず、余白を付けず、中央の正方形を切り出す
const tile = modeArg === 'tile';
if (!src || !nArg || !outDir || !namesArg) { console.error('引数が足りません（ファイルの先頭の使い方を見てください）'); process.exit(1); }
const n = Number(nArg), size = Number(sizeArg ?? 192), names = namesArg.split(',');
mkdirSync(outDir, { recursive: true });
const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(src).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const cells = await page.evaluate(async ({ dataUrl, n, size, tile }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  // シート全体で紙の地を白へ寄せ、墨のある所を調べる
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H), p = d.data;
  // 絵は等間隔のマスからはみ出すことがある（弓の先など）。つながった墨のかたまりを求め、重心のあるマスに割り当てる
  const F = 4, lw = Math.ceil(W / F), lh = Math.ceil(H / F);
  const ink = new Uint8Array(lw * lh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const lo = Math.min(p[i], p[i + 1], p[i + 2]), hi = Math.max(p[i], p[i + 1], p[i + 2]);
    if (!tile && hi - lo < 34) {
      const t = Math.max(0, Math.min(1, (lo - 178) / 44));
      for (let k = 0; k < 3; k++) p[i + k] += (255 - p[i + k]) * t;
    }
    if (Math.min(p[i], p[i + 1], p[i + 2]) < (tile ? 222 : 150)) ink[Math.floor(y / F) * lw + Math.floor(x / F)] = 1;
  }
  ctx.putImageData(d, 0, 0);
  // 少し太らせて、離れた部品（煙、弦）をつなぐ
  const R = 1, fat = new Uint8Array(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    if (!ink[y * lw + x]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < lw && yy < lh) fat[yy * lw + xx] = 1;
    }
  }
  const box = Array.from({ length: n * n }, () => null);
  const seen = new Uint8Array(lw * lh);
  /** 低解像度のマスごとに、どのマスの絵か（0 は無し、マス番号+1） */
  const owner = new Uint8Array(lw * lh);
  for (let s = 0; s < lw * lh; s++) {
    if (!fat[s] || seen[s]) continue;
    const stack = [s], all = [s]; seen[s] = 1;
    let x0 = lw, y0 = lh, x1 = -1, y1 = -1, sx = 0, sy = 0, cnt = 0;
    while (stack.length) {
      const q = stack.pop(), x = q % lw, y = (q - x) / lw;
      cnt++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= lw || yy >= lh) continue;
        const t = yy * lw + xx;
        if (fat[t] && !seen[t]) { seen[t] = 1; stack.push(t); all.push(t); }
      }
    }
    // 小さな点（紙の繊維など）は数えない
    if (cnt < 60) continue;
    const c = Math.min(n - 1, Math.floor((sx / cnt) / (lw / n))), r = Math.min(n - 1, Math.floor((sy / cnt) / (lh / n)));
    for (const q of all) owner[q] = r * n + c + 1;
    const b = box[r * n + c];
    if (!b) box[r * n + c] = [x0, y0, x1, y1];
    else { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); }
  }
  const out = [];
  if (tile) {
    // タイルは等間隔に並んでいるので、マスの中央 76% を切り出す（白いすき間と、端のにじみを避ける）
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const cw = W / n, ch = H / n, sd = Math.min(cw, ch) * 0.76;
      const o = document.createElement('canvas');
      o.width = size; o.height = size;
      const oc = o.getContext('2d');
      oc.imageSmoothingQuality = 'high';
      oc.drawImage(cv, c * cw + (cw - sd) / 2, r * ch + (ch - sd) / 2, sd, sd, 0, 0, size, size);
      out.push(o.toDataURL('image/webp', 0.86));
    }
    return out;
  }
  for (let ci = 0; ci < box.length; ci++) {
    const b = box[ci];
    if (!b) { out.push(null); continue; }
    const x0 = Math.max(0, (b[0] + R) * F), y0 = Math.max(0, (b[1] + R) * F);
    const bw = Math.min(W, (b[2] - R + 1) * F) - x0, bh = Math.min(H, (b[3] - R + 1) * F) - y0;
    if (tile) {
      // 端のにじみを避けて、少し内側の正方形を切り出す
      const sd = Math.min(bw, bh) * 0.94, tx = x0 + (bw - sd) / 2, ty = y0 + (bh - sd) / 2;
      const o = document.createElement('canvas');
      o.width = size; o.height = size;
      const oc = o.getContext('2d');
      oc.imageSmoothingQuality = 'high';
      oc.drawImage(cv, tx, ty, sd, sd, 0, 0, size, size);
      out.push(o.toDataURL('image/webp', 0.86));
      continue;
    }
    const side = Math.max(bw, bh) * 1.2;
    const o = document.createElement('canvas');
    o.width = size; o.height = size;
    const oc = o.getContext('2d');
    oc.fillStyle = '#fff'; oc.fillRect(0, 0, size, size);
    oc.imageSmoothingQuality = 'high';
    const s = size / side;
    // 囲みの中に入り込んだ、となりの絵は白く消す
    const part = ctx.getImageData(x0, y0, bw, bh), pp = part.data;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const ow = owner[Math.floor((y0 + y) / F) * lw + Math.floor((x0 + x) / F)];
      if (ow && ow !== ci + 1) { const i = (y * bw + x) * 4; pp[i] = pp[i + 1] = pp[i + 2] = 255; }
    }
    const pc = document.createElement('canvas');
    pc.width = bw; pc.height = bh;
    pc.getContext('2d').putImageData(part, 0, 0);
    oc.drawImage(pc, 0, 0, bw, bh, (size - bw * s) / 2, (size - bh * s) / 2, bw * s, bh * s);
    out.push(o.toDataURL('image/webp', 0.88));
  }
  return out;
}, { dataUrl, n, size, tile });
await browser.close();

let made = 0;
cells.forEach((url, i) => {
  const name = names[i];
  if (!name || name === '-' || !url) return;
  writeFileSync(path.join(outDir, `${name}.webp`), Buffer.from(url.split(',')[1], 'base64'));
  made++;
});
console.log(`${made}枚 → ${outDir}`);
