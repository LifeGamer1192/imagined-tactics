// P23: map symbols drawn by hand (Gemini sheets, cut by scripts/mapsprites.mjs).
// They sit on white and are drawn with multiply blending, so the paper
// vanishes and the ink prints on the map. A style without its set loaded
// keeps the drawn-in-code symbols (symbols.ts).

import index from '../../art/mapSprites.json';
import { Sym, type Symbol } from './symbols';
import type { VisualStyle } from './types';

type SetName = 'antique' | 'ink' | 'town_west' | 'town_east' | 'town_ink' | 'wonder_antique' | 'wonder_ink';
type Kind = 'mountain' | 'snow' | 'hill' | 'broadleaf' | 'conifer' | 'palm' | 'dune' | 'reed';

/** which hand-drawn set a look uses (the modern map keeps plain symbols) */
export function spriteSetFor(visual: VisualStyle): SetName | null {
  return visual === 'ink' ? 'ink' : visual === 'antique' || visual === 'globe' ? 'antique' : null;
}

/** the width a symbol of size s takes, by kind (matches the drawn-in-code symbols) */
const WIDTH: Record<Kind, number> = { mountain: 1.4, snow: 1.4, hill: 1.4, broadleaf: 1.0, conifer: 0.75, palm: 0.95, dune: 1.3, reed: 0.85 };

const loaded: Partial<Record<SetName, Record<string, HTMLImageElement[]>>> = {};
const loading: Partial<Record<SetName, Promise<boolean>>> = {};

/** load a set once; resolves true when every picture is in */
export function loadSprites(set: SetName): Promise<boolean> {
  const sizes = (index as Record<string, Record<string, number[][]>>)[set];
  if (!sizes) return Promise.resolve(false);
  loading[set] ??= (async () => {
    const base = `${import.meta.env.BASE_URL ?? './'}art/map/`;
    const out: Record<string, HTMLImageElement[]> = {};
    try {
      await Promise.all(Object.entries(sizes).map(async ([kind, list]) => {
        out[kind] = await Promise.all(list.map(async (_, i) => {
          const img = new Image();
          img.src = `${base}${set}_${kind}_${i}.webp`;
          await img.decode();
          return img;
        }));
      }));
      loaded[set] = out;
      return true;
    } catch {
      return false;
    }
  })();
  return loading[set]!;
}

export function spritesReady(set: SetName | null): boolean {
  return !!set && !!loaded[set];
}

function kindOf(s: Symbol): Kind {
  switch (s.kind) {
    case Sym.Mountain: return s.snow ? 'snow' : 'mountain';
    case Sym.Hill: return 'hill';
    case Sym.Conifer: return 'conifer';
    case Sym.Palm: return 'palm';
    case Sym.Dune: return 'dune';
    case Sym.Reed: return 'reed';
    default: return 'broadleaf';
  }
}

/** draw one symbol from the set (ctx in world units, multiply already set); false if none */
export function drawSprite(ctx: CanvasRenderingContext2D, set: SetName, s: Symbol): boolean {
  const kind = kindOf(s);
  const list = loaded[set]?.[kind] ?? (kind === 'snow' ? loaded[set]?.mountain : undefined);
  if (!list?.length) return false;
  const img = list[Math.min(list.length - 1, Math.floor(s.v * list.length))];
  const w = s.s * WIDTH[kind];
  const h = w * (img.naturalHeight / img.naturalWidth);
  // anchored at the foot, like the drawn-in-code symbols
  ctx.drawImage(img, s.x - w / 2, s.y - h, w, h);
  return true;
}

// ---- P24: settlements, ruins and wonders ----

export type TownStage = 'village' | 'town' | 'walled' | 'great' | 'capital' | 'ruin';
export const TOWN_STAGES: TownStage[] = ['village', 'town', 'walled', 'great'];

/** every set a look draws with */
export function setsFor(visual: VisualStyle): SetName[] {
  if (visual === 'ink') return ['ink', 'town_ink', 'wonder_ink', 'wonder_antique'];
  if (visual === 'antique' || visual === 'globe') return ['antique', 'town_west', 'town_east', 'wonder_antique'];
  return [];
}

/** the town picture for a place (null: none loaded for this look) */
export function townSprite(visual: VisualStyle, culture: 'west' | 'east' | 'fantasy', stage: TownStage, v: number): HTMLImageElement | null {
  // fantasy has no pictures (yet): its towns are drawn as marks
  const set: SetName | null = culture === 'fantasy' ? null : visual === 'ink' ? 'town_ink' : visual === 'antique' || visual === 'globe' ? (culture === 'east' ? 'town_east' : 'town_west') : null;
  const list = set ? loaded[set]?.[stage] : undefined;
  if (!list?.length) return null;
  return list[Math.min(list.length - 1, Math.floor(v * list.length))];
}

/** the picture of a wonder (the ink set borrows the old-map one it lacks) */
export function wonderSprite(visual: VisualStyle, kind: string): HTMLImageElement | null {
  const sets: SetName[] = visual === 'ink' ? ['wonder_ink', 'wonder_antique'] : visual === 'antique' || visual === 'globe' ? ['wonder_antique'] : [];
  for (const s of sets) { const img = loaded[s]?.[kind]?.[0]; if (img) return img; }
  return null;
}