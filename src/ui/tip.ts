// 小窓（説明）。data-tip を持つ所に、マウスを重ねると出る。指で触る画面では、1回押すと出る（もう1回押すか、ほかを押すと消える）。
// ボタンのように押すと動く所は、指では押したときの動きが先なので、説明は確認の窓に書く（ここでは出さない）。

let box: HTMLElement | null = null;
let owner: Element | null = null;
let shownAt = 0;

function show(el: Element): void {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  if (!box) {
    box = document.createElement('div');
    box.className = 'tip';
    box.setAttribute('role', 'tooltip');
  }
  box.textContent = text;
  if (!box.isConnected) document.body.appendChild(box);
  owner = el;
  shownAt = performance.now();
  const r = el.getBoundingClientRect(), bw = Math.min(360, window.innerWidth - 16);
  box.style.maxWidth = `${bw}px`;
  const w = box.offsetWidth, h = box.offsetHeight;
  let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  box.style.left = `${x}px`; box.style.top = `${y}px`;
}

export function hideTip(): void { box?.remove(); owner = null; }

let ready = false;
/** 一度だけ呼ぶ。以後は data-tip を付けるだけで説明が出る */
export function initTips(): void {
  if (ready) return;
  ready = true;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el) show(el); else if (owner) hideTip();
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { hideTip(); return; }
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    // 押すと動くもの（ボタンなど）は説明を出さない（確認の窓に説明がある）
    if (el && !el.closest('button, a, input, select, .chip')) { if (owner === el) hideTip(); else show(el); return; }
    hideTip();
  }, { capture: true });
  // 出した直後の送り（重ねたときに欄が動くなど）では消さない
  window.addEventListener('scroll', () => { if (performance.now() - shownAt > 250) hideTip(); }, { capture: true, passive: true });
}
