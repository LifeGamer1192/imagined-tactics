// ゲーム開始データの武将と兵から、戦闘の初期状態を作る。

import type { GGeneral, GameStart } from '../convert/model';
import { AI, personalityOf, type AiLevel } from '../ai/personality';
import { RNG, codeToSeed } from '../core/rng';
import { D, L } from '../data/db';
import { classMod } from '../rules/growth';
import { stepCost } from '../rules/move';
import { applyTraitMods, traitMods, withoutOldTraitPassives } from '../rules/traits';
import { BM, type BattleMap } from './map';
import type { BUnit, BattleState, Side } from './types';
import { skyFor, type Sky } from './weather';

export const MAX_GENERALS = 3;
/** 戦闘の長さの上限（巡）。過ぎたら守り手の勝ち */
export const MAX_ROUNDS = 20;

function blank(id: number, side: Side): Pick<BUnit, 'id' | 'side' | 'home' | 'statuses' | 'moveSpent' | 'moved' | 'postMoved' | 'acted' | 'extraUsed' | 'alive' | 'retreated' | 'expGained' | 'pos'> {
  return { id, side, home: side, statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0, pos: -1 };
}

export function generalUnit(g: GGeneral, id: number, side: Side): BUnit {
  const c = D.byClass[g.classId], m = classMod(c);
  const hp = g.stats.hp + m.hp, mp = g.stats.mp + m.mp;
  return {
    ...blank(id, side), kind: 'general', generalId: g.id, leader: id, troopIndex: -1, defId: c.id,
    name: g.name.ja, level: g.level, hp, maxHp: hp, mp, maxMp: mp,
    str: g.stats.str + m.str, int: g.stats.int + m.int, agi: g.stats.agi + m.agi, def: c.def,
    // 兵から取り立てた武将（P59）：もとの兵種の得意地形のまま。技は、引き継いだ技を通常攻撃の前に置く（弓の兵は弓で反撃する）
    move: c.move, affinity: g.unit && D.byUnit[g.unit] ? D.byUnit[g.unit].affinity : c.affinity, commandRange: g.commandRange,
    // 特性の特技・回復・会心は、戦場で特性から付ける（P56。前の版で変換のときに付けたものは外す）
    passives: withoutOldTraitPassives(g.passives, g.traits), skills: [...new Set([...(g.skills ?? []), `atk:${c.id}`])], tactics: [...new Set([...c.tactics, ...g.learned])],
    critPct: 0, healPct: 0, persona: personalityOf(g.traits, g.ab),
  };
}

export function troopUnits(g: GGeneral, firstId: number, leader: number, side: Side): BUnit[] {
  return g.troops.map((t, i) => {
    const u = D.byUnit[t.unitId];
    return {
      ...blank(firstId + i, side), kind: 'troop' as const, generalId: g.id, leader, troopIndex: i, defId: u.id,
      name: t.name ?? L(u.name), level: t.level, hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp,
      str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: u.def,
      move: u.move, affinity: u.affinity, commandRange: 0,
      // 武将から下げた兵（P59）：引き継いだ技・軍略も使える
      passives: [...u.passives], skills: [...new Set([...u.skills, ...(t.extraSkills ?? [])])], tactics: [...new Set([...u.tactics, ...(t.extraTactics ?? [])])],
      critPct: 0, healPct: 0,
    };
  });
}

/**
 * 戦闘を作る。sides[0] が攻め手、sides[1] が守り手（武将の id、それぞれ最大3人）。
 * 天気は、月と種から決まる（同じ種なら同じ天気）。sky を渡すと、その天気にする。
 */
export function createBattle(gs: GameStart, map: BattleMap, sides: [string[], string[]], seed = 'battle', sideNames: [string, string] = ['攻め手', '守り手'], maxRounds = MAX_ROUNDS, sky?: Partial<Sky>): BattleState {
  const code = `${gs.seed}:${gs.tick}:${seed}`;
  // 古いデータで月が無くても動くよう、無ければ春（4月）として扱う
  const auto = skyFor(gs.month ?? 4, code);
  const weather = sky?.weather ?? auto.weather;
  // 造りは戦いの中で壊れて地形が変わるので、地形は写して使う（同じマップを次の戦いに使っても元のまま）
  map = { ...map, terrain: [...map.terrain] };
  const structures: NonNullable<BattleState['structures']> = {};
  map.terrain.forEach((k, i) => {
    const s = k === 'gate' || k === 'fortgate' || k === 'palisade' ? BM.structures[k] : undefined;
    if (s) structures[i] = { kind: k, hp: s.hp, max: s.hp, def: s.def, closed: s.closed, rubble: s.rubble };
  });
  const st: BattleState = {
    // 雪の日は足が遅くなるぶん、戦いの上限を少し延ばす（攻め手が時間切れで負けやすくなりすぎないように）
    map, units: [], turn: 0, round: 1, maxRounds: maxRounds + (weather === 'snow' ? D.combat.weather.snowExtraRounds : 0), winner: null,
    rng: new RNG(codeToSeed(code)), log: [], sideNames,
    weather, night: sky?.night ?? auto.night,
    // 城の戦場：攻め手は天守を押さえ続ければ勝ち
    ...(map.seat !== undefined && map.holdTurns ? { hold: { cell: map.seat, need: map.holdTurns, count: 0 } } : {}),
    ...(Object.keys(structures).length ? { structures, mapVersion: 0 } : {}),
  };
  const g = map.grid;
  const taken = new Set<number>();
  const free = (u: BUnit, i: number) => !taken.has(i) && stepCost({ ...st, units: [] } as BattleState, u, i) !== null && map.terrain[i] !== 'water' && map.terrain[i] !== 'wall';
  const nearest = (u: BUnit, from: number, pool: number[]): number => {
    let best = -1, bestD = Infinity;
    for (const i of pool) {
      if (!free(u, i)) continue;
      const d = g.distance(from, i);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const all = Array.from({ length: g.n }, (_, i) => i);
  for (const side of [0, 1] as Side[]) {
    const ids = sides[side].slice(0, MAX_GENERALS);
    ids.forEach((gid, k) => {
      const gen = gs.generals[gid];
      const leader = generalUnit(gen, st.units.length, side);
      // 特性の効き目（P56）：将と、配下のすべての兵に当てる
      const mods = traitMods(gen.traits);
      applyTraitMods(leader, mods, gen.traits);
      const zone = map.spawn[side];
      let anchor: number;
      if (map.depth && map.lateral && zone.length) {
        // 六角形の盤：配置場所の、辺から1つ内側の深さで、武将どうしを横に散らす
        const dep = map.depth, lat = map.lateral;
        const edgeD = side === 0 ? Math.min(...zone.map((i) => dep[i])) : Math.max(...zone.map((i) => dep[i]));
        const row = zone.filter((i) => dep[i] === edgeD + (side === 0 ? 1 : -1)).sort((a, b) => lat[a] - lat[b]);
        const pool = row.length ? row : zone.slice().sort((a, b) => lat[a] - lat[b]);
        anchor = pool[Math.min(pool.length - 1, Math.floor((k + 1) * pool.length / (ids.length + 1)))];
      } else {
        // 文字で書いたマップ：配置場所の側の、内から2列目
        const zc = zone.length ? zone.reduce((s, i) => s + g.col(i), 0) / zone.length : (side === 0 ? 1 : g.w - 2);
        anchor = g.idx(zc < g.w / 2 ? 1 : g.w - 2, Math.min(g.h - 1, Math.round((k + 1) * g.h / (ids.length + 1))));
      }
      let pos = nearest(leader, anchor, map.spawn[side]);
      if (pos < 0) pos = nearest(leader, anchor, all);
      leader.pos = pos; taken.add(pos);
      st.units.push(leader);
      for (const t of troopUnits(gen, st.units.length, leader.id, side)) {
        // 兵は武将のそばに置く。水上が得意な兵でも、開始時は陸に置く
        let p = nearest(t, leader.pos, map.spawn[side]);
        if (p < 0 || g.distance(p, leader.pos) > 3) { const q = nearest(t, leader.pos, all); if (q >= 0) p = q; }
        if (p < 0) continue;
        t.id = st.units.length; t.pos = p; taken.add(p);
        applyTraitMods(t, mods, gen.traits);
        st.units.push(t);
      }
    });
  }
  return st;
}

/** 難しさの名前（駒の能力の変化の原因に書く） */
const LEVEL_NAME: Record<AiLevel, string> = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい', veryHard: '非常に難しい', oni: '鬼' };

/**
 * 戦闘の難しさを決める（P64）。相手の陣営の思考の賢さが変わり、非常に難しい・鬼では相手の駒の体力・武力・知略も上がる。
 * 上がったぶんは、特性と同じく駒の「能力の変化」に原因（難しさ）と値を書く
 */
export function setAiLevel(st: BattleState, side: Side, level: AiLevel): void {
  st.aiLevel = { side, level };
  const m = AI.levels[level]?.statMult ?? 1;
  if (m === 1) return;
  const why = `難しさ（${LEVEL_NAME[level]}）`, value = `${m > 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;
  for (const u of st.units) {
    if (u.side !== side) continue;
    const fx = (u.traitFx ??= []);
    const up = (stat: 'str' | 'int'): void => { const from = u[stat]; u[stat] = Math.max(1, Math.round(from * m)); fx.push({ stat, from, to: u[stat], value, traits: [], why }); };
    const from = u.maxHp;
    u.maxHp = Math.max(1, Math.round(u.maxHp * m)); u.hp = Math.min(u.maxHp, Math.round(u.hp * m));
    fx.push({ stat: 'hp', from, to: u.maxHp, value, traits: [], why });
    up('str'); up('int');
  }
}
