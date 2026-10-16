// Map data shared by gen, sim, render. Structure-of-arrays so the whole map
// can be transferred to/from the worker without copying (DESIGN.md §4).

export const MAP_W = 1600;
export const MAP_H = 1000;
export const SEA_LEVEL = 0.2;

export type MapSize = 'small' | 'medium' | 'large';
export type Template = 'continents' | 'archipelago' | 'pangaea' | 'inland_sea';

export const SIZE_CELLS: Record<MapSize, number> = {
  small: 6000,
  medium: 15000,
  large: 30000,
};

export interface GenParams {
  seed: string;
  size: MapSize;
  template: Template;
  /** overrides the template's default land fraction */
  landRatio?: number;
  /** P22: real land (heights and towns); the template is then unused */
  geo?: unknown;
}

export const enum Water {
  Land = 0,
  Ocean = 1,
  Lake = 2,
}

export const enum Biome {
  Ocean = 0,
  Lake = 1,
  HotDesert = 2,
  Savanna = 3,
  TropicalForest = 4,
  Rainforest = 5,
  Grassland = 6,
  Deciduous = 7,
  TemperateRainforest = 8,
  Taiga = 9,
  Tundra = 10,
  Glacier = 11,
  Wetland = 12,
  ColdDesert = 13,
  Mountain = 14,
}

export const BIOME_KEYS = [
  'ocean', 'lake', 'hot_desert', 'savanna', 'tropical_forest', 'rainforest',
  'grassland', 'deciduous', 'temperate_rainforest', 'taiga', 'tundra',
  'glacier', 'wetland', 'cold_desert', 'mountain',
] as const;

export interface CellMap {
  /** P22 real land: the names of the real rivers and where to write them */
  riverLabels?: { name: { ja: string; en: string }; x: number; y: number; angle: number; rank: number }[];
  seed: string;
  params: GenParams;
  w: number;
  h: number;
  n: number;
  /** average distance between neighbouring cell centres */
  spacing: number;
  x: Float32Array;
  y: Float32Array;
  /** CSR adjacency: neighbours of i are nb[nbOff[i] .. nbOff[i+1]) */
  nbOff: Int32Array;
  nb: Int32Array;
  /** Voronoi polygon of i: vertices polyOff[i] .. polyOff[i+1), stored as x,y pairs in poly */
  polyOff: Int32Array;
  poly: Float32Array;
  /** per polygon edge (vertex k -> k+1), the cell on the other side; -1 on the map border */
  edgeNb: Int32Array;
  /** 1 if the cell touches the map border */
  border: Uint8Array;

  height: Float32Array; // 0..1, sea level = SEA_LEVEL
  water: Uint8Array; // Water
  /** land: 1,2,.. cells from water; water: -1,-2,.. cells from land */
  coastDist: Int16Array;
  temp: Float32Array; // °C, annual mean
  precip: Float32Array; // 0..1
  /** drainage target (cell), -1 for ocean */
  down: Int32Array;
  /** accumulated water flow */
  flux: Float32Array;
  /** flux above which a cell carries a visible river */
  riverMin: number;
  biome: Uint8Array; // Biome
  habit: Float32Array; // 0..1 carrying capacity factor
  /** latitude of the top and bottom map edge (degrees, north positive) */
  latTop: number;
  latBottom: number;
}

export type VisualStyle = 'antique' | 'globe' | 'flat' | 'ink';
