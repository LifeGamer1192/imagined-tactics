// 味方のおまかせの方針（P50）を覚えておく。前の設定をブラウザに残し、国モードではセーブにも残す（Campaign.autoPlan）。
// 戦闘画面と戦略の画面のどちらで切り替えても、同じ設定になる。

import { DEFAULT_PLAN, PLAN_AXES, PLAN_LABEL, PLAN_TIP, validPlan, type AutoPlan, type PlanAxis } from '../ai/personality';

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/**
 * 方針を選ぶボタン（P104）：5段階の軸（攻め・策・密集・統制・包囲）は 1〜5 のボタン、狙いは3つから選ぶ。押すとすぐ切り替わる
 */
export function planPickerHtml(p: AutoPlan): string {
  const lv = (k: PlanAxis) => { const a = PLAN_AXES[k]; return `<div class="prow"><span class="pname" data-tip="${esc(`${a.name}：${a.tip}`)}">${a.name}</span><span class="pend">${a.low}</span><span class="pgrp lv">${[1, 2, 3, 4, 5].map((v) =>
    `<button data-plan="${k}:${v}" class="${p[k] === v ? 'on' : ''}" data-tip="${esc(`${a.name} ${v}（1：${a.low}〜5：${a.high}）\n${a.tip}`)}">${v}</button>`).join('')}</span><span class="pend">${a.high}</span></div>`; };
  const aim = `<div class="prow"><span class="pname">狙い</span><span class="pgrp">${(Object.keys(PLAN_LABEL.aim) as AutoPlan['aim'][]).map((v) =>
    `<button data-plan="aim:${v}" class="${p.aim === v ? 'on' : ''}" data-tip="${esc(`${PLAN_LABEL.aim[v]}：${PLAN_TIP.aim[v]}`)}">${PLAN_LABEL.aim[v]}</button>`).join('')}</span></div>`;
  return `<div class="plan"><span class="dim" data-tip="${esc('味方をおまかせで動かすとき（観戦・おまかせで決着・一部だけおまかせ・戦略のおまかせ）の動き方。武将の性格ではなく、ここで選んだ方針で動きます。敵は武将の性格で動きます。セーブにも残ります')}">おまかせの方針</span>${lv('push')}${aim}${lv('mind')}${lv('tight')}${lv('command')}${lv('envelop')}</div>`;
}

/** 方針のボタンを押せるようにする */
export function wirePlanPicker(root: ParentNode, changed: (p: AutoPlan) => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((b) => {
    b.onclick = () => {
      const [k, v] = b.dataset.plan!.split(':');
      const p = { ...getPlan(), [k]: k === 'aim' ? v : Number(v) } as AutoPlan;
      setPlan(p);
      changed(getPlan());
    };
  });
}

const KEY = 'hexsim.autoPlan';
let current: AutoPlan | null = null;
/** 国モードのとき：切り替えたらセーブ側にも書く */
let sink: ((p: AutoPlan) => void) | null = null;

export function getPlan(): AutoPlan {
  if (current) return current;
  try { current = validPlan(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { current = { ...DEFAULT_PLAN }; }
  return current;
}

export function setPlan(p: AutoPlan): void {
  current = validPlan(p);
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* 覚えられなくても動く */ }
  sink?.(current);
}

/** 国モードを始めたとき：セーブにある方針を使い（無ければ前の設定）、切り替えたらセーブにも書く */
export function bindPlan(saved: AutoPlan | undefined, write: (p: AutoPlan) => void): AutoPlan {
  sink = null;
  if (saved) setPlan(saved);
  sink = write;
  const p = getPlan();
  write(p);
  return p;
}
