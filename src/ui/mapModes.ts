// 戦略マップの地図の切り替え（P97）：人口・収入などで領を塗り分ける。
// 他国の領は偵察度で見える量が変わる（領の欄と同じ）。見えない領は「分からない」の灰色にする。
import type { Campaign } from '../strategy/campaign';
import { relation, S } from '../strategy/campaign';
import { scoutOf, scoutTier, type ScoutTier } from '../strategy/scouting';
import type { MapPaint } from '../render/strategyView';

export type MapMode = 'land' | 'pop' | 'income' | 'troops' | 'fort' | 'unrest' | 'scout' | 'diplo';

export const MAP_MODES: { id: MapMode; name: string; tip: string; player?: true }[] = [
  { id: 'land', name: '領地', tip: '勢力の色で塗る（いつもの地図）' },
  { id: 'pop', name: '人口', tip: '領の人口。多いほど濃い緑' },
  { id: 'income', name: '収入', tip: '領の兵糧の収入（本拠・飛び地などの増減の前）。多いほど濃い黄土色' },
  { id: 'troops', name: '兵の数', tip: '領にいる武将の兵の数（守備兵は入れない）。多いほど濃い赤' },
  { id: 'fort', name: '城の固さ', tip: '領の城の固さ。固いほど濃い藍' },
  { id: 'unrest', name: '不穏', tip: '領の不穏（高いと荒れやすい）。高いほど濃い紫。偵察度が高い領だけ分かる' },
  { id: 'scout', name: '偵察度', tip: '他国の領がどれだけ見えているか。濃い青ほどよく見える', player: true },
  { id: 'diplo', name: '外交', tip: '自分の家から見た間柄（同盟・停戦・戦争・中立）', player: true },
];

/** 選べる地図（観戦では、自分の家から見る地図は除く） */
export const mapModesFor = (c: Campaign): typeof MAP_MODES => MAP_MODES.filter((m) => !m.player || c.player);

const RAMPS: Record<string, string[]> = {
  pop: ['#eef3d0', '#c6df95', '#8cbf66', '#4c9246', '#226430'],
  income: ['#fbf0c8', '#f2d179', '#e2a63b', '#bf771e', '#86490e'],
  troops: ['#f8e0d6', '#eeaa90', '#dc6b4f', '#b03a2a', '#761b15'],
  fort: ['#e7eaf0', '#b8c3d4', '#8497b4', '#536890', '#2d3e66'],
  unrest: ['#f0e4f2', '#d5b4dd', '#b07dc1', '#85489c', '#58236e'],
  scout: ['#dfe9f5', '#a8c5e8', '#6a9ed6', '#3972b8', '#1c488a'],
};
export const UNKNOWN = '#77716a';
const DIPLO: Record<string, [string, string]> = {
  self: ['#d9a43a', '自分の家'], ally: ['#4c9a4a', '同盟・主従'], truce: ['#6a9ed6', '停戦'],
  war: ['#c23b2c', '戦争'], neutral: ['#b8ad96', '中立'], none: ['#6e6961', '持ち主なし'],
};

/** 見るのに要る偵察（この段より下は分からない） */
const NEED: Partial<Record<MapMode, ScoutTier>> = { pop: 'names', income: 'names', troops: 'names', fort: 'names', unrest: 'full' };
const RANK: Record<ScoutTier, number> = { none: 0, rough: 1, names: 2, full: 3 };

/** 2桁にまるめる（凡例の区切り） */
const round2 = (n: number): number => {
  if (n < 10) return Math.round(n);
  const d = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / d) * d;
};
const big = (n: number): string => n >= 10000 ? `${round2(n / 1000) / 10}万` : String(Math.round(n));

function value(c: Campaign, mode: MapMode, prov: number): number {
  const p = c.gs.provinces[prov];
  switch (mode) {
    case 'pop': return p.pop;
    case 'income': return p.income;
    case 'troops': return Object.values(c.gs.generals).reduce((s, g) => s + (g.faction && g.prov === prov && g.faction === p.owner ? g.troops.length : 0), 0);
    case 'fort': return p.fort * 100;
    case 'unrest': return p.unrest * 100;
    case 'scout': return scoutOf(c, prov);
    default: return 0;
  }
}
const fmt = (mode: MapMode, v: number): string => mode === 'pop' ? big(v) : mode === 'troops' ? `${Math.round(v)}隊` : mode === 'fort' || mode === 'unrest' ? `${Math.round(v)}%` : String(Math.round(v));

/** 区切り：決まった区切りのある地図はそれを、ほかは見える領の値を5つに等分する（数の多い少ないが分かれて見えるように） */
function breaks(mode: MapMode, vals: number[]): number[] {
  if (mode === 'scout') return [S.scout.rough, S.scout.names, S.scout.full, 100];
  if (mode === 'unrest') return [10, 25, 40, 60];
  if (mode === 'fort') return [20, 40, 60, 80];
  // 0の領（兵のいない領など）が多いと区切りが偏るので、0より大きい値で区切る
  const v = vals.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (const q of [0.2, 0.4, 0.6, 0.8]) {
    const b = round2(v[Math.min(v.length - 1, Math.floor(v.length * q))]);
    if (b > (out.at(-1) ?? 0) && b > v[0]) out.push(b);
  }
  return out;
}

/** 地図の塗り分け。「領地」は null（いつもの地図） */
export function mapPaint(c: Campaign, mode: MapMode): MapPaint | null {
  if (mode === 'land') return null;
  const gs = c.gs, fills = new Map<number, string>(), labels = new Map<number, string>();
  const name = MAP_MODES.find((m) => m.id === mode)!.name;
  if (mode === 'diplo') {
    const seen = new Set<string>();
    for (const p of gs.provinces) {
      if (p.out) continue;
      const k = !p.owner || !gs.factions[p.owner] ? 'none' : relation(c, c.player, p.owner);
      fills.set(p.id, DIPLO[k][0]); seen.add(k);
    }
    return { fills, labels, legend: { title: name, items: Object.entries(DIPLO).filter(([k]) => seen.has(k)).map(([, [color, label]]) => ({ color, label })) } };
  }
  const need = NEED[mode];
  const known: { id: number; v: number; rough: boolean }[] = [];
  let unknown = 0;
  for (const p of gs.provinces) {
    if (p.out) continue;
    const tier = scoutTier(c, p.id);
    if (need && RANK[tier] < RANK[need]) { fills.set(p.id, UNKNOWN); unknown++; continue; }
    known.push({ id: p.id, v: value(c, mode, p.id), rough: tier !== 'full' });
  }
  const br = breaks(mode, known.map((k) => k.v)), ramp = RAMPS[mode];
  // 区切りが少ないときは、色の段を濃いほうへ寄せず、間を空けて使う
  const step = br.length ? (ramp.length - 1) / br.length : 0;
  const bin = (v: number): number => { let i = 0; while (i < br.length && v >= br[i]) i++; return Math.round(i * step); };
  for (const k of known) {
    fills.set(k.id, ramp[bin(k.v)]);
    // 0の札は出さない（偵察していない領・兵のいない領などが多く、地図がうるさくなる。色は一番薄い段）
    if (Math.round(k.v) > 0) labels.set(k.id, `${k.rough && mode !== 'scout' ? '約' : ''}${fmt(mode, k.v)}`);
  }
  const items: { color: string; label: string }[] = [];
  const bounds = [-Infinity, ...br, Infinity];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    const label = mode === 'scout' && hi === Infinity ? '100（自分・同盟）'
      : lo === -Infinity ? `${fmt(mode, hi)}未満` : hi === Infinity ? `${fmt(mode, lo)}以上` : `${fmt(mode, lo)}〜${fmt(mode, hi)}`;
    items.push({ color: ramp[Math.round(i * step)], label });
  }
  if (unknown) items.push({ color: UNKNOWN, label: '分からない（偵察が足りない）' });
  return { fills, labels, legend: { title: name, items } };
}

const KEY = 'hexsim.mapMode';
export function savedMapMode(): MapMode {
  try { const v = localStorage.getItem(KEY); if (v && MAP_MODES.some((m) => m.id === v)) return v as MapMode; } catch { /* 読めなくても既定 */ }
  return 'land';
}
export function saveMapMode(m: MapMode): void {
  try { localStorage.setItem(KEY, m); } catch { /* 書けなくても続ける */ }
}
