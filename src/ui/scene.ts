// 画面の背景や見出しに敷く絵（public/art/bg）。絵が無ければ null を返し、地の色のままにする。
// 日本版・中国版で描き分けた絵は「名前_jp」「名前_cn」、どちらにも使う絵は「名前」で置いてある。
import { art, artUrl } from '../art/art';

type Variant = 'jp' | 'cn';

/** 版に合った絵（その版の絵が無ければ、共通の絵） */
export function sceneUrl(name: string, variant: Variant): string | null {
  return artUrl(`bg/${name}_${variant}`) ?? artUrl(`scene/${name}_${variant}`) ?? artUrl(`bg/${name}`);
}

/** 月 → 季節の帯の絵（3〜5月が春、6〜8月が夏、9〜11月が秋、12〜2月が冬） */
export function seasonUrl(month: number): string | null {
  const s = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
  return artUrl(`bg/season_${s}`);
}

/**
 * 画面の背景に絵を敷く（null なら外す）。情報欄の和紙の質感は、どの画面でも敷いておく。
 * aside を渡すと、地図の横の情報欄（コマンドの欄）の下のほうに、その絵を薄く敷く
 */
export function setScene(url: string | null, aside: string | null = null): void {
  document.body.style.setProperty('--aside-scene', aside ? `url("${aside}")` : 'none');
  const b = document.body;
  b.classList.toggle('scene', !!url);
  b.style.setProperty('--scene-bg', url ? `url("${url}")` : 'none');
  // 情報欄・窓の地、筆の帯、窓の四隅の飾り
  for (const [v, name] of [['--panel-bg', 'bg/panel'], ['--brush-ink', 'ui/brush_ink'], ['--brush-red', 'ui/brush_red'], ['--corner-tl', 'ui/corner_tl'], ['--corner-tr', 'ui/corner_tr'], ['--corner-bl', 'ui/corner_bl'], ['--corner-br', 'ui/corner_br']] as const) {
    const u = artUrl(name);
    b.style.setProperty(v, u ? `url("${u}")` : 'none');
  }
  // 地図の外側に敷く机の布は、先に読み始めておく
  art('bg/desk');
}

/** 結果や知らせの窓の上に載せる、横長の絵 */
export function bannerHtml(url: string | null): string {
  return url ? `<div class="banner" style="background-image:url('${url}')"></div>` : '';
}

/** 勢力の色を左から右へ薄くして、季節の絵の上に重ねる（見出しの帯） */
export function seasonBand(rgb: [number, number, number] | null, month: number): string {
  const c = rgb ? rgb.join(',') : '85,85,85', url = seasonUrl(month);
  const grad = `linear-gradient(90deg, rgba(${c},0.96) 0%, rgba(${c},0.86) 45%, rgba(${c},0.45) 100%)`;
  return url ? `${grad}, url('${url}') center / cover` : `rgb(${c})`;
}
