// hex-sim 自身のセーブ：戦略パートの状態（docs/13_実装計画 の P12）。
// 形式の印・版数・移行の連なりは rts-mons/web/src/save.js と hist-sim/src/sim/save.ts の形にならう。
// 戦場マップを作るのに hist-sim の世界（地形）が要るので、読み込んだ hist-sim の世界もいっしょに持つ。

import type { HWorld } from '../bridge/histsim';
import type { GameStart } from '../convert/model';
import { RNG } from '../core/rng';
import type { Campaign, CampaignLog } from '../strategy/campaign';
import { validDifficulty } from '../strategy/config';
import { initScout } from '../strategy/scouting';

export const SAVE_FORMAT = 'hex-sim';
export const SAVE_VERSION = 1;
export const SLOTS = ['auto', '1', '2', '3'] as const;

export interface HexSave {
  format: string;
  version: number;
  savedAt: string;
  /** セーブ枠の一覧に出す要約 */
  summary: { world: string; year: number; month: number; faction: string; provinces: number; months: number };
  world: HWorld;
  campaign: {
    gs: GameStart;
    player: number;
    months: number;
    over: null | 'win' | 'lose';
    moved: string[];
    log: CampaignLog[];
    rng: [number, number];
    /** 以下は後から足した項目（古いセーブには無い） */
    items?: Record<string, number>;
    sieges?: Campaign['sieges'];
    reserve?: Campaign['reserve'];
    away?: Record<string, number>;
    difficulty?: Campaign['difficulty'];
    offers?: Campaign['offers'];
    wounded?: Record<string, number>;
    built?: Record<number, number>;
    relocations?: Campaign['relocations'];
    history?: Campaign['history'];
    training?: Campaign['training'];
    trainedThisMonth?: string[];
    trainBonus?: Campaign['trainBonus'];
    scout?: Campaign['scout'];
    scoutMissions?: Campaign['scoutMissions'];
    offices?: Campaign['offices'];
    resting?: Campaign['resting'];
    autoPlan?: Campaign['autoPlan'];
    chronicle?: Campaign['chronicle'];
    feats?: Campaign['feats'];
    unified?: boolean;
    realms?: Campaign['realms'];
  };
}

export class HexSaveError extends Error {}

/** ログは長くなるので、直近のぶんだけ残す */
const LOG_KEEP = 300;

export function snapshot(c: Campaign): HexSave {
  const gs = c.gs;
  const me = gs.factions[c.player];
  return {
    format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: new Date().toISOString(),
    summary: {
      world: gs.worldName.ja, year: gs.year, month: gs.month, faction: me?.name.ja ?? '観戦',
      provinces: gs.provinces.filter((p) => p.owner === c.player && c.player).length, months: c.months,
    },
    world: c.world,
    campaign: {
      gs, player: c.player, months: c.months, over: c.over, moved: [...c.moved],
      log: c.log.slice(-LOG_KEEP), rng: [c.rng.seed0, c.rng.state],
      items: c.items, sieges: c.sieges, away: c.away, difficulty: c.difficulty, offers: c.offers, wounded: c.wounded, reserve: c.reserve, built: c.built, relocations: c.relocations, history: c.history,
      training: c.training, trainedThisMonth: c.trainedThisMonth, trainBonus: c.trainBonus, scout: c.scout, scoutMissions: c.scoutMissions, offices: c.offices, resting: c.resting, autoPlan: c.autoPlan, chronicle: c.chronicle, feats: c.feats, unified: c.unified, realms: c.realms,
    },
  };
}

const MIGRATIONS: Record<number, (s: HexSave) => HexSave> = {
  // 1 -> 2: (s) => ({ ...s, ... }),
};

export function restore(s: HexSave): Campaign {
  if (!s || s.format !== SAVE_FORMAT || !s.campaign || !s.world) throw new HexSaveError('hex-sim のセーブではありません');
  if (s.version > SAVE_VERSION) throw new HexSaveError(`新しい版のセーブです（版数 ${s.version}）。このアプリを更新してください`);
  let data = s;
  for (let v = s.version; v < SAVE_VERSION; v++) data = MIGRATIONS[v]?.(data) ?? data;
  const k = data.campaign;
  const c: Campaign = {
    gs: k.gs, world: data.world, player: k.player, months: k.months, over: k.over,
    moved: new Set(k.moved), log: [...k.log], rng: RNG.restore(k.rng[0], k.rng[1]),
    items: k.items ?? {}, sieges: k.sieges ?? {}, away: k.away ?? {}, difficulty: validDifficulty(k.difficulty), offers: k.offers ?? [], wounded: k.wounded ?? {}, reserve: k.reserve ?? {}, built: k.built ?? {}, relocations: k.relocations ?? {}, history: k.history ?? { done: [] },
    training: k.training ?? {}, trainedThisMonth: k.trainedThisMonth ?? [], trainBonus: k.trainBonus ?? {}, scout: k.scout, scoutMissions: k.scoutMissions ?? [], offices: k.offices ?? {}, resting: k.resting ?? {}, autoPlan: k.autoPlan, chronicle: k.chronicle, feats: k.feats, unified: k.unified, realms: k.realms,
  };
  // 偵察度の無い古いセーブは、隣の領から始める
  if (!c.scout) initScout(c);
  return c;
}

// ---- ファイルへの書き出し：型付き配列は {__ta, b64} にして JSON に入れる（hist-sim と同じ形）

const TA: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Float32Array, Float64Array, Int32Array, Int16Array, Int8Array, Uint8Array, Uint16Array, Uint32Array,
};

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toJSON(s: HexSave): string {
  return JSON.stringify(s, (_k, v) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return { __ta: v.constructor.name, b64: b64(bytes) };
    }
    return v;
  });
}

export function fromJSON(text: string): HexSave {
  let s: HexSave;
  try {
    s = JSON.parse(text, (_k, v) => {
      if (v && typeof v === 'object' && typeof v.__ta === 'string' && TA[v.__ta]) {
        const bytes = unb64(v.b64);
        return new TA[v.__ta](bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      }
      return v;
    });
  } catch {
    throw new HexSaveError('セーブを読めませんでした（JSON ではありません）');
  }
  if (!s || s.format !== SAVE_FORMAT) throw new HexSaveError('hex-sim のセーブではありません');
  return s;
}

export function dateText(year: number, month: number): string {
  return `${year < 0 ? `前${-year + 1}` : year}年${month}月`;
}
export function summaryText(s: HexSave): string {
  const m = s.summary;
  return `${m.world} ${dateText(m.year, m.month)}　${m.faction}${m.faction === '観戦' ? '' : `（領${m.provinces}）`}　${m.months}か月経過`;
}
