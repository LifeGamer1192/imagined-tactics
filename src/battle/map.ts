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
  /** 画面の上での北の向き（右が +x、下が +y の単位ベクトル）。方位の印に使う。領から作った戦場は、いつも北が上 */
  north?: [number, number];
  /** 以下は領から作った戦場だけ：守り手の拠点（城・砦・陣）のマス */
  seat?: number;
  /** 攻め手が入ってきた辺（EDGES の番号）と、その方角の名前（東・南東…） */
  edge?: number;
  edgeName?: string;
  /** マスごとの深さ（攻め手の辺 −R 〜 守り手の辺 +R）と横の位置。盤の外は NaN */
  depth?: number[];
  lateral?: number[];
}

const LEGEND: Record<string, TerrainKind> = {
  '.': 'plain', '=': 'road', 'B': 'bridge', 'T': 'forest', '^': 'mountain', ',': 'swamp',
  '~': 'water', 'C': 'castle', 'W': 'town', '#': 'cliff',
  'A': 'camp', 'F': 'fort', 'P': 'paddy', 'H': 'wall', 'G': 'gate', 'Y': 'tower', '_': 'void',
};
export const TERRAIN_CHAR: Record<TerrainKind, string> = Object.fromEntries(Object.entries(LEGEND).map(([k, v]) => [v, k])) as Record<TerrainKind, string>;

function spawnZones(grid: HexGrid, terrain: TerrainKind[]): [number[], number[]] {
  const zone = (cols: number[]) => {
    const out: number[] = [];
    for (const c of cols) for (let r = 0; r < grid.h; r++) {
      const i = grid.idx(c, r);
      if (terrain[i] !== 'water' && terrain[i] !== 'cliff' && terrain[i] !== 'wall' && terrain[i] !== 'tower' && terrain[i] !== 'void') out.push(i);
    }
    return out;
  };
  return [zone([0, 1, 2]), zone([grid.w - 1, grid.w - 2, grid.w - 3])];
}

/**
 * 文字のマップ（1文字＝1マス、空白は無視）。
 * 凡例：. 草原  = 道  B 橋  T 森  ^ 山  , 湿地  ~ 川  C 城  W 街  # 段差  A 陣  F 砦  P 棚田  H 城壁  G 門  Y 櫓  _ 盤の外
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

/** 戦場の作り方と普請の調整値（data/system/battlemap.json） */
export const BM = battlemapJson as unknown as {
  fort: { fort: number; castle: number; siege: number; outworks: number };
  town: { village: number; town: number; city: number; villageTiles: number; townTiles: number; cityTiles: number };
  paddy: { byIncome: number[]; aqueduct: number; unrest: number };
  road: { secondIncome: number };
  /** 盤に占める水の上限（割合）：海と川 */
  water: { seaMax: number; riverMax: number };
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
  /** 攻めてくる領（戦場の向きが決まる）。省くと、攻め手は西（左）から来る */
  from?: number;
}

function lookOf(w: HWorld, id: number, o: ProvinceLook): Required<Omit<ProvinceLook, 'from'>> {
  const ps = w.ps, p = w.provinces[id];
  const buildings = o.buildings ?? buildingsOf(ps.buildings[id] ?? 0);
  const pop = o.pop ?? ps.pop[id] ?? 0;
  return {
    capital: !!o.capital, walls: !!o.walls || buildings.includes('walls'), fort: o.fort ?? ps.fort[id] ?? 0, buildings, pop,
    income: o.income ?? pop * (ps.prosperity[id] ?? 0.5) * (1 - (ps.devastation[id] ?? 0)) * PER_POP,
    unrest: o.unrest ?? ps.unrest[id] ?? 0, coastal: o.coastal ?? !!p.coastal, river: o.river ?? !!p.river,
  };
}

/** 六角形の盤の半径（中心から辺の端までのマスの数）。マスは 3R(R+1)+1 */
export const BOARD_R = 7;

/** 盤を入れる長方形（列は 2R+1、行は盤が収まるだけ）と、盤の中心のマス。盤の外のマスは 'void' */
const BOARD = (() => {
  const R = BOARD_R, w = 2 * R + 1, want = 3 * R * (R + 1) + 1;
  for (let h = 2 * R + 1; h <= 2 * R + 3; h++) for (let rc = R - 1; rc <= R + 2; rc++) {
    const g = new HexGrid(w, h), center = g.idx(R, rc);
    let n = 0;
    for (let i = 0; i < g.n; i++) if (g.distance(i, center) <= R) n++;
    if (n === want) return { w, h, cc: R, rc };
  }
  throw new Error('六角形の盤が長方形に収まりません');
})();

type Cube3 = [number, number, number];
/**
 * 盤の6つの辺（攻め手が入ってくる辺）。順は、世界の向き（右が東、下が南）で 0°・60°…（東・南東・南西・西・北西・北東）。
 * d：深さ（攻め手の辺が −R、守り手の辺が +R）。l：横の位置（深さと直交）。どちらも盤の中心からの立方体座標で測る。
 * 深さが同じマスは一続きの列になり、盤を2つに分ける（城壁や川に使う）
 */
export const EDGES: { name: string; d: (c: Cube3) => number; l: (c: Cube3) => number }[] = [
  { name: '東', d: ([x]) => -x, l: ([, y, z]) => y - z },
  { name: '南東', d: ([, y]) => y, l: ([x, , z]) => z - x },
  { name: '南西', d: ([, , z]) => -z, l: ([x, y]) => x - y },
  { name: '西', d: ([x]) => x, l: ([, y, z]) => z - y },
  { name: '北西', d: ([, y]) => -y, l: ([x, , z]) => x - z },
  { name: '北東', d: ([, , z]) => z, l: ([x, y]) => y - x },
];
/** 攻めてくる向き（守る領 → 攻めてくる領の世界での向き）から、攻め手が入る辺 */
export function edgeFor(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return ((Math.round(a / (Math.PI / 3)) % 6) + 6) % 6;
}

/**
 * 領から戦場マップを作る。同じ領・同じようす・同じ攻めてくる向きからは、いつも同じマップになる。
 * 盤は六角形で、北が上。攻め手は、攻めてきた領の方角の辺（6つのどれか）から入り、守り手・城・城壁は反対の辺の側に置く。
 * 地形は本当の地理のままなので、山の側から攻めると苦しい、川を渡って攻める、などが方角で変わる。
 * 1. 地形：領のまわりのセルの地形を当てる。川は盤の riverMax まで、海は seaMax まで（多ければ、領に寄せて読み直し、それでも多ければ削る）。
 *    海沿いで海が無ければ横の端を海に、大河があれば戦場を横切る川を入れる。
 * 2. 領のようす：人口で城下の街、収入で棚田と脇街道、不穏で荒れ地（湿地・藪）、城の強さで陣・砦・城・城壁と出丸。
 * 3. 建物：寺・修道院は砦、市は町場、港は桟橋、鉱山は掘り跡、用水は水路と棚田、兵糧蔵は陣、書庫・学問所は街。
 * 建物ごとに別の乱数を使うので、建物が増えても、ほかの所の形は変わらない。
 */
export function mapFromProvince(w: HWorld, provId: number, opts: ProvinceLook = {}): BattleMap {
  const p = w.provinces[provId];
  const look = lookOf(w, provId, opts);
  const m = w.map;
  const RAD = BOARD_R;
  const grid = new HexGrid(BOARD.w, BOARD.h);
  const center = grid.idx(BOARD.cc, BOARD.rc);
  const has = (b: string) => look.buildings.includes(b);
  const R = (k: string) => new RNG(codeToSeed(`${w.seed}:map:${provId}:${k}`));
  const features: string[] = [];

  // 攻め手の辺：攻めてくる領の方角。省くと西から
  const fromP = opts.from !== undefined && opts.from !== provId ? w.provinces[opts.from] : undefined;
  const edge = fromP && Math.hypot(fromP.cx - p.cx, fromP.cy - p.cy) > 1e-6 ? edgeFor(fromP.cx - p.cx, fromP.cy - p.cy) : 3;
  const E = EDGES[edge];
  const c0 = grid.cube(center);
  const cubeOf = (i: number): Cube3 => { const q = grid.cube(i); return [q.x - c0.x, q.y - c0.y, q.z - c0.z]; };
  const board: number[] = [];
  const depth = new Array<number>(grid.n).fill(NaN), lateral = new Array<number>(grid.n).fill(NaN);
  for (let i = 0; i < grid.n; i++) {
    if (grid.distance(i, center) > RAD) continue;
    board.push(i);
    const q = cubeOf(i);
    depth[i] = E.d(q); lateral[i] = E.l(q);
  }
  const onBoard = (i: number) => !Number.isNaN(depth[i]);
  const D = (i: number) => depth[i], L = (i: number) => lateral[i];
  const layer = (d: number) => board.filter((i) => D(i) === d);

  // ---- 1. 地形を読む。盤の中心＝領の中心、盤の内接円に領（と少しのまわり）が収まる縮尺
  const [cx0, cy0] = grid.center(center, 1);
  let rWorld = 0;
  for (const c of p.cells) rWorld = Math.max(rWorld, Math.hypot(m.x[c] - p.cx, m.y[c] - p.cy));
  const inner = 1.5 * RAD;
  const riverMin = m.riverMin ?? Infinity;
  type Cell = { k: TerrainKind; sea: boolean; flux: number };
  const kindOf = (cell: number): Cell => {
    const b = m.biome[cell];
    if (WATER.has(b) || m.water[cell]) return { k: 'water', sea: true, flux: 0 };
    if (m.flux[cell] >= riverMin) return { k: 'water', sea: false, flux: m.flux[cell] };
    if (b === B_MOUNTAIN || m.height[cell] > HIGH) return { k: 'mountain', sea: false, flux: 0 };
    if (b === B_WETLAND) return { k: 'swamp', sea: false, flux: 0 };
    if (FOREST.has(b)) return { k: 'forest', sea: false, flux: 0 };
    return { k: 'plain', sea: false, flux: 0 };
  };
  // 領の陸の重心（海が多いとき、ここへ寄せて読み直す）
  let lx = 0, ly = 0;
  for (const c of p.cells) { lx += m.x[c]; ly += m.y[c]; }
  lx /= Math.max(1, p.cells.length); ly /= Math.max(1, p.cells.length);
  const sample = (ox: number, oy: number, scale: number): Cell[] => {
    const reach = scale * (RAD * 2 + 2);
    const cand: number[] = [];
    for (let i = 0; i < m.n; i++) if (Math.abs(m.x[i] - ox) <= reach && Math.abs(m.y[i] - oy) <= reach) cand.push(i);
    const out: Cell[] = new Array(grid.n);
    for (const i of board) {
      const [px, py] = grid.center(i, 1);
      const fx = ox + (px - cx0) * scale, fy = oy + (py - cy0) * scale;
      let best = cand[0] ?? p.seat, bestD = Infinity;
      for (const c of cand) { const d = (m.x[c] - fx) ** 2 + (m.y[c] - fy) ** 2; if (d < bestD) { bestD = d; best = c; } }
      out[i] = kindOf(best);
    }
    return out;
  };
  const W = BM.water, N = board.length;
  let ox = p.cx, oy = p.cy, scale = (rWorld * 1.15 + 15) / inner;
  let cells = sample(ox, oy, scale);
  const seaCount = (cs: Cell[]) => board.filter((i) => cs[i].k === 'water' && cs[i].sea).length;
  // 海が多すぎるときは、領の陸のほうへ寄せて、少し狭く読み直す
  for (let t = 0; t < 3 && seaCount(cells) > W.seaMax * N; t++) {
    ox += (lx - ox) * 0.6; oy += (ly - oy) * 0.6; scale *= 0.85;
    cells = sample(ox, oy, scale);
  }
  const terrain: TerrainKind[] = new Array<TerrainKind>(grid.n).fill('void');
  for (const i of board) terrain[i] = cells[i].k;
  // それでも多ければ、陸から遠い海から陸（浜の平地）に変える
  const seaCells = board.filter((i) => terrain[i] === 'water' && cells[i].sea);
  if (seaCells.length > W.seaMax * N) {
    const dist = landDistance(grid, board, (i) => terrain[i] !== 'water');
    seaCells.sort((a, b) => dist[b] - dist[a] || a - b).slice(0, seaCells.length - Math.floor(W.seaMax * N)).forEach((i) => { terrain[i] = 'plain'; });
  }
  // 川も多すぎれば、流れの細いところから陸に変える
  const riverCells = board.filter((i) => terrain[i] === 'water' && !cells[i].sea);
  if (riverCells.length > W.riverMax * N) {
    riverCells.sort((a, b) => cells[a].flux - cells[b].flux || a - b).slice(0, riverCells.length - Math.floor(W.riverMax * N)).forEach((i) => { terrain[i] = 'plain'; });
  }
  // 細部のゆらぎ：平地に少しだけ森を混ぜる（同じ領なら同じ結果）
  const rng = new RNG(codeToSeed(`${w.seed}:map:${provId}`));
  for (const i of board) if (terrain[i] === 'plain' && rng.chance(0.06)) terrain[i] = 'forest';

  /** 両軍の配置場所と守り手の拠点のあいだ */
  const inMid = (i: number) => onBoard(i) && D(i) >= -RAD + 3 && D(i) <= RAD - 5;
  const OPEN = new Set<TerrainKind>(['plain', 'forest', 'paddy', 'swamp']);
  const maxL = (d: number) => 2 * RAD - Math.abs(d);
  /** 横の端（攻め手・守り手の辺ではない側の辺）に近いマス：side は +1 か −1 */
  const sideEdge = (i: number, side: number, n: number) => side * L(i) >= maxL(D(i)) - 2 * (n - 1);

  // 海：海沿いの領で、戦場に水が無ければ、横の端の片側を海にする（両軍の配置場所の深さは除く）
  if (look.coastal && !board.some((i) => terrain[i] === 'water')) {
    const s = R('sea').chance(0.5) ? 1 : -1;
    for (const i of board) if (D(i) > -RAD + 2 && D(i) < RAD - 2 && sideEdge(i, s, 2)) terrain[i] = 'water';
  }
  // 川：大河の流れる領で、戦場のまん中に水が無ければ、攻め手の前を横切る川を入れる（街道は橋で渡る）
  if (look.river && !board.some((i) => terrain[i] === 'water' && inMid(i) && Math.abs(L(i)) < maxL(D(i)) - 1)) {
    const d0 = R('river').int(-3, 0);
    for (const i of layer(d0)) terrain[i] = 'water';
  }
  if (board.some((i) => terrain[i] === 'water')) features.push(look.coastal ? '海・川' : '川');
  // 用水：横の端から3マスの水路を引く
  if (has('aqueduct')) {
    const ar = R('aqueduct'), d = ar.int(-RAD + 4, RAD - 6), s = ar.chance(0.5) ? 1 : -1;
    layer(d).sort((a, b) => s * L(b) - s * L(a)).slice(0, 3).forEach((i) => { terrain[i] = 'water'; });
  }
  // 荒れ：不穏の高い領は、平地が湿地や藪（森）に戻る
  if (look.unrest >= BM.unrest.from) {
    const ur = R('unrest');
    let n = 0;
    for (const i of board) {
      if (terrain[i] !== 'plain' || !inMid(i)) continue;
      const x = ur.float();
      if (x < look.unrest * BM.unrest.swamp) { terrain[i] = 'swamp'; n++; }
      else if (x < look.unrest * (BM.unrest.swamp + BM.unrest.forest)) { terrain[i] = 'forest'; n++; }
    }
    if (n) features.push('荒れ地');
  }

  // 街道：攻め手の辺のまん中から、深さを1つずつ進んで守り手の辺まで。川は橋、平地は道にする（騎馬・戦車が必ず通れるように）
  const walk = (lt: number): number[] => {
    let cur = layer(-RAD).sort((a, b) => Math.abs(L(a) - lt) - Math.abs(L(b) - lt) || L(a) - L(b))[0];
    const path = [cur];
    while (D(cur) < RAD) {
      const next = grid.neighbors(cur).filter((j) => onBoard(j) && D(j) === D(cur) + 1)
        .sort((a, b) => Math.abs(L(a) - lt) - Math.abs(L(b) - lt) || L(a) - L(b))[0];
      if (next === undefined) break;
      path.push(next); cur = next;
    }
    return path;
  };
  const paveRoad = (path: number[]) => { for (const i of path) { if (terrain[i] === 'water') terrain[i] = 'bridge'; else if (OPEN.has(terrain[i])) terrain[i] = 'road'; } };
  const road = walk(0);
  paveRoad(road);
  // 豊かな領は、脇街道がもう1本通る（城壁があれば通用門を通る）
  const POSTERN = 6;
  let road2: number[] = [];
  if (look.income >= BM.road.secondIncome) {
    road2 = walk(R('road2').chance(0.5) ? POSTERN : -POSTERN);
    paveRoad(road2);
    features.push('脇街道');
  }
  // 両軍の配置場所は陸にする
  for (const i of board) if ((D(i) <= -RAD + 2 || D(i) >= RAD - 2) && terrain[i] === 'water') terrain[i] = 'plain';
  // 棚田：収入が多いほど、かたまりが増える。用水があれば増え、不穏が高いと減る。まん中あたりの平地と森に置く（街道と両軍の配置場所は避ける）
  const paddies = Math.max(0, BM.paddy.byIncome.filter((t) => look.income >= t).length + (has('aqueduct') ? BM.paddy.aqueduct : 0) - (look.unrest >= BM.paddy.unrest ? 1 : 0));
  const prng = new RNG(codeToSeed(`${w.seed}:map:${provId}:paddy`));
  const mids = board.filter(inMid);
  let paddyCount = 0;
  for (let k = paddies; k > 0; k--) {
    const seed = mids[prng.int(0, mids.length - 1)];
    for (const i of [seed, ...grid.neighbors(seed)]) {
      const keep = i === seed || prng.chance(0.6);
      // 森も切り開いて田にする（森ばかりの領でも、豊かなら田が見えるように）
      if (keep && (terrain[i] === 'plain' || terrain[i] === 'forest') && inMid(i)) { terrain[i] = 'paddy'; paddyCount++; }
    }
  }
  if (paddyCount) features.push('棚田');
  // 鉱山：横の端に、掘り跡（段差）
  if (has('mine')) {
    const mr = R('mine'), s = mr.chance(0.5) ? 1 : -1, d = mr.int(-2, 1);
    const at = layer(d).sort((a, b) => s * L(b) - s * L(a))[0];
    for (const i of [at, ...grid.neighbors(at).filter((j) => onBoard(j) && sideEdge(j, s, 2))].slice(0, 3)) if (terrain[i] !== 'water' && terrain[i] !== 'bridge' && terrain[i] !== 'road') terrain[i] = 'cliff';
  }
  // 寺・修道院：まん中あたりの高い所（山・森）に砦として建つ。街道とそのすぐ横は避ける
  const roadSet = new Set([...road, ...road2]);
  const nearRoad = (i: number) => roadSet.has(i) || grid.neighbors(i).some((j) => roadSet.has(j));
  const taken = new Set<number>();
  for (const b of ['temple', 'monastery']) {
    if (!has(b)) continue;
    const tr = R(b), score: Partial<Record<TerrainKind, number>> = { mountain: 3, forest: 2, plain: 1, paddy: 1, swamp: 0.5 };
    let best = -1, bestS = -1;
    for (const i of board) {
      if (D(i) < -RAD + 5 || D(i) > RAD - 5 || nearRoad(i) || taken.has(i)) continue;
      const s = (score[terrain[i]] ?? -1) + tr.float() * 0.9;
      if (s > bestS) { bestS = s; best = i; }
    }
    if (best >= 0) { terrain[best] = 'fort'; taken.add(best); }
  }
  // 市：街道ぞいのまん中に町場
  if (has('market')) {
    const kr = R('market');
    for (const i of board) {
      if (roadSet.has(i) || Math.abs(D(i)) > 1 || !grid.neighbors(i).some((j) => road.includes(j))) continue;
      if ((D(i) === 0 || kr.chance(0.5)) && terrain[i] !== 'water' && terrain[i] !== 'fort') terrain[i] = 'town';
    }
  }
  // 港：守り手に近い水辺に、2マスの桟橋（橋）と港町
  if (has('harbor')) {
    let best = -1;
    for (const i of board) {
      if (terrain[i] !== 'water' || D(i) < -RAD + 3 || D(i) > RAD - 3) continue;
      if (!grid.neighbors(i).some((j) => onBoard(j) && terrain[j] !== 'water' && terrain[j] !== 'bridge')) continue;
      if (best < 0 || D(i) > D(best) || (D(i) === D(best) && Math.abs(L(i)) < Math.abs(L(best)))) best = i;
    }
    if (best >= 0) {
      terrain[best] = 'bridge';
      const out = grid.neighbors(best).find((j) => onBoard(j) && terrain[j] === 'water');
      if (out !== undefined) terrain[out] = 'bridge';
      const land = grid.neighbors(best).find((j) => onBoard(j) && OPEN.has(terrain[j]));
      if (land !== undefined) terrain[land] = 'town';
    }
  }

  // 守り手の拠点：街道が守り手の辺の1つ手前で通るマス。本拠か、城の強い領は城。少し強い領は砦。どちらでもなければ陣を張る
  const fort = look.fort;
  const seat = road.find((i) => D(i) === RAD - 1) ?? layer(RAD - 1).sort((a, b) => Math.abs(L(a)) - Math.abs(L(b)))[0];
  const siege = look.walls || fort >= BM.fort.siege;
  const castle = look.capital || fort >= BM.fort.castle;
  const behind = (i: number) => onBoard(i) && D(i) >= RAD - 3;
  // 城下：人口が多いほど、城のまわりに街が広がる。書庫・学問所があれば、さらに増える
  const T = BM.town;
  const townTiles = (look.pop >= T.city ? T.cityTiles : look.pop >= T.town ? T.townTiles : look.pop >= T.village ? T.villageTiles : 0)
    + (has('library') ? 2 : 0) + (has('university') ? 2 : 0);
  if (townTiles) {
    const near = grid.range(seat, 3, 1).filter((i) => behind(i) && OPEN.has(terrain[i]))
      .sort((a, b) => grid.distance(seat, a) - grid.distance(seat, b) || hashCell(a) - hashCell(b));
    near.slice(0, townTiles).forEach((i) => { terrain[i] = 'town'; });
    if (near.length) features.push(look.pop >= T.city ? '城下町' : look.pop >= T.town ? '町' : '村');
  }
  if (castle) {
    terrain[seat] = 'castle';
    // 城壁の建物があるか、城がとても強ければ、城下の街と城壁で囲む
    if (siege) {
      for (const j of grid.neighbors(seat)) if (onBoard(j) && D(j) >= RAD - 2) terrain[j] = 'town';
      buildWalls(grid, terrain, layer(RAD - 4), road, road2, POSTERN, D, L, onBoard);
      features.unshift('城壁');
    }
    features.unshift('城');
  } else if (fort >= BM.fort.fort) {
    terrain[seat] = 'fort';
    features.unshift('砦');
  } else {
    terrain[seat] = 'camp';
    for (const i of grid.neighbors(seat)) if (onBoard(i) && D(i) === RAD - 1 && OPEN.has(terrain[i])) terrain[i] = 'camp';
    features.unshift('陣');
  }
  // 出丸：城の強い領は、城壁の無い城や砦の前に陣を張り出す（街道の両わき）
  if (!siege && terrain[seat] !== 'camp' && fort >= BM.fort.outworks) {
    const front = layer(RAD - 3).filter((i) => !roadSet.has(i) && (OPEN.has(terrain[i]) || terrain[i] === 'town'))
      .sort((a, b) => Math.abs(L(a) - L(seat)) - Math.abs(L(b) - L(seat)) || L(a) - L(b)).slice(0, 2);
    front.forEach((i) => { terrain[i] = 'camp'; });
    features.push('出丸');
  }
  // 兵糧蔵：城のそばに陣を2つ（体力が回復する）
  if (has('granary')) {
    const near = grid.range(seat, 2, 1).filter((i) => behind(i) && (OPEN.has(terrain[i]) || terrain[i] === 'town'))
      .sort((a, b) => grid.distance(seat, a) - grid.distance(seat, b) || hashCell(a) - hashCell(b));
    near.slice(0, 2).forEach((i) => { terrain[i] = 'camp'; });
  }
  for (const b of BUILDING_ORDER) if (has(b) && b !== 'walls') features.push(BM.buildings[b]?.name ?? b);

  const zone = (pred: (i: number) => boolean) => board.filter((i) => pred(i) && !BLOCKED_SPAWN.has(terrain[i]));
  return {
    grid, terrain, name: w.provinceName[provId]?.ja ?? `第${provId}領`,
    spawn: [zone((i) => D(i) <= -RAD + 2), zone((i) => D(i) >= RAD - 2)],
    siege: terrain.includes('wall'),
    features: [...new Set(features)],
    seat, edge, edgeName: E.name, depth, lateral, north: [0, -1],
  };
}

/** 配置場所に使えない地形 */
const BLOCKED_SPAWN = new Set<TerrainKind>(['water', 'cliff', 'wall', 'tower', 'void']);

/** 盤の各マスの、条件を満たすマス（陸）までの歩数 */
function landDistance(grid: HexGrid, board: number[], isLand: (i: number) => boolean): number[] {
  const dist = new Array<number>(grid.n).fill(Infinity);
  const inBoard = new Set(board);
  const q: number[] = [];
  for (const i of board) if (isLand(i)) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const j of grid.neighbors(i)) if (inBoard.has(j) && dist[j] === Infinity) { dist[j] = dist[i] + 1; q.push(j); }
  }
  return dist;
}

/** 戦場の説明に並べる建物の順 */
const BUILDING_ORDER = ['temple', 'monastery', 'market', 'harbor', 'mine', 'aqueduct', 'granary', 'library', 'university'];
/** マスごとの決まった値（同じ近さのマスの並びを、領によらず決めるため） */
const hashCell = (i: number): number => ((i * 2654435761) >>> 0) % 1000;

/**
 * 城壁を築く。守り手の辺から数えて5つ目の深さのマスの列（一続きで盤を2つに分ける）をまるごと城壁にして、
 * 街道の通るマスに大手門、横に離れた2か所に通用門を開ける（脇街道があれば、その通るマス）。大手門の内側の両わきに櫓を置く。
 * 街道は道・橋・山・門だけなので、どの兵も必ず城まで行ける。城壁は歩兵なら乗り越えられる（騎馬は門を通る）。
 */
function buildWalls(grid: HexGrid, terrain: TerrainKind[], wallLayer: number[], road: number[], road2: number[], postern: number,
  D: (i: number) => number, L: (i: number) => number, onBoard: (i: number) => boolean): void {
  const main = wallLayer.find((i) => road.includes(i)) ?? wallLayer.sort((a, b) => Math.abs(L(a)) - Math.abs(L(b)))[0];
  const near = (lt: number) => wallLayer.slice().sort((a, b) => Math.abs(L(a) - lt) - Math.abs(L(b) - lt) || L(a) - L(b))[0];
  const side2 = road2.find((i) => wallLayer.includes(i));
  const gates = new Set([main, side2 ?? near(postern), side2 !== undefined ? near(-L(side2)) : near(-postern)]);
  for (const i of wallLayer) terrain[i] = gates.has(i) ? 'gate' : 'wall';
  // 門の内と外は、水や崖でふさがらないようにする
  for (const g of gates) for (const j of grid.neighbors(g)) {
    if (!onBoard(j) || Math.abs(D(j) - D(g)) !== 1) continue;
    if (terrain[j] === 'water' || terrain[j] === 'cliff') terrain[j] = 'plain';
  }
  // 櫓：大手門のすぐ内側の、街道の両わき
  grid.range(main, 2, 1).filter((j) => onBoard(j) && D(j) === D(main) + 1 && !road.includes(j))
    .sort((a, b) => grid.distance(main, a) - grid.distance(main, b) || L(a) - L(b)).slice(0, 2).forEach((j) => { terrain[j] = 'tower'; });
}
