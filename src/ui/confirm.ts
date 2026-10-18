// 確かめる窓。取り返しのつかない操作や、大きな結果を招く操作の前に、説明を見せて意思を確かめる。
// ブラウザの確認窓（confirm）は使わない（見た目がそろわず、スマホでは文字が小さい）。

import { bannerHtml } from './scene';

export interface ConfirmOptions {
  title: string;
  /** 説明（HTML。呼ぶ側でエスケープしておく） */
  body: string;
  ok?: string;
  cancel?: string;
  /** 上に載せる絵 */
  banner?: string | null;
  /** 取り返しがつかない操作（決めるボタンを朱にしない・やめるを強調する） */
  danger?: boolean;
  /** 知らせるだけ（決めるボタンだけを出す） */
  single?: boolean;
}

/** 窓を出して、決めたら true、やめたら false を返す */
export function confirmBox(host: Element, o: ConfirmOptions): Promise<boolean> {
  host.querySelector('.result.ask')?.remove();
  const box = document.createElement('div');
  box.className = 'result ask confirm';
  box.innerHTML = `${o.banner ? bannerHtml(o.banner) : ''}<h2 class="wrap">${o.title}</h2>
    <div class="cbody">${o.body}</div>
    <p class="cbtns"><button data-a="ok" class="${o.danger ? '' : 'primary'}">${o.ok ?? '決める'}</button> ${o.single ? '' : `<button data-a="no" class="${o.danger ? 'primary' : ''}">${o.cancel ?? 'やめる'}</button>`}</p>`;
  host.appendChild(box);
  return new Promise((resolve) => {
    const done = (v: boolean): void => { box.remove(); window.removeEventListener('keydown', key, true); resolve(v); };
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    window.addEventListener('keydown', key, true);
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.onclick = () => done(b.dataset.a === 'ok'); });
    // 長い窓でも、上から読めるように（ボタンへ移すときに下まで送らない）
    (box.querySelector<HTMLButtonElement>(o.danger ? '[data-a="no"]' : '[data-a="ok"]'))?.focus({ preventScroll: true });
    box.scrollTop = 0;
  });
}
