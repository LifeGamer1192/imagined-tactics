// Visual styles (P7): old map, modern globe, modern (web) map. A style only
// changes how things are drawn, never the simulation.

import type { VisualStyle } from './types';
import { Biome } from './types';
import type { RGB } from './palette';

export interface RenderStyle {
  id: VisualStyle;
  paperBg: RGB;
  seaShallow: RGB;
  seaDeep: RGB;
  lake: RGB;
  biome: Record<number, RGB>;
  highland: RGB;
  /** extra tint by elevation (globe: hypsometric colours) */
  hypsometric: boolean;
  hillshade: number;
  blurLand: boolean;
  symbols: boolean;
  contours: boolean;
  graticule: boolean;
  coastInk: string;
  coastWidth: number;
  river: string;
  paperGrain: boolean;
  /** political wash alpha and border look */
  washAlpha: number;
  bandAlpha: number;
  borderInk: string;
  borderDash: number[];
  labelFont: string;
  labelInk: (c: RGB) => string;
  labelHalo: string;
  token: 'banner' | 'disc' | 'pin';
  frameBg: string;
}

const ANTIQUE_BIOMES: Record<number, RGB> = {
  [Biome.Ocean]: [140, 172, 176], [Biome.Lake]: [170, 198, 196], [Biome.HotDesert]: [228, 206, 150],
  [Biome.Savanna]: [208, 198, 136], [Biome.TropicalForest]: [162, 178, 112], [Biome.Rainforest]: [122, 152, 98],
  [Biome.Grassland]: [198, 200, 142], [Biome.Deciduous]: [160, 180, 118], [Biome.TemperateRainforest]: [130, 160, 114],
  [Biome.Taiga]: [140, 160, 126], [Biome.Tundra]: [200, 197, 172], [Biome.Glacier]: [238, 240, 236],
  [Biome.Wetland]: [152, 170, 134], [Biome.ColdDesert]: [212, 198, 160], [Biome.Mountain]: [190, 174, 146],
};

const GLOBE_BIOMES: Record<number, RGB> = {
  [Biome.Ocean]: [40, 90, 150], [Biome.Lake]: [70, 130, 190], [Biome.HotDesert]: [222, 196, 132],
  [Biome.Savanna]: [196, 190, 110], [Biome.TropicalForest]: [96, 150, 72], [Biome.Rainforest]: [52, 120, 60],
  [Biome.Grassland]: [150, 180, 92], [Biome.Deciduous]: [92, 146, 74], [Biome.TemperateRainforest]: [66, 128, 82],
  [Biome.Taiga]: [86, 120, 92], [Biome.Tundra]: [176, 180, 160], [Biome.Glacier]: [244, 248, 250],
  [Biome.Wetland]: [96, 136, 104], [Biome.ColdDesert]: [190, 176, 140], [Biome.Mountain]: [150, 130, 108],
};

const FLAT_BIOMES: Record<number, RGB> = {
  [Biome.Ocean]: [170, 218, 255], [Biome.Lake]: [170, 218, 255], [Biome.HotDesert]: [243, 233, 210],
  [Biome.Savanna]: [236, 236, 214], [Biome.TropicalForest]: [200, 230, 201], [Biome.Rainforest]: [187, 222, 188],
  [Biome.Grassland]: [232, 240, 222], [Biome.Deciduous]: [206, 232, 206], [Biome.TemperateRainforest]: [196, 226, 198],
  [Biome.Taiga]: [210, 230, 212], [Biome.Tundra]: [238, 238, 234], [Biome.Glacier]: [252, 252, 252],
  [Biome.Wetland]: [206, 226, 214], [Biome.ColdDesert]: [240, 236, 222], [Biome.Mountain]: [226, 222, 214],
};

/** sumi ink on washi: land in ink washes by how wooded and high it is */
const INK_BIOMES: Record<number, RGB> = {
  [Biome.Ocean]: [222, 216, 200], [Biome.Lake]: [214, 210, 196], [Biome.HotDesert]: [238, 232, 216],
  [Biome.Savanna]: [228, 222, 204], [Biome.TropicalForest]: [190, 188, 176], [Biome.Rainforest]: [174, 172, 162],
  [Biome.Grassland]: [230, 224, 206], [Biome.Deciduous]: [200, 197, 184], [Biome.TemperateRainforest]: [186, 184, 172],
  [Biome.Taiga]: [180, 178, 168], [Biome.Tundra]: [236, 232, 220], [Biome.Glacier]: [246, 244, 238],
  [Biome.Wetland]: [208, 206, 192], [Biome.ColdDesert]: [234, 228, 212], [Biome.Mountain]: [160, 156, 148],
};

/** mineral pigments of ink painting: indigo, vermilion, ochre, verdigris, ... */
const PIGMENTS: RGB[] = [
  [52, 78, 128], [196, 72, 48], [190, 146, 70], [64, 138, 120], [122, 84, 132], [132, 92, 58],
  [86, 120, 64], [172, 96, 120], [70, 110, 150], [160, 120, 40], [98, 98, 92], [150, 60, 60],
];

/** a nation's colour as the style paints it (ink painting: the nearest pigment) */
export function tint(style: RenderStyle, c: RGB): RGB {
  if (style.id !== 'ink') return c;
  let best = PIGMENTS[0], bd = Infinity;
  for (const p of PIGMENTS) {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

const SERIF = "'IM Fell English', 'Shippori Mincho', serif";
const MINCHO = "'Shippori Mincho', 'Yu Mincho', serif";
const SANS = "system-ui, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic', sans-serif";

export const STYLES: Record<VisualStyle, RenderStyle> = {
  antique: {
    id: 'antique', paperBg: [233, 220, 190], seaShallow: [190, 208, 196], seaDeep: [140, 172, 176], lake: [170, 198, 196],
    biome: ANTIQUE_BIOMES, highland: [186, 166, 134], hypsometric: false, hillshade: 1, blurLand: true, symbols: true,
    contours: true, graticule: false, coastInk: '#3b3123', coastWidth: 1.3, river: '#55798a', paperGrain: true,
    washAlpha: 0.3, bandAlpha: 0.55, borderInk: 'rgba(59,49,35,0.85)', borderDash: [6, 2, 1.5, 2],
    labelFont: SERIF, labelInk: (c) => `rgb(${c.map((v) => Math.round(v * 0.55)).join(',')})`, labelHalo: 'rgba(244,236,214,0.8)',
    token: 'banner', frameBg: '#2a2219',
  },
  globe: {
    id: 'globe', paperBg: [24, 60, 110], seaShallow: [70, 130, 190], seaDeep: [22, 58, 112], lake: [70, 130, 190],
    biome: GLOBE_BIOMES, highland: [160, 128, 96], hypsometric: true, hillshade: 1.6, blurLand: true, symbols: false,
    contours: false, graticule: true, coastInk: 'rgba(20,40,70,0.9)', coastWidth: 1, river: '#3d7fc4', paperGrain: false,
    washAlpha: 0.42, bandAlpha: 0.6, borderInk: 'rgba(30,25,20,0.9)', borderDash: [],
    labelFont: SERIF, labelInk: () => '#1d1a14', labelHalo: 'rgba(255,255,255,0.75)',
    token: 'disc', frameBg: '#0d1b2e',
  },
  flat: {
    id: 'flat', paperBg: [170, 218, 255], seaShallow: [170, 218, 255], seaDeep: [158, 208, 250], lake: [170, 218, 255],
    biome: FLAT_BIOMES, highland: [226, 222, 214], hypsometric: false, hillshade: 0, blurLand: false, symbols: false,
    contours: false, graticule: false, coastInk: 'rgba(120,160,190,0.9)', coastWidth: 0.8, river: '#8cc4f0', paperGrain: false,
    washAlpha: 0.2, bandAlpha: 0.35, borderInk: 'rgba(110,110,110,0.9)', borderDash: [4, 3],
    labelFont: SANS, labelInk: () => '#3c4043', labelHalo: 'rgba(255,255,255,0.9)',
    token: 'pin', frameBg: '#e8eaed',
  },
  ink: {
    id: 'ink', paperBg: [238, 231, 214], seaShallow: [232, 226, 210], seaDeep: [214, 209, 194], lake: [218, 214, 200],
    biome: INK_BIOMES, highland: [140, 136, 128], hypsometric: false, hillshade: 1.5, blurLand: true, symbols: true,
    contours: true, graticule: false, coastInk: 'rgba(24,22,20,0.92)', coastWidth: 1.7, river: 'rgba(40,40,40,0.75)', paperGrain: true,
    washAlpha: 0.2, bandAlpha: 0.45, borderInk: 'rgba(25,22,20,0.8)', borderDash: [7, 3],
    labelFont: MINCHO, labelInk: (c) => `rgb(${c.map((v) => Math.round(v * 0.5)).join(',')})`, labelHalo: 'rgba(246,240,226,0.85)',
    token: 'banner', frameBg: '#1c1a17',
  },
};

/** globe: colour by height above the sea (green lowlands -> brown -> snow) */
export function hypsoTint(h: number): RGB | null {
  if (h < 0.35) return null;
  if (h < 0.55) return [176, 160, 110];
  if (h < 0.75) return [150, 120, 90];
  return [236, 236, 236];
}
