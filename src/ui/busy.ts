// 時間のかかる処理のあいだ、「◎◎中…」の表示を出す。
// 決まり：どの操作でも、何の反応もない時間は0.2秒以内にする。重い処理は、まず表示を出して画面に描かせてから始める。
// （同期の重い処理をクリックの中でそのまま走らせると、終わるまで画面が固まり、押せたのかどうかも分からない）

let depth = 0;
let box: HTMLElement | null = null;

function show(label: string): void {
  if (!box) {
    box = document.createElement('div');
    box.className = 'busy';
    box.setAttribute('role', 'status');
    box.innerHTML = '<div><i></i><span></span></div>';
  }
  box.querySelector('span')!.textContent = label;
  if (!box.isConnected) document.body.appendChild(box);
}

/** 画面が1回描かれるのを待つ（タブが裏にあって描画が止まっているときも、少し待てば進む） */
function painted(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = (): void => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    window.setTimeout(go, 120);
  });
}

/** いま表示が出ているか（重ねて押されたときに、二重に走らせないために見る） */
export const isBusy = (): boolean => depth > 0;

/**
 * 表示を出してから work を走らせ、終わったら消す。work の中からさらに呼んでもよい（表示の文字だけ替わる）。
 * 表示が出ているあいだは、下の画面は押せない。
 */
export async function busy<T>(label: string, work: () => T | Promise<T>): Promise<T> {
  depth++;
  show(label);
  try {
    await painted();
    return await work();
  } finally {
    depth--;
    if (depth === 0) box?.remove();
  }
}

/** 画面の下に、短い知らせを数秒出す（ブラウザの確認窓の代わり） */
export function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3200);
}