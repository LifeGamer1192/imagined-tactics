// 絵の読み込み。src/art/manifest.json にある絵だけを扱い、無ければ null を返す（呼ぶ側はコードで描いた形にする）。
// 読み込みは必要になったときに始め、終わったら描き直しを頼む。hist-sim の src/ui/art.ts・src/render/sprites.ts の考え方。

import manifestJson from './manifest.json';

const manifest = manifestJson as Record<string, string[]>;
const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
const listeners = new Set<() => void>();
let notifyTimer = 0;

/** 絵が読み込まれたときに呼ぶ処理を登録する（描き直し用）。戻り値で解除できる */
export function onArtLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  // まとめて読み込まれることが多いので、少し待ってから1回だけ知らせる
  clearTimeout(notifyTimer);
  notifyTimer = window.setTimeout(() => { for (const fn of listeners) fn(); }, 30);
}

/** その組の絵が何枚あるか（0 なら無い） */
export function artCount(group: string): number {
  return manifest[group]?.length ?? 0;
}

/**
 * 組の中の1枚。v（0〜1）でどれを使うかを選ぶ。まだ読み込めていなければ null を返し、読み込みを始める。
 */
export function art(group: string, v = 0): HTMLImageElement | null {
  const list = manifest[group];
  if (!list?.length) return null;
  const file = list[Math.min(list.length - 1, Math.floor(v * list.length))];
  const hit = images.get(file);
  if (hit instanceof HTMLImageElement) return hit;
  if (hit) return null;
  images.set(file, 'loading');
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL ?? './'}art/${file}`;
  img.decode().then(() => { images.set(file, img); notify(); }, () => { images.set(file, 'failed'); });
  return null;
}

/** 画面の部品（HTML）に置くときのアドレス。無ければ null */
export function artUrl(group: string, v = 0): string | null {
  const list = manifest[group];
  if (!list?.length) return null;
  return `${import.meta.env.BASE_URL ?? './'}art/${list[Math.min(list.length - 1, Math.floor(v * list.length))]}`;
}
