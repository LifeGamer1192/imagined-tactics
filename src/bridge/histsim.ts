// hist-sim のセーブ（.histsim：gzip で圧縮した JSON）を読む。
// 形式は hist-sim/src/sim/save.ts と同じ：{format:'hist-sim', version, savedAt, summary, world}。
// 型付き配列は {__ta: 型名, b64} で入っている。ここでは変換に使う項目だけを型にしている。

export interface Name { ja: string; en: string }

export type Government = 'tribe' | 'chiefdom' | 'monarchy' | 'empire' | 'republic' | 'theocracy';
export type Economy = 'agrarian' | 'pastoral' | 'trade' | 'mining' | 'maritime';
export type NotableRole = 'general' | 'minister' | 'scholar' | 'artist' | 'saint' | 'prophet' | 'rebel' | 'hero' | 'explorer' | 'seer';
export type TieKind = 'mentor' | 'pupil' | 'friend' | 'sworn' | 'rival' | 'love' | 'companion' | 'betrayed' | 'betrayed_by' | 'avenge' | 'lord' | 'servant' | 'spouse';

export interface HPerson {
  name: Name; house: Name; born: number;
  admin: number; military: number; diplomacy: number; charisma: number;
  health: number; traits: string[]; pid?: number; sex?: 'm' | 'f';
}
export interface HRuler extends HPerson { since: number }
export interface HTie { kind: TieKind; with: number; since: number; note?: Name; settled?: boolean }
export interface HPersonRec {
  id: number; p: HPerson; died: number; parents: number[]; spouses: number[]; children: number[];
  blood: number; court: number; depth: number; reigns: { nation: number; from: number; to: number }[];
  role?: NotableRole; office?: Name; fame: number; ties?: HTie[];
}
export interface HNation {
  id: number; root: Name; label?: Name; rank?: Name; government: Government; economy: Economy;
  color: [number, number, number]; culture: number; religion: number; capital: number; dead: number;
  ruler: HRuler; heir: HPerson | null; coRuler?: HPerson;
  treasury: number; stability: number; legitimacy: number; prestige: number; manpower: number; tech: number;
  reforms?: string[]; opinions: Record<number, number>; overlord: number; vassalKind: 'vassal' | 'tributary' | null;
  provinceCount: number;
}
export interface HArmy {
  id: number; nation: number; role: 'garrison' | 'guard' | 'field' | 'raider';
  troops: number; maxTroops: number; morale: number; general: HPerson; prov: number; target: number;
}
export interface HProvince {
  id: number; cells: number[]; seat: number; nb: number[]; biome: number; elevation: number; river: boolean;
  cx: number; cy: number; passable: boolean; coastal?: boolean;
}
export interface HProvinceState {
  owner: Uint16Array; controller: Uint16Array; culture: Uint16Array; religion: Uint16Array;
  pop: Float32Array; prosperity: Float32Array; unrest: Float32Array; devastation: Float32Array;
  fort: Float32Array; buildings: Uint16Array; held: Int32Array;
}
export interface HWar { id: number; attackers: number[]; defenders: number[]; started: number; score: number }
export interface HMap {
  n: number; w: number; h: number; x: Float32Array | Float64Array; y: Float32Array | Float64Array;
  biome: Uint8Array; height: Float32Array; water: Uint8Array; flux: Float32Array; riverMin?: number;
  /** セルの形：i 番のセルの頂点は poly の polyOff[i]〜polyOff[i+1]（x,y の組） */
  polyOff: Int32Array; poly: Float32Array;
  /** セルの辺ごとに、向こう側のセルの番号（地図の端は -1） */
  edgeNb: Int32Array;
  /** 水の流れる先のセル（海は -1） */
  down: Int32Array;
}
export interface HWorld {
  seed: string; scenario?: { id: string }; name: Name; tick: number; startYear: number;
  nations: (HNation | null)[]; people: Record<number, HPersonRec>; reigning: Record<number, number>;
  armies: HArmy[]; provinces: HProvince[]; provinceName: Name[]; provinceOf: Int32Array; ps: HProvinceState;
  seaLinks: number[][]; cultures: { id: number; name: Name; economy: Economy }[];
  religions: { id: number; name: Name; doctrine: string }[];
  wars: HWar[]; alliances: Record<string, number>; truces: Record<string, { until: number; count: number }>;
  map: HMap; goods: Uint8Array;
}
export interface HSave {
  format: string; version: number; savedAt: string;
  summary: { seed: string; year: number; nations: number };
  world: HWorld;
}

export const SAVE_FORMAT = 'hist-sim';
/** 読めることを確かめたセーブの版数。これより新しいと警告する */
export const KNOWN_VERSION = 1;
export const BUILDINGS = ['temple', 'market', 'library', 'harbor', 'walls', 'mine', 'monastery', 'university', 'aqueduct', 'granary'] as const;
export type Building = (typeof BUILDINGS)[number];

const TA: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Float32Array, Float64Array, Int32Array, Int16Array, Int8Array, Uint8Array, Uint16Array, Uint32Array,
};

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function gunzip(data: Uint8Array | ArrayBuffer | Blob): Promise<string> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class SaveError extends Error {}

/** JSON 文字列 → セーブ。型付き配列を復元し、古いセーブに無い項目を既定値で埋める */
export function parseSave(text: string): { save: HSave; warnings: string[] } {
  let save: HSave;
  try {
    save = JSON.parse(text, (_k, v) => {
      if (v && typeof v === 'object' && typeof v.__ta === 'string') {
        const bytes = unb64(v.b64);
        return new TA[v.__ta](bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      }
      return v;
    });
  } catch (e) {
    throw new SaveError('セーブを読めませんでした（JSON ではありません）');
  }
  return normalizeSave(save);
}

/** セーブのオブジェクトを確かめ、古いセーブに無い項目を既定値で埋める。hist-sim から直接受け取ったセーブ（型付き配列のまま）にも使う */
export function normalizeSave(save: HSave): { save: HSave; warnings: string[] } {
  if (!save || save.format !== SAVE_FORMAT || !save.world) throw new SaveError('hist-sim のセーブではありません');
  const warnings: string[] = [];
  if (save.version > KNOWN_VERSION) warnings.push(`セーブの版数 ${save.version} は未確認です（確認済みは ${KNOWN_VERSION} まで）`);
  const w = save.world;
  for (const k of ['nations', 'provinces', 'ps', 'map', 'armies'] as const) {
    if (!w[k]) throw new SaveError(`セーブに ${k} がありません`);
  }
  // hist-sim の restore() と同じ考え方で、古いセーブに無い項目を埋める
  w.people ??= {};
  w.reigning ??= {};
  w.wars ??= [];
  w.alliances ??= {};
  w.truces ??= {};
  w.seaLinks ??= w.provinces.map(() => []);
  w.provinceName ??= w.provinces.map((p) => ({ ja: `第${p.id}領`, en: `Province ${p.id}` }));
  for (const n of w.nations) {
    if (!n) continue;
    n.overlord ??= 0;
    n.vassalKind ??= null;
    n.opinions ??= {};
    n.heir ??= null;
  }
  return { save, warnings };
}

/** .histsim ファイル（gzip）または生の .json を読む */
export async function readSaveFile(data: Uint8Array | ArrayBuffer | Blob, isPlainJson = false): Promise<{ save: HSave; warnings: string[] }> {
  let text: string;
  if (isPlainJson) text = data instanceof Blob ? await data.text() : new TextDecoder().decode(data as ArrayBuffer);
  else {
    try { text = await gunzip(data); } catch { throw new SaveError('セーブを展開できませんでした（.histsim ファイルではありません）'); }
  }
  return parseSave(text);
}

export const yearOf = (w: HWorld, tick = w.tick): number => w.startYear + Math.floor(tick / 12);
export const monthOf = (tick: number): number => (tick % 12) + 1;
export const ageOf = (p: HPerson, tick: number): number => Math.floor((tick - p.born) / 12);
export const aliveNations = (w: HWorld): HNation[] => w.nations.filter((n): n is HNation => !!n && n.dead < 0);
export function buildingsOf(bits: number): Building[] {
  return BUILDINGS.filter((_b, i) => bits & (1 << i));
}

/**
 * 舞台の外の陸：どの勢力の領もひとつも無い、陸のかたまり（日本の戦国の地図に入り込む朝鮮半島など）。
 * 戻り値は、セルごとに 1 = 舞台の外。戦略マップでは海として描き、そこにある領は遊びから外す。
 */
export function offstageCells(w: HWorld): Uint8Array {
  const m = w.map as HMap & { nbOff: Int32Array; nb: Int32Array };
  const out = new Uint8Array(m.n);
  const comp = new Int32Array(m.n).fill(-1);
  for (let s = 0; s < m.n; s++) {
    if (m.water[s] || comp[s] >= 0) continue;
    const cells = [s];
    let owned = false;
    comp[s] = s;
    for (let h = 0; h < cells.length; h++) {
      const i = cells[h], p = w.provinceOf[i];
      if (p >= 0 && (w.ps.owner[p] ?? 0) > 0) owned = true;
      for (let k = m.nbOff[i]; k < m.nbOff[i + 1]; k++) { const j = m.nb[k]; if (!m.water[j] && comp[j] < 0) { comp[j] = s; cells.push(j); } }
    }
    if (!owned) for (const i of cells) out[i] = 1;
  }
  return out;
}