// ヘックス座標。平らな辺が上下にくる形（flat-top）で、盤面は長方形。
// マスは「列 c・行 r」の番号（奇数列が半マス下にずれる odd-q）で持ち、距離などの計算は立方体座標で行う。

export interface Cube { x: number; y: number; z: number }

export class HexGrid {
  readonly w: number;
  readonly h: number;
  readonly n: number;

  constructor(w: number, h: number) {
    this.w = w; this.h = h; this.n = w * h;
  }

  idx(c: number, r: number): number { return r * this.w + c; }
  col(i: number): number { return i % this.w; }
  row(i: number): number { return Math.floor(i / this.w); }
  inside(c: number, r: number): boolean { return c >= 0 && r >= 0 && c < this.w && r < this.h; }

  cube(i: number): Cube {
    const c = this.col(i), r = this.row(i);
    const x = c, z = r - (c - (c & 1)) / 2;
    return { x, y: -x - z, z };
  }

  /** 立方体座標 → マス番号（盤の外なら -1） */
  fromCube(q: Cube): number {
    const c = q.x, r = q.z + (q.x - (q.x & 1)) / 2;
    return this.inside(c, r) ? this.idx(c, r) : -1;
  }

  distance(a: number, b: number): number {
    const p = this.cube(a), q = this.cube(b);
    return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
  }

  /** 隣の6マス（盤の中にあるものだけ）。向きは DIRS の順 */
  neighbors(i: number): number[] {
    const out: number[] = [];
    const p = this.cube(i);
    for (const d of DIRS) {
      const j = this.fromCube({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
      if (j >= 0) out.push(j);
    }
    return out;
  }

  /** 向き dir（0〜5）へ k マス進んだ先（盤の外なら -1） */
  step(i: number, dir: number, k = 1): number {
    const p = this.cube(i), d = DIRS[dir];
    return this.fromCube({ x: p.x + d.x * k, y: p.y + d.y * k, z: p.z + d.z * k });
  }

  /** 向き dir への直線上の n マス（自分は含まない。盤の端で止まる） */
  line(i: number, dir: number, n: number): number[] {
    const out: number[] = [];
    for (let k = 1; k <= n; k++) {
      const j = this.step(i, dir, k);
      if (j < 0) break;
      out.push(j);
    }
    return out;
  }

  /** a から見た b の向き（0〜5）。同じ直線上にないときは一番近い向き */
  dirTo(a: number, b: number): number {
    const p = this.cube(a), q = this.cube(b);
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    let best = 0, bestDot = -Infinity;
    DIRS.forEach((d, k) => {
      const dot = dx * d.x + dy * d.y + dz * d.z;
      if (dot > bestDot) { bestDot = dot; best = k; }
    });
    return best;
  }

  /** 中心から距離 min〜max のマス */
  range(i: number, max: number, min = 0): number[] {
    const out: number[] = [];
    const p = this.cube(i);
    for (let dx = -max; dx <= max; dx++) {
      for (let dy = Math.max(-max, -dx - max); dy <= Math.min(max, -dx + max); dy++) {
        const dz = -dx - dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
        if (dist < min) continue;
        const j = this.fromCube({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
        if (j >= 0) out.push(j);
      }
    }
    return out;
  }

  /** マスの中心の画面上の位置（size = 中心から角までの長さ） */
  center(i: number, size: number): [number, number] {
    const c = this.col(i), r = this.row(i);
    return [size * 1.5 * c + size, size * SQRT3 * (r + 0.5 * (c & 1)) + size * SQRT3 / 2];
  }

  /** 盤全体の大きさ */
  pixelSize(size: number): [number, number] {
    return [size * 1.5 * (this.w - 1) + size * 2, size * SQRT3 * (this.h + 0.5)];
  }

  /** 画面上の位置 → マス番号（盤の外なら -1） */
  pick(px: number, py: number, size: number): number {
    // 近い列・行の候補から、中心が一番近いマスを選ぶ
    const c0 = Math.round((px - size) / (size * 1.5));
    let best = -1, bestD = Infinity;
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const r0 = Math.round((py - size * SQRT3 / 2) / (size * SQRT3) - 0.5 * (c & 1));
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        if (!this.inside(c, r)) continue;
        const [x, y] = this.center(this.idx(c, r), size);
        const d = (x - px) ** 2 + (y - py) ** 2;
        if (d < bestD) { bestD = d; best = this.idx(c, r); }
      }
    }
    return bestD <= size * size ? best : -1;
  }
}

const SQRT3 = Math.sqrt(3);
/** 6方向（立方体座標）。0=右下、以下は時計回り */
export const DIRS: Cube[] = [
  { x: 1, y: -1, z: 0 }, { x: 0, y: -1, z: 1 }, { x: -1, y: 0, z: 1 },
  { x: -1, y: 1, z: 0 }, { x: 0, y: 1, z: -1 }, { x: 1, y: 0, z: -1 },
];
