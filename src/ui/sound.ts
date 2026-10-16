// 効果音。音声ファイルは使わず、Web Audio API でその場で作る短い音だけを鳴らす。
// ブラウザの決まりで、最初の操作（クリックやキー）があるまでは音を出さない。音量（切・小・大）はブラウザに覚える。

export type SoundId = 'move' | 'hit' | 'crit' | 'miss' | 'bow' | 'tactic' | 'heal' | 'defeat' | 'turn' | 'win' | 'lose'
  // 攻撃のエフェクトに合わせる音：振る、投げる、鉄砲、大筒、着弾、火、水、声、補助、妨害
  | 'swing' | 'throw' | 'gun' | 'cannon' | 'thud' | 'fire' | 'splash' | 'shout' | 'buff' | 'debuff';

/** 音量の段階：切・小・大 */
export const VOLUME_NAME = ['切', '小', '大'];
const GAIN = [0, 0.16, 0.45];
const KEY = 'hexsim.volume';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let unlocked = false;
let listening = false;
let level = loadVolume();
/** 同じ音が重なりすぎないよう、音ごとに最後に鳴らした時刻を覚える */
const lastAt: Partial<Record<SoundId, number>> = {};

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(KEY), v = Number(raw);
    return raw !== null && Number.isInteger(v) && v >= 0 && v < GAIN.length ? v : 1;
  } catch { return 1; }
}

export function volume(): number { return level; }
export function setVolume(v: number): void {
  level = Math.max(0, Math.min(GAIN.length - 1, Math.round(v)));
  try { localStorage.setItem(KEY, String(level)); } catch { /* 保存できなくても動く */ }
  if (master && ctx) master.gain.setValueAtTime(GAIN[level], ctx.currentTime);
}

function unlock(): void {
  unlocked = true;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = GAIN[level];
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; /* 音が出せない環境でも動く */ }
}

/** 最初の操作を待つ。何度呼んでもよい */
export function initSound(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('pointerdown', unlock, { capture: true });
  // iPhone・iPad は、指を離したときの操作でないと音を出せるようにならない
  window.addEventListener('touchend', unlock, { capture: true });
  window.addEventListener('click', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

/** 音程が動く1音。f0 → f1（Hz）、長さ dur（秒） */
function tone(type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number): void {
  const o = ctx!.createOscillator(), g = ctx!.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(master!);
  o.start(at); o.stop(at + dur + 0.02);
}

/** ざらついた音（打撃や風切り）。freq のあたりだけを通す */
function noise(kind: BiquadFilterType, freq: number, at: number, dur: number, vol: number): void {
  const c = ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    // 音の中身だけの乱数。ゲームの進行には関わらない
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf;
  f.type = kind; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f); f.connect(g); g.connect(master!);
  s.start(at); s.stop(at + dur + 0.02);
}

/** 音を鳴らす。delayMs だけ遅らせられる（演出の当たる瞬間に合わせる） */
export function play(id: SoundId, delayMs = 0): void {
  if (!unlocked || !ctx || !master || level === 0 || ctx.state !== 'running') return;
  const at = ctx.currentTime + Math.max(0, delayMs) / 1000;
  const last = lastAt[id];
  if (last !== undefined && Math.abs(at - last) < 0.05) return;
  lastAt[id] = at;
  switch (id) {
    case 'move': noise('lowpass', 420, at, 0.07, 0.5); tone('sine', 170, 110, at, 0.07, 0.35); break;
    case 'hit': noise('bandpass', 900, at, 0.1, 0.9); tone('square', 150, 70, at, 0.1, 0.3); break;
    case 'crit': noise('bandpass', 1200, at, 0.14, 1); tone('square', 190, 60, at, 0.14, 0.35); tone('triangle', 880, 1480, at + 0.02, 0.18, 0.4); break;
    case 'miss': noise('highpass', 2400, at, 0.13, 0.22); break;
    case 'bow': tone('triangle', 820, 260, at, 0.12, 0.4); noise('highpass', 3000, at + 0.03, 0.1, 0.16); break;
    case 'swing': noise('bandpass', 1800, at, 0.09, 0.3); break;
    case 'throw': noise('bandpass', 700, at, 0.16, 0.3); tone('sine', 300, 180, at, 0.14, 0.15); break;
    case 'gun': noise('highpass', 1500, at, 0.05, 1); noise('lowpass', 700, at + 0.01, 0.16, 0.8); tone('square', 120, 45, at, 0.09, 0.4); break;
    case 'cannon': noise('lowpass', 260, at, 0.42, 1); tone('sine', 95, 32, at, 0.4, 0.8); noise('highpass', 1200, at, 0.05, 0.5); break;
    case 'thud': noise('lowpass', 220, at, 0.2, 0.9); tone('sine', 110, 50, at, 0.16, 0.5); break;
    case 'fire': noise('bandpass', 600, at, 0.34, 0.5); noise('highpass', 2600, at + 0.05, 0.28, 0.18); tone('sawtooth', 90, 140, at, 0.3, 0.12); break;
    case 'splash': noise('bandpass', 1400, at, 0.3, 0.45); noise('lowpass', 500, at, 0.22, 0.4); break;
    case 'shout': tone('sawtooth', 150, 210, at, 0.3, 0.28); tone('sawtooth', 226, 300, at + 0.03, 0.28, 0.2); noise('bandpass', 800, at, 0.3, 0.15); break;
    case 'buff': tone('triangle', 520, 520, at, 0.1, 0.35); tone('triangle', 780, 790, at + 0.08, 0.2, 0.35); break;
    case 'debuff': tone('triangle', 420, 300, at, 0.16, 0.35); tone('sine', 250, 170, at + 0.1, 0.24, 0.35); break;
    case 'tactic': tone('triangle', 440, 440, at, 0.14, 0.4); tone('triangle', 660, 660, at + 0.09, 0.2, 0.4); noise('bandpass', 500, at, 0.25, 0.2); break;
    case 'heal': tone('sine', 620, 940, at, 0.22, 0.4); break;
    case 'defeat': tone('sawtooth', 230, 55, at, 0.38, 0.3); noise('lowpass', 300, at, 0.3, 0.5); break;
    case 'turn': tone('triangle', 620, 600, at, 0.06, 0.5); tone('triangle', 830, 800, at + 0.11, 0.09, 0.5); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, at + i * 0.12, i === 3 ? 0.5 : 0.16, 0.45)); break;
    case 'lose': [440, 349, 294].forEach((f, i) => tone('triangle', f, f * 0.97, at + i * 0.2, i === 2 ? 0.6 : 0.24, 0.42)); break;
  }
}
