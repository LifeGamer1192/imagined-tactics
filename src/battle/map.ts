// 戦場マップ。文字で書いたマップの読み込みと、hist-sim の領の地形からの自動生成。

import battlemapJson from '../../data/system/battlemap.json';
import convertJson from '../../data/system/convert.json';
import { buildingsOf, type HWorld } from '../bridge/histsim';
import { HexGrid } from '../core/hex';
import { RNG, codeToSeed } from '../core/rng';
import type { TerrainKind } from '../data/types';

export interface BattleMap {
  grid: HexGrid;
  terrain: TerrainKind[];
  name: string;
  /** 配置できるマス：[攻め手, 守り手] */
  spawn: [number[], number[]];
  /** 城壁のある戦場か（敵の思考が、門を通る道のりで距離を測る） */
  siege?: boolean;
  /** 領から作った戦場の目立つもの（城・城壁・町・寺・市・港など）。説明に出す */
  features?: string[];
}

const LEGEND: Record<string, TerrainKind> = {
  '.': 'plain', '=': 'road', 'B': 'bridge', 'T': 'forest', '^': 'mountain', ',': 'swamp',
  '~': 'water', 'C': 'castle', 'W': 'town', '#': 'cliff',
  'A': 'camp', 'F': 'fort', 'P': 'paddy', 'H': 'wall', 'G': 'gate', 'Y': 'tower',
};
export const TERRAIN_CHAR: Record<TerrainKind, string> = Object.fromEntries(Object.entries(LEGEND).map(([k, v]) => [v, k])) as Record<TerrainKind, string>;

function spawnZones(grid: HexGrid, terrain: TerrainKind[]): [number[], number[]] {
  const zone = (cols: number[]) => {
    const out: number[] = [];
    for (const c of cols) for (let r = 0; r < grid.h; r++) {
      const i = grid.idx(c, r);
      if (terrain[i] !== 'water' && terrain[i] !== 'cliff' && terrain[i] !== 'wall' && terrain[i] !== 'tower') out.push(i);
    }
    return out;
  };
  return [zone([0, 1, 2]), zone([grid.w - 1, grid.w - 2, grid.w - 3])];
}

/**
 * 文字のマップ（1文字＝1マス、空白は無視）。
 * 凡例：. 草原  = 道  B 橋  T 森  ^ 山  , 湿地  ~ 川  C 城  W 街  # 段差  A 陣  F 砦  P 棚田  H 城壁  G 門  Y 櫓
 */
export function parseMap(text: string, name = '戦場'): BattleMap {
  const rows = text.split('\n').map((l) => l.replace(/\s+/g, '')).filter((l) => l.length);
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const grid = new HexGrid(w, h);
  const terrain: TerrainKind[] = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const k = LEGEND[rows[r][c] ?? '.'];
    if (!k) throw new Error(`マップに使えない文字です：${rows[r][c]}`);
    terrain.push(k);
  }
  return { grid, terrain, name, spawn: spawnZones(grid, terrain), siege: terrain.includes('wall') };
}

export function mapToText(m: BattleMap): string {
  const out: string[] = [];
  for (let r = 0; r < m.grid.h; r++) {
    let line = '';
    for (let c = 0; c < m.grid.w; c++) line += TERRAIN_CHAR[m.terrain[m.grid.idx(c, r)]];
    out.push(line);
  }
  return out.join('\n');
}

// hist-sim の地形（Biome）
const WATER = new Set([0, 1]);
const FOREST = new Set([4, 5, 7, 8, 9]);
const B_WETLAND = 12, B_MOUNTAIN = 14;
const HIGH = 0.62;
const PER_POP = (convertJson as unknown as { supply: { perPop: number } }).supply.perPop;

export const MAP_W = 15, MAP_H = 11;

/** 戦場の作り方と普請の調整値（data/system/battlemap.json） */
export const BM = battlemapJson as unknown as {
  fort: { fort: number; castle: number; siege: number; outworks: number };
  town: { village: number; town: number; city: number; villageTiles: number; townTiles: number; cityTiles: number };
  paddy: { byIncome: number[]; aqueduct: number; unrest: number };
  road: { secondIncome: number };
  unrest: { from: number; swamp: number; forest: number };
  buildings: Record<string, { name: string; text: string; income?: number; coastal?: boolean }>;
  build: { costs: Record<string, number>; fortStep: number; fortMax: number; fortCostBase: number; fortCostPerFort: number; aiChance: number; aiSupplyMonths: number };
};

/** 戦場の形を決める、領の今のようす。省いた項目は hist-sim の世界の値を使う */
export interface ProvinceLook {
  /** 守り手の本拠か（城になる） */
  capital?: boolean;
  /** 城壁で囲むか（buildings に walls があっても囲む） */
  walls?: boolean;
  /** 城の強さ（0〜1） */
  fort?: number;
  buildings?: string[];
  pop?: number;
  income?: number;
  /** 不穏（0〜1） */
  unrest?: number;
  coastal?: boolean;
  river?: boolean;
}

function lookOf(w: HWorld, id: number, o: ProvinceLook): Required<ProvinceLook> {
  const ps = w.ps, p = w.provinces[id];
  const buildings = o.buildings ?? buildingsOf(ps.buildings[id] ?? 0);
  const pop = o.pop ?? ps.pop[id] ?? 0;
  return {
    capital: !!o.capital, walls: !!o.walls || buildings.includes('walls'), fort: o.fort ?? ps.fort[id] ?? 0, buildings, pop,
    income: o.income ?? pop * (ps.prosperity[id] ?? 0.5) * (1 - (ps.devastation[id] ?? 0)) * PER_POP,
    unrest: o.unrest ?? ps.unrest[id] ?? 0, coastal: o.coastal ?? !!p.coastal, river: o.river ?? !!p.river,
  };
}

/**
 * 領から戦場マップを作る。同じ領・同じようすからは、いつも同じマップになる。
 * 1. 地形：領の範囲にヘックスを敷き、各マスに一番近いセルの地形を当てる。海沿いなら海、大河があれば川が必ず入る。
 * 2. 領のようす：人口で城下の街、収入で棚田と脇街道、不穏で荒れ地（湿地・藪）、城の強さで陣・砦・城・城壁と出丸。
 * 3. 建物：寺・修道院は砦、市は町場、港は桟橋、鉱山は掘り跡、用水は水路と棚田、兵糧蔵は陣、書庫・学問所は街。
 * 建物ごとに別の乱数を使うので、建物が増えても、ほかの所の形は変わらない。
 */
export function mapFromProvince(w: HWorld, provId: number, opts: ProvinceLook = {}): BattleMap {
  const p = w.provinces[provId];
  const look = lookOf(w, provId, opts);
  const m = w.map;
  const grid = new HexGrid(MAP_W, MAP_H);
  const has = (b: string) => look.buildings.includes(b);
  const R = (k: string) => new RNG(codeToSeed(`${w.seed}:map:${provId}:${k}`));
  const features: string[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of p.cells) {
    x0 = Math.min(x0, m.x[c]); x1 = Math.max(x1, m.x[c]);
    y0 = Math.min(y0, m.y[c]); y1 = Math.max(y1, m.y[c]);
  }
  // 小さな領でも周りの地形が入るよう、少し広げる
  const padX = Math.max((x1 - x0) * 0.15, 20), padY = Math.max((y1 - y0) * 0.15, 20);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const cand: number[] = [];
  for (let i = 0; i < m.n; i++) if (m.x[i] >= x0 - 30 && m.x[i] <= x1 + 30 && m.y[i] >= y0 - 30 && m.y[i] <= y1 + 30) cand.push(i);
  const riverMin = m.riverMin ?? Infinity;
  const kindOf = (cell: number): TerrainKind => {
    const b = m.biome[cell];
    if (WATER.has(b) || m.water[cell]) return 'water';
    if (m.flux[cell] >= riverMin) return 'water';
    if (b === B_MOUNTAIN || m.height[cell] > HIGH) return 'mountain';
    if (b === B_WETLAND) return 'swamp';
    if (FOREST.has(b)) return 'forest';
    return 'plain';
  };
  const terrain: TerrainKind[] = [];
  for (let i = 0; i < grid.n; i++) {
    const fx = x0 + (x1 - x0) * (grid.col(i) + 0.5) / grid.w;
    const fy = y0 + (y1 - y0) * (grid.row(i) + 0.5 * (grid.col(i) & 1) + 0.5) / (grid.h + 0.5);
    let best = cand[0] ?? p.seat, bestD = Infinity;
    for (const c of cand) {
      const d = (m.x[c] - fx) ** 2 + (m.y[c] - fy) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    terrain.push(kindOf(best));
  }
  // 細部のゆらぎ：平地に少しだけ森を混ぜる（同じ領なら同じ結果）
  const rng = new RNG(codeToSeed(`${w.seed}:map:${provId}`));
  for (let i = 0; i < grid.n; i++) if (terrain[i] === 'plain' && rng.chance(0.06)) terrain[i] = 'forest';

  const mid = Math.floor(grid.h / 2);
  const at = (c: number, r: number) => grid.idx(c, r);
  /** 両軍の配置場所と守り手の拠点のあいだ（まん中の列） */
  const inMid = (i: number) => grid.col(i) >= 3 && grid.col(i) <= grid.w - 6;
  const OPEN = new Set<TerrainKind>(['plain', 'forest', 'paddy', 'swamp']);

  // 海：海沿いの領で、戦場に水が無ければ、上か下の端を海にする
  if (look.coastal && !terrain.includes('water')) {
    const r = R('sea').chance(0.5) ? 0 : grid.h - 1;
    for (let c = 0; c < grid.w; c++) terrain[at(c, r)] = 'water';
  }
  // 川：大河の流れる領で、戦場のまん中に水が無ければ、縦に川を通す（街道は橋で渡る）
  if (look.river && !terrain.some((k, i) => k === 'water' && inMid(i) && grid.row(i) > 0 && grid.row(i) < grid.h - 1)) {
    const rr = R('river');
    let c = rr.int(5, grid.w - 8);
    for (let r = 0; r < grid.h; r++) {
      terrain[at(c, r)] = 'water';
      if (rr.chance(0.35)) c = Math.max(4, Math.min(grid.w - 7, c + (rr.chance(0.5) ? 1 : -1)));
    }
  }
  if (terrain.includes('water')) features.push(look.coastal ? '海・川' : '川');
  // 用水：端から3マスの水路を引く
  if (has('aqueduct')) {
    const ar = R('aqueduct'), c = ar.int(4, grid.w - 7), top = ar.chance(0.5);
    for (let k = 0; k < 3; k++) terrain[at(c, top ? k : grid.h - 1 - k)] = 'water';
  }
  // 荒れ：不穏の高い領は、平地が湿地や藪（森）に戻る
  if (look.unrest >= BM.unrest.from) {
    const ur = R('unrest');
    let n = 0;
    for (let i = 0; i < grid.n; i++) {
      if (terrain[i] !== 'plain' || !inMid(i)) continue;
      const x = ur.float();
      if (x < look.unrest * BM.unrest.swamp) { terrain[i] = 'swamp'; n++; }
      else if (x < look.unrest * (BM.unrest.swamp + BM.unrest.forest)) { terrain[i] = 'forest'; n++; }
    }
    if (n) features.push('荒れ地');
  }

  // 街道：中央の行を横切る。川は橋、平地は道にする（騎馬・戦車が必ず通れるように）
  const road = (r: number) => {
    for (let c = 0; c < grid.w; c++) {
      const i = at(c, r);
      if (terrain[i] === 'water') terrain[i] = 'bridge';
      else if (OPEN.has(terrain[i])) terrain[i] = 'road';
    }
  };
  road(mid);
  // 豊かな領は、脇街道がもう1本通る（城壁があれば通用門の行）
  if (look.income >= BM.road.secondIncome) {
    road(R('road2').chance(0.5) ? POSTERN_FROM_EDGE : grid.h - 1 - POSTERN_FROM_EDGE);
    features.push('脇街道');
  }
  // 両軍の配置場所は陸にする
  for (const c of [0, 1, grid.w - 2, grid.w - 1]) for (let r = 0; r < grid.h; r++) {
    const i = at(c, r);
    if (terrain[i] === 'water') terrain[i] = 'plain';
  }
  // 棚田：収入が多いほど、かたまりが増える。用水があれば増え、不穏が高いと減る。まん中あたりの平地と森に置く（街道と両軍の配置場所は避ける）
  const paddies = Math.max(0, BM.paddy.byIncome.filter((t) => look.income >= t).length + (has('aqueduct') ? BM.paddy.aqueduct : 0) - (look.unrest >= BM.paddy.unrest ? 1 : 0));
  const prng = new RNG(codeToSeed(`${w.seed}:map:${provId}:paddy`));
  let paddyCount = 0;
  for (let k = paddies; k > 0; k--) {
    const seed = at(prng.int(3, grid.w - 6), prng.int(0, grid.h - 1));
    for (const i of [seed, ...grid.neighbors(seed)]) {
      const keep = i === seed || prng.chance(0.6);
      // 森も切り開いて田にする（森ばかりの領でも、豊かなら田が見えるように）
      if (keep && (terrain[i] === 'plain' || terrain[i] === 'forest') && inMid(i)) { terrain[i] = 'paddy'; paddyCount++; }
    }
  }
  if (paddyCount) features.push('棚田');
  // 鉱山：上か下の端に、掘り跡（段差）
  if (has('mine')) {
    const mr = R('mine'), c = mr.int(4, grid.w - 8), r = mr.chance(0.5) ? 0 : grid.h - 1;
    for (const i of [at(c, r), at(c + 1, r), at(c, r === 0 ? 1 : r - 1)]) if (terrain[i] !== 'water' && terrain[i] !== 'bridge') terrain[i] = 'cliff';
  }
  // 寺・修道院：まん中あたりの高い所（山・森）に砦として建つ。街道の行とそのすぐ上下は避ける
  const taken = new Set<number>();
  for (const b of ['temple', 'monastery']) {
    if (!has(b)) continue;
    const tr = R(b), score: Partial<Record<TerrainKind, number>> = { mountain: 3, forest: 2, plain: 1, paddy: 1, swamp: 0.5 };
    let best = -1, bestS = -1;
    for (let i = 0; i < grid.n; i++) {
      const c = grid.col(i), r = grid.row(i);
      if (c < 5 || c > grid.w - 6 || Math.abs(r - mid) <= 1 || taken.has(i)) continue;
      const s = (score[terrain[i]] ?? -1) + tr.float() * 0.9;
      if (s > bestS) { bestS = s; best = i; }
    }
    if (best >= 0) { terrain[best] = 'fort'; taken.add(best); }
  }
  // 市：街道ぞいのまん中に町場
  if (has('market')) {
    const kr = R('market');
    for (const c of [6, 7, 8]) for (const r of [mid - 1, mid + 1]) {
      const i = at(c, r);
      if ((c === 7 || kr.chance(0.5)) && terrain[i] !== 'water' && terrain[i] !== 'fort') terrain[i] = 'town';
    }
  }
  // 港：守り手に近い水辺に、2マスの桟橋（橋）と港町
  if (has('harbor')) {
    let best = -1;
    for (let i = 0; i < grid.n; i++) {
      const c = grid.col(i);
      if (terrain[i] !== 'water' || c < 3 || c > grid.w - 4) continue;
      if (!grid.neighbors(i).some((j) => terrain[j] !== 'water' && terrain[j] !== 'bridge')) continue;
      if (best < 0 || c > grid.col(best) || (c === grid.col(best) && Math.abs(grid.row(i) - mid) < Math.abs(grid.row(best) - mid))) best = i;
    }
    if (best >= 0) {
      terrain[best] = 'bridge';
      const out = grid.neighbors(best).find((j) => terrain[j] === 'water');
      if (out !== undefined) terrain[out] = 'bridge';
      const land = grid.neighbors(best).find((j) => OPEN.has(terrain[j]));
      if (land !== undefined) terrain[land] = 'town';
    }
  }

  // 守り手の拠点。本拠か、城の強い領は城。少し強い領は砦。どちらでもなければ陣を張る
  const fort = look.fort;
  const seat = at(grid.w - 2, mid);
  const siege = look.walls || fort >= BM.fort.siege;
  const castle = look.capital || fort >= BM.fort.castle;
  // 城下：人口が多いほど、城のまわりに街が広がる。書庫・学問所があれば、さらに増える
  const T = BM.town;
  const townTiles = (look.pop >= T.city ? T.cityTiles : look.pop >= T.town ? T.townTiles : look.pop >= T.village ? T.villageTiles : 0)
    + (has('library') ? 2 : 0) + (has('university') ? 2 : 0);
  if (townTiles) {
    const near = (grid.range(seat, 3, 1)).filter((i) => grid.col(i) >= grid.w - 4 && OPEN.has(terrain[i]))
      .sort((a, b) => grid.distance(seat, a) - grid.distance(seat, b) || hashCell(a) - hashCell(b));
    near.slice(0, townTiles).forEach((i) => { terrain[i] = 'town'; });
    if (near.length) features.push(look.pop >= T.city ? '城下町' : look.pop >= T.town ? '町' : '村');
  }
  if (castle) {
    terrain[seat] = 'castle';
    // 城壁の建物があるか、城がとても強ければ、城下の街と城壁で囲む
    if (siege) {
      for (const j of grid.neighbors(seat)) if (grid.col(j) < grid.w - 1) terrain[j] = 'town';
      buildWalls(grid, terrain, mid);
      features.unshift('城壁');
    }
    features.unshift('城');
  } else if (fort >= BM.fort.fort) {
    terrain[seat] = 'fort';
    features.unshift('砦');
  } else {
    terrain[seat] = 'camp';
    for (const r of [mid - 1, mid + 1]) {
      const i = at(grid.w - 2, r);
      if (OPEN.has(terrain[i])) terrain[i] = 'camp';
    }
    features.unshift('陣');
  }
  // 出丸：城の強い領は、城壁の無い城や砦の前に陣を張り出す
  if (!siege && terrain[seat] !== 'camp' && fort >= BM.fort.outworks) {
    for (const r of [mid - 1, mid + 1]) {
      const i = at(grid.w - 4, r);
      if (OPEN.has(terrain[i]) || terrain[i] === 'town') terrain[i] = 'camp';
    }
    features.push('出丸');
  }
  // 兵糧蔵：城のそばに陣を2つ（体力が回復する）
  if (has('granary')) {
    const near = grid.range(seat, 2, 1).filter((i) => grid.col(i) >= grid.w - 4 && (OPEN.has(terrain[i]) || terrain[i] === 'town'))
      .sort((a, b) => grid.distance(seat, a) - grid.distance(seat, b) || hashCell(a) - hashCell(b));
    near.slice(0, 2).forEach((i) => { terrain[i] = 'camp'; });
  }
  for (const b of BUILDING_ORDER) if (has(b) && b !== 'walls') features.push(BM.buildings[b]?.name ?? b);
  return {
    grid, terrain, name: w.provinceName[provId]?.ja ?? `第${provId}領`, spawn: spawnZones(grid, terrain), siege: terrain.includes('wall'),
    features: [...new Set(features)],
  };
}

/** 戦場の説明に並べる建物の順 */
const BUILDING_ORDER = ['temple', 'monastery', 'market', 'harbor', 'mine', 'aqueduct', 'granary', 'library', 'university'];
/** マスごとの決まった値（同じ近さのマスの並びを、領によらず決めるため） */
const hashCell = (i: number): number => ((i * 2654435761) >>> 0) % 1000;

/** 城壁の列（守り手の側から数えて5列目）と、通用門の行（上下の端から2つ内側） */
export const WALL_FROM_RIGHT = 5, POSTERN_FROM_EDGE = 2;

/**
 * 城壁を築く。1列をまるごと城壁にして、街道の通る行に大手門、上下に通用門を開ける。門の内側の両わきに櫓を置く。
 * 街道の行は道・橋・山・門だけなので、どの兵も必ず城まで行ける。城壁は歩兵なら乗り越えられる（騎馬は門を通る）。
 */
function buildWalls(grid: HexGrid, terrain: TerrainKind[], mid: number): void {
  const wc = grid.w - WALL_FROM_RIGHT;
  const gates = new Set([mid, POSTERN_FROM_EDGE, grid.h - 1 - POSTERN_FROM_EDGE]);
  for (let r = 0; r < grid.h; r++) terrain[grid.idx(wc, r)] = gates.has(r) ? 'gate' : 'wall';
  // 通用門の内と外は、水や崖でふさがらないようにする
  for (const r of gates) for (const c of [wc - 1, wc + 1]) {
    const i = grid.idx(c, r);
    if (terrain[i] === 'water' || terrain[i] === 'cliff') terrain[i] = 'plain';
  }
  for (const r of [mid - 1, mid + 1]) terrain[grid.idx(wc + 1, r)] = 'tower';
}
