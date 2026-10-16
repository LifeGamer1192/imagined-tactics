// 墨と淡彩の見た目：色の決まり。和紙の地、墨の線、岩絵具の差し色（藍・朱・黄土・緑青）。
// 色は hist-sim/src/render/style.ts の「ink」の見た目に合わせている。

import type { TerrainKind } from '../data/types';

export type RGB = [number, number, number];
export const css = (c: RGB, a = 1): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export const PAPER: RGB = [238, 231, 214];
export const FRAME = '#1c1a17';
export const INK = 'rgba(24,22,20,0.92)';
export const INK_SOFT = 'rgba(25,22,20,0.45)';
export const SEA: RGB = [214, 216, 206];
export const SEA_DEEP: RGB = [200, 204, 196];
export const MINCHO = '"Yu Mincho","Hiragino Mincho ProN","Noto Serif JP","MS PMincho",serif';

/** 岩絵具：藍、朱、黄土、緑青… 勢力の色は、いちばん近い絵具に寄せて塗る */
export const PIGMENTS: RGB[] = [
  [52, 78, 128], [196, 72, 48], [190, 146, 70], [64, 138, 120], [122, 84, 132], [132, 92, 58],
  [86, 120, 64], [172, 96, 120], [70, 110, 150], [160, 120, 40], [98, 98, 92], [150, 60, 60],
];
export function tint(c: RGB): RGB {
  let best = PIGMENTS[0], bd = Infinity;
  for (const p of PIGMENTS) {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export const VERMILION: RGB = [196, 72, 48];
export const INDIGO: RGB = [52, 78, 128];
export const OCHRE: RGB = [190, 146, 70];
export const VERDIGRIS: RGB = [64, 138, 120];
/** 陣営の色：攻め手は朱、守り手は藍 */
export const SIDE_RGB: [RGB, RGB] = [VERMILION, INDIGO];

/** 戦場のマスの淡い塗り */
export const TERRAIN_WASH: Record<TerrainKind, RGB> = {
  plain: [230, 226, 200], road: [232, 220, 190], bridge: [226, 212, 182], forest: [204, 212, 184], mountain: [210, 204, 192],
  swamp: [208, 214, 198], water: [196, 210, 214], castle: [238, 230, 212], town: [234, 224, 204], cliff: [176, 170, 160],
  camp: [234, 224, 198], fort: [226, 214, 192], paddy: [206, 216, 190], wall: [200, 194, 182], gate: [228, 214, 186], tower: [222, 210, 188], desert: [232, 214, 170], snowfield: [238, 240, 240], void: [0, 0, 0],
};

/** hist-sim の地形（Biome の番号）→ 戦略マップの淡い塗り */
export const BIOME_WASH: Record<number, RGB> = {
  0: SEA, 1: [214, 214, 204], 2: [238, 232, 216], 3: [228, 222, 204], 4: [198, 200, 180], 5: [186, 190, 172],
  6: [230, 226, 206], 7: [206, 208, 188], 8: [194, 198, 180], 9: [190, 192, 178], 10: [236, 232, 220], 11: [246, 244, 238],
  12: [210, 212, 196], 13: [234, 228, 212], 14: [188, 184, 174],
};

/** 乱数を使わない、決まったゆらぎ（0〜1） */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
