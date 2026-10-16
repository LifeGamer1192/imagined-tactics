// Muted watercolour palette for a parchment map.

import { Biome } from './types';

export type RGB = [number, number, number];

export const PAPER: RGB = [233, 220, 190];
export const INK = '#3b3123';
export const INK_SOFT = 'rgba(59,49,35,0.55)';
export const RIVER = '#55798a';
export const SEA_SHALLOW: RGB = [190, 208, 196];
export const SEA_DEEP: RGB = [140, 172, 176];
export const LAKE: RGB = [170, 198, 196];

export const BIOME_RGB: Record<number, RGB> = {
  [Biome.Ocean]: SEA_DEEP,
  [Biome.Lake]: LAKE,
  [Biome.HotDesert]: [228, 206, 150],
  [Biome.Savanna]: [208, 198, 136],
  [Biome.TropicalForest]: [162, 178, 112],
  [Biome.Rainforest]: [122, 152, 98],
  [Biome.Grassland]: [198, 200, 142],
  [Biome.Deciduous]: [160, 180, 118],
  [Biome.TemperateRainforest]: [130, 160, 114],
  [Biome.Taiga]: [140, 160, 126],
  [Biome.Tundra]: [200, 197, 172],
  [Biome.Glacier]: [238, 240, 236],
  [Biome.Wetland]: [152, 170, 134],
  [Biome.ColdDesert]: [212, 198, 160],
  [Biome.Mountain]: [190, 174, 146],
};

export const HIGHLAND: RGB = [186, 166, 134];

export function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export function css(c: RGB, alpha = 1): string {
  const r = Math.round(c[0]), g = Math.round(c[1]), b = Math.round(c[2]);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}
