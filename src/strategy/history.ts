// 史実の出来事（P26〜）：hist-sim のシナリオに入っている、まだ起きていない出来事を、hex-sim の暦で起こす。
// 出来事の年月が来て、要る勢力がそろっていれば起きる（歴史が変わって勢力が無ければ、起きない）。
// P26 では、知らせと、安全な効果だけを起こす：人物の死去・当主の死去・兵の減少・兵糧の増減・本拠の移り。
// 外交（P27）と領の動き（P28）は、いまは知らせだけ。自分の勢力にかかわる効果も、いまは知らせだけ（「あなたの家には効果なし」）。

import type { HWorld } from '../bridge/histsim';
import type { GGeneral } from '../convert/model';
import { RNG, codeToSeed } from '../core/rng';
import type { Campaign } from './campaign';

export interface HEvent { id: string; y: number; m: number; need?: string[]; do?: unknown[][]; imp?: number; at?: string; ja: string }

interface Scenario { data?: { events?: HEvent[] }; fired?: Record<string, number>; nationOf?: Record<string, number>; placeProv?: Record<string, number> }

const scenarioOf = (w: HWorld): Scenario | undefined => (w as unknown as { scenario?: Scenario }).scenario;

/** まだ起きていない史実の出来事（年月の順） */
export function pendingEvents(w: HWorld): HEvent[] {
  const sc = scenarioOf(w);
  if (!sc?.data?.events) return [];
  const fired = sc.fired ?? {};
  return sc.data.events.filter((e) => !(e.id in fired)).sort((a, b) => a.y - b.y || a.m - b.m);
}

/** まだ起こさない、領の動きと外交（P27・P28 で起こす） */
const LATER_OPS = new Set(['annex', 'cede', 'partition', 'rise', 'strip', 'free', 'war', 'ally', 'unally', 'vassal', 'truce']);

/** P26 で効果を起こす種類（ほかは知らせだけ） */
export const APPLIED_OPS = new Set(['dies', 'rulerDies', 'army', 'add', 'capital', 'battle']);

export interface HistoryHooks {
  /** 武将が世を去る（当主なら代替わりまで） */
  dies: (g: GGeneral) => void;
  note: (key: string, vars: Record<string, string | number>) => void;
}

/** その月の史実の出来事を起こす。起きた（または、もう起きようがない）出来事は done に入れて、二度と見ない */
export function historyMonth(c: Campaign, hooks: HistoryHooks): void {
  const gs = c.gs, sc = scenarioOf(c.world);
  if (!sc) return;
  const nationOf = sc.nationOf ?? {}, placeProv = sc.placeProv ?? {};
  const done = new Set(c.history.done);
  const now = gs.year * 12 + gs.month;
  const fid = (key: string) => nationOf[key];
  for (const ev of pendingEvents(c.world)) {
    if (done.has(ev.id)) continue;
    if (ev.y * 12 + ev.m > now) break;
    done.add(ev.id);
    // 始めた年月より前の出来事（hist-sim でも起きなかったもの）は、いまさら起こさない
    if (c.history.from !== undefined && ev.y * 12 + ev.m < c.history.from) continue;
    // 要る勢力がそろっていなければ、歴史が変わったので起きない
    if ((ev.need ?? []).some((k) => !gs.factions[fid(k)])) continue;
    const rng = new RNG(codeToSeed(`${gs.seed}:history:${ev.id}`));
    const effects: string[] = [];
    let playerSpared = false;
    // 領の動き・外交は、まだ起こさない（知らせに書き添える）
    const later = (ev.do ?? []).some((op) => LATER_OPS.has(String((op as unknown[])[0])));
    for (const op of ev.do ?? []) {
      const [kind, ...args] = op as [string, ...unknown[]];
      if (!APPLIED_OPS.has(kind)) continue;
      const realm = typeof args[0] === 'string' ? gs.factions[fid(args[0])] : undefined;
      if (realm && realm.id === c.player && kind !== 'battle') { playerSpared = true; continue; }
      switch (kind) {
        case 'dies': {
          const name = String(args[0]);
          const g = Object.values(gs.generals).find((x) => x.name.ja === name);
          if (!g) break;
          if (g.faction === c.player && c.player) { playerSpared = true; break; }
          hooks.dies(g);
          effects.push(`${name}が世を去った`);
          break;
        }
        case 'rulerDies': {
          const lord = realm ? gs.generals[realm.lordId] : undefined;
          if (!lord) break;
          hooks.dies(lord);
          effects.push(`${lord.name.ja}が世を去った`);
          break;
        }
        case 'army': {
          if (!realm) break;
          const keep = Math.max(0, Math.min(1, Number(args[1])));
          let lost = 0;
          for (const g of Object.values(gs.generals).filter((x) => x.faction === realm.id)) {
            const n = g.troops.length, k = Math.round(n * keep);
            for (let i = n - 1; i >= k; i--) { g.troops.splice(rng.int(0, g.troops.length - 1), 1); lost++; }
          }
          if (lost) effects.push(`${realm.name.ja}の兵が${lost}隊減った`);
          break;
        }
        case 'add': {
          if (!realm || args[1] !== 'treasury') break;
          const v = Math.round(Number(args[2]));
          realm.supply = Math.max(0, realm.supply + v);
          effects.push(`${realm.name.ja}の兵糧が${v >= 0 ? '+' : ''}${v}`);
          break;
        }
        case 'capital': {
          const prov = placeProv[String(args[1])];
          if (!realm || prov === undefined || gs.provinces[prov]?.owner !== realm.id || realm.capital === prov) break;
          realm.capital = prov;
          effects.push(`${realm.name.ja}は本拠を${gs.provinces[prov].name.ja}へ移した`);
          break;
        }
        case 'battle': break;
      }
    }
    hooks.note('history', { text: historyText(c, ev, nationOf), effects: effects.join('・'), spared: playerSpared ? 1 : 0, later: later ? 1 : 0, imp: ev.imp ?? 1, y: ev.y, m: ev.m });
  }
  c.history.done = [...done];
}

/** 出来事の本文：{n_家}は勢力の名前、{r_家}は当主の名前、[[p:名|見出し]] は見出し（無ければ名） */
export function historyText(c: Campaign, ev: HEvent, nationOf: Record<string, number>): string {
  const gs = c.gs;
  return ev.ja
    .replace(/\{([nr])_(\w+)\}/g, (_m, kind: string, key: string) => {
      const f = gs.factions[nationOf[key]];
      if (!f) return key;
      return kind === 'r' ? gs.generals[f.lordId]?.name.ja ?? f.name.ja : f.name.ja;
    })
    .replace(/\[\[\w+:([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_m, name: string, label?: string) => label ?? name);
}
