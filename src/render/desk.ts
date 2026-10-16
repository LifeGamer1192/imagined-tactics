// 地図の外側（地図が画面に収まりきらない余白）に敷く机の布。主張しないよう、暗く沈めて薄く見せる。
// 絵がまだ読めていないときは、これまでどおりの地の色で塗る。
import { art } from '../art/art';

/** 画面全体を、机の布（暗く沈めたもの）で塗る。fallback は絵が無いときの色 */
export function drawDesk(ctx: CanvasRenderingContext2D, w: number, h: number, fallback: string): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = fallback;
  ctx.fillRect(0, 0, w, h);
  const img = art('bg/desk');
  if (!img) return;
  // 画面いっぱいに覆う（縦横比を保って、はみ出す方を切る）
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.globalAlpha = 0.22;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}
