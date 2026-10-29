// 名将（P102）：特定の将に 天佑・特別技・特別軍略 を割り当てる。データは data/system/heroes.json（hex-sim だけ）。
// 名簿（世界と記録の名前で名指し）に載る将はそのまま。名簿に無い将は、名声が全体の上位なら、縁と特性で天佑を選ぶ（特別技・特別軍略は無し）。
// 人物を作るのではなく、いる人物に力を付けるだけ。

import heroesJson from '../../data/system/heroes.json';
import type { Loc } from '../data/types';
import type { GameStart, GGeneral } from './model';

export type BoonCond =
  | { type: 'defense' | 'attack' | 'higherFoe' | 'lordFoe' | 'castle' | 'field' | 'outnumbered' | 'night' | 'rain' }
  | { type: 'tieFoe'; kinds: string[] };
export interface BoonMods { atkPct?: number; defPct?: number; move?: number; hit?: number; evade?: number }
export interface BoonDef {
  name: Loc;
  story: string;
  cond: BoonCond[];
  ally?: BoonMods;
  enemy?: BoonMods;
  opening?: { kind: 'damage'; power: number; fx: string } | { kind: 'daze'; chance: number; fx: string } | { kind: 'heal'; power: number; fx: string };
}
interface HeroData {
  boons: Record<string, BoonDef>;
  people: { scenario: string; name: string; boon?: string; skill?: string; tactic?: string }[];
  auto: { topPct: number; minFame: number; byTie: [string, string][]; byTrait: [string, string][]; default: string };
}
export const HEROES = heroesJson as unknown as HeroData;
export const BOONS = HEROES.boons;

/** 割り当ての版。決まりを変えたら上げる（読み込みのときに割り当て直す） */
export const HERO_VERSION = 1;

/** 名声の線：これ以上の将に、自動で天佑を付ける（全体の上位 topPct、かつ minFame 以上） */
function fameLine(gs: GameStart): number {
  const f = Object.values(gs.generals).map((g) => g.fame).sort((a, b) => b - a);
  const k = Math.max(0, Math.ceil(f.length * HEROES.auto.topPct) - 1);
  return Math.max(HEROES.auto.minFame, f[k] ?? Infinity);
}

/** 1人の将の名将の力（無ければ undefined） */
function heroFor(gs: GameStart, g: GGeneral, line: number): GGeneral['hero'] {
  const name = g.recordName ?? g.name.ja;
  const p = HEROES.people.find((x) => x.scenario === gs.scenario && x.name === name);
  // 同じ名前の別人がいれば、名簿に当たるのは名声のいちばん高い1人だけ（ほかは自動の決まりで）
  const same = p ? Object.values(gs.generals).filter((o) => (o.recordName ?? o.name.ja) === name).sort((a, b) => b.fame - a.fame || a.id.localeCompare(b.id)) : [];
  if (p && same[0] === g) return { ...(p.boon ? { boon: p.boon } : {}), ...(p.skill ? { skill: p.skill } : {}), ...(p.tactic ? { tactic: p.tactic } : {}) };
  if (g.fame < line) return undefined;
  const A = HEROES.auto;
  const byTie = A.byTie.find(([k]) => (g.ties ?? []).some((t) => t.kind === k));
  const byTrait = A.byTrait.find(([t]) => g.traits.includes(t));
  return { boon: (byTie ?? byTrait)?.[1] ?? A.default };
}

/** 世界の将みなに割り当てる（まだなら。もう割り当てた将は変えない） */
export function assignHeroes(gs: GameStart): void {
  if ((gs.heroes ?? 0) >= HERO_VERSION) return;
  const line = fameLine(gs);
  for (const g of Object.values(gs.generals)) if (!g.hero) { const h = heroFor(gs, g, line); if (h) g.hero = h; }
  gs.heroes = HERO_VERSION;
}

/** あとから加わった将（元服など）に割り当てる */
export function assignHero(gs: GameStart, g: GGeneral): void {
  if (g.hero) return;
  const h = heroFor(gs, g, fameLine(gs));
  if (h) g.hero = h;
}
