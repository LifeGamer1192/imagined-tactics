// 背景の曲（public/audio/bgm）。場面ごとに曲を決めておくと、切り替えのときは前の曲を薄めてから次の曲を流す。
// ブラウザの決まりで、最初の操作があるまでは鳴らさない（決めておいた曲は、最初の操作のあとで鳴り始める）。
// 音量は Web Audio の音量つまみで変える（iPhone・iPad は audio 要素の音量を変えられないため）。音量（切・小・中・大）はブラウザに覚える。

export const BGM_LEVEL_NAME = ['切', '小', '中', '大'];
const GAIN = [0, 0.22, 0.45, 0.75];
const KEY = 'hexsim.bgm';
const FADE = 0.7;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let level = loadLevel();
/** いま流すことになっている曲（繰り返す曲） */
let want: string | null = null;
let current: { name: string; el: HTMLAudioElement; gain: GainNode } | null = null;

function loadLevel(): number {
  try {
    const raw = localStorage.getItem(KEY), v = Number(raw);
    return raw !== null && Number.isInteger(v) && v >= 0 && v < GAIN.length ? v : 1;
  } catch { return 1; }
}

export const bgmLevel = (): number => level;

export function setBgmLevel(v: number): void {
  level = Math.max(0, Math.min(GAIN.length - 1, Math.round(v)));
  try { localStorage.setItem(KEY, String(level)); } catch { /* 保存できなくても動く */ }
  if (master && ctx) master.gain.setTargetAtTime(GAIN[level], ctx.currentTime, 0.1);
  if (level === 0) stopCurrent(); else if (want && current?.name !== want) start(want);
}

const url = (name: string): string => `${import.meta.env.BASE_URL ?? './'}audio/bgm/${name}.mp3`;

function ensure(): boolean {
  if (ctx) return true;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = GAIN[level];
    master.connect(ctx.destination);
    return true;
  } catch { ctx = null; return false; }
}

/** 曲を1つ鳴らし始める（音量0から薄く上げる）。loop でなければ1回で終わる */
function voice(name: string, loop: boolean): { name: string; el: HTMLAudioElement; gain: GainNode } | null {
  if (!ensure() || !ctx || !master) return null;
  const el = new Audio(url(name));
  el.loop = loop;
  el.preload = 'auto';
  const gain = ctx.createGain();
  gain.gain.value = 0;
  try { ctx.createMediaElementSource(el).connect(gain); } catch { return null; }
  gain.connect(master);
  gain.gain.setTargetAtTime(1, ctx.currentTime, FADE / 3);
  if (ctx.state === 'suspended') void ctx.resume();
  void el.play().catch(() => { /* 読めない・止められたときは鳴らさない */ });
  return { name, el, gain };
}

function fadeOut(v: { el: HTMLAudioElement; gain: GainNode }): void {
  if (!ctx) { v.el.pause(); return; }
  v.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE / 3);
  window.setTimeout(() => { v.el.pause(); v.el.src = ''; v.gain.disconnect(); }, FADE * 1000 + 200);
}

function stopCurrent(): void {
  if (current) fadeOut(current);
  current = null;
}

function start(name: string): void {
  stopCurrent();
  if (!unlocked || level === 0) return;
  current = voice(name, true);
}

/** この場面で流す曲を決める（null なら止める）。同じ曲なら何もしない */
export function bgm(name: string | null): void {
  want = name;
  if (current?.name === name) return;
  if (!name) { stopCurrent(); return; }
  start(name);
}

/** 短い曲を1回だけ鳴らす（勝ち・負け）。繰り返しの曲は止める。鳴らせたら true */
export function jingle(name: string): boolean {
  want = null;
  stopCurrent();
  if (!unlocked || level === 0) return false;
  current = voice(name, false);
  return !!current;
}

function unlock(): void {
  if (unlocked) { if (ctx?.state === 'suspended') void ctx.resume(); return; }
  unlocked = true;
  if (want && level > 0 && !current) start(want);
}

let listening = false;
/** 最初の操作を待つ。何度呼んでもよい */
export function initBgm(): void {
  if (listening) return;
  listening = true;
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true });
  // 裏に回ったら止め、戻ったら続ける
  document.addEventListener('visibilitychange', () => {
    if (!current) return;
    if (document.hidden) current.el.pause(); else if (current.el.loop) void current.el.play().catch(() => {});
  });
}
