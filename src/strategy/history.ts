// 史実の出来事（P26〜）：hist-sim のシナリオに入っている、まだ起きていない出来事を、hex-sim の暦で起こす。
// 出来事の年月が来て、要る勢力がそろっていれば起きる（歴史が変わって勢力が無ければ、起きない）。
// P26：知らせと、安全な効果（人物の死去・当主の死去・兵の減少・兵糧の増減・本拠の移り）。
// P27：外交（戦・停戦・同盟・同盟の解消・従属・独り立ち・名の改め）。自分の家が受ける側の停戦・同盟・従属は、申し込みとして届く。
//      自分の家が仕掛ける側の戦、自分の家が他家に従うこと、自分の家の名の改めは起こさない（「あなたの家には効果なし」）。
// P28：領の動き（割譲・併合・領を削る・分裂・独立）。新しく起きる家は、シナリオの家の決まり（名・色・本拠・当主の系図）から作る。
//      自分の家にかかわるときは、受けるか断るかを選ぶ（HistoryChoice）。得るものは断れば何も起きない。
//      失うものは、断ると相手の家と戦になる（相手が新しく起きる家なら、その領の不満が上がる）。併せられるのを受けると、滅ぶ代わりに相手に従う。

import type { Government, HWorld, Name } from '../bridge/histsim';
import { makeOfficer, makeTroop, startLevel } from '../convert/convert';
import type { GFaction, GGeneral } from '../convert/model';
import { RNG, codeToSeed } from '../core/rng';
import { D } from '../data/db';
import { absorb, declareWar, handOver, note, provincesOf, relation, type Campaign, type HistoryChoice } from './campaign';
import { S } from './config';
import { leaveWar, makeTruce } from './events';

export interface HEvent { id: string; y: number; m: number; need?: string[]; do?: unknown[][]; imp?: number; at?: string; ja: string }

/** シナリオの家の決まり。line は当主の系図：[名, 英名, 始めの年, 終わりの年, { ab, tr, born }] */
interface HRealm {
  id: string; label: Name; root?: Name; gov?: string; color?: string; capital?: string; places?: string[]; house?: Name; parent?: string;
  line?: [string, string, number, number, { ab?: [number, number, number, number]; tr?: string[]; born?: number }?][];
}
/** シナリオの人物：[名, 英名, 家, 役目, 生まれ, 没年, { from }] */
type HPeopleRow = [string, string, string, string, number, number, { from?: number }?];

interface Scenario {
  data?: { events?: HEvent[]; realms?: HRealm[]; people?: HPeopleRow[]; bc?: boolean };
  fired?: Record<string, number>; nationOf?: Record<string, number>; placeProv?: Record<string, number>;
}

const scenarioOf = (w: HWorld): Scenario | undefined => (w as unknown as { scenario?: Scenario }).scenario;

/**
 * シナリオの年を、ゲームの暦の年にする。紀元前のシナリオ（bc）は、年を紀元前の年数で書いている（前216年 = 216）。
 * ゲームの暦は天文学の数え方（前1年 = 0、前216年 = -215）
 */
const gameYear = (sc: Scenario | undefined, y: number): number => (sc?.data?.bc ? 1 - y : y);
/** 出来事の月（ゲームの暦の 年×12+月）。月の書かれていない出来事は、その年の1月 */
export const eventMonth = (sc: Scenario | undefined, e: HEvent): number => gameYear(sc, e.y) * 12 + (e.m ?? 1);

/** まだ起きていない史実の出来事（年月の順） */
export function pendingEvents(w: HWorld): HEvent[] {
  const sc = scenarioOf(w);
  if (!sc?.data?.events) return [];
  const fired = sc.fired ?? {};
  return sc.data.events.filter((e) => !(e.id in fired)).sort((a, b) => eventMonth(sc, a) - eventMonth(sc, b));
}

/** 領の動き（P28） */
export const TERRITORY_OPS = new Set(['annex', 'cede', 'partition', 'rise', 'strip']);

/** 外交（P27） */
export const DIPLOMACY_OPS = new Set(['war', 'truce', 'ally', 'unally', 'vassal', 'free', 'relabel']);
/** 史実の停戦の長さ（か月）の上限 */
const TRUCE_MAX_MONTHS = 120;

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
  // 出来事で新しく起きた家を先に見る
  const fid = (key: string): number => c.history.nations?.[key] ?? nationOf[key];
  // 選ばずに月が過ぎた領の動きは、断ったことにする
  for (const ch of [...(c.history.choices ?? [])]) if (ch.until <= gs.tick) chooseHistory(c, ch.id, false);
  for (const ev of pendingEvents(c.world)) {
    if (done.has(ev.id)) continue;
    const when = eventMonth(sc, ev);
    if (when > now) break;
    done.add(ev.id);
    // 始めた年月より前の出来事（hist-sim でも起きなかったもの）は、いまさら起こさない
    if (c.history.from !== undefined && when < c.history.from) continue;
    // 要る勢力がそろっていなければ、歴史が変わったので起きない
    if ((ev.need ?? []).some((k) => !gs.factions[fid(k)])) continue;
    const rng = new RNG(codeToSeed(`${gs.seed}:history:${ev.id}`));
    const effects: string[] = [];
    let playerSpared = false, choice = false;
    const text = historyText(c, ev, nationOf);
    for (const [n, op] of (ev.do ?? []).entries()) {
      const [kind, ...args] = op as [string, ...unknown[]];
      if (DIPLOMACY_OPS.has(kind)) {
        const r = diplomacy(c, kind, args, fid);
        if (r === SPARED) playerSpared = true;
        else if (r) effects.push(r);
        continue;
      }
      if (TERRITORY_OPS.has(kind)) {
        const r = territory(c, { id: `${ev.id}:${n}`, text, kind, args, fid, placeProv, sc, rng });
        effects.push(...r.effects);
        if (r.choice) choice = true;
        continue;
      }
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
    hooks.note('history', { text: historyText(c, ev, nationOf), effects: effects.join('・'), spared: playerSpared ? 1 : 0, choice: choice ? 1 : 0, imp: ev.imp ?? 1, y: ev.y, m: ev.m ?? 1 });
  }
  c.history.done = [...done];
}

const SPARED = Symbol('spared');

/**
 * 外交の出来事を1つ起こす。起きたことの短い文（知らせに添える）、起きなかったら null、
 * 自分の家にかかわるので起こさなかったら SPARED を返す
 */
function diplomacy(c: Campaign, kind: string, args: unknown[], fid: (key: string) => number | undefined): string | typeof SPARED | null {
  const gs = c.gs, me = c.player;
  const F = (k: unknown): GFaction | undefined => (typeof k === 'string' ? gs.factions[fid(k) ?? -1] : undefined);
  const a = F(args[0]), b = F(args[1]);
  if (!a) return null;
  if (kind === 'relabel') {
    const name = args[1] as Partial<Name> | undefined;
    if (!name?.ja || a.name.ja === name.ja) return null;
    if (a.id === me) return SPARED;
    const old = a.name.ja;
    a.name = { ja: name.ja, en: name.en ?? a.name.en };
    return `${old}は名を${name.ja}と改めた`;
  }
  if (kind === 'free') {
    const lord = gs.factions[a.overlord];
    if (!a.overlord) return null;
    a.overlord = 0;
    return `${a.name.ja}は${lord?.name.ja ?? '宗主'}の下を離れた`;
  }
  if (!b || a.id === b.id) return null;
  const rel = relation(c, a.id, b.id), mine = a.id === me || b.id === me, other = a.id === me ? b : a;
  const offer = (k: 'alliance' | 'truce' | 'vassal', months?: number): string => {
    c.offers = c.offers.filter((o) => o.from !== other.id);
    c.offers.push({ kind: k, from: other.id, until: gs.tick + S.diplomacy.offerMonths, hist: 1, ...(months ? { months } : {}) });
    return `${other.name.ja}からあなたの家へ${{ alliance: '同盟', truce: '停戦', vassal: '従属' }[k]}の申し込みが来た`;
  };
  const isPair = (x: number, y: number) => (x === a.id && y === b.id) || (x === b.id && y === a.id);
  /** 2家の約束（同盟・停戦・従属）をほどく */
  const unbind = (): void => {
    gs.alliances = gs.alliances.filter(([x, y]) => !isPair(x, y));
    gs.truces = gs.truces.filter((t) => !isPair(t.a, t.b));
    if (a.overlord === b.id) a.overlord = 0;
    if (b.overlord === a.id) b.overlord = 0;
  };
  switch (kind) {
    case 'war': {
      // 自分の家が仕掛ける戦は、自分で決める
      if (a.id === me) return SPARED;
      if (rel === 'war') return null;
      unbind();
      if (!declareWar(c, a.id, b.id)) return null;
      const name = (args[2] as Partial<Name> | undefined)?.ja;
      return name ? `${name}が始まった（${a.name.ja}と${b.name.ja}）` : `${a.name.ja}と${b.name.ja}の戦が始まった`;
    }
    case 'truce': {
      if (rel !== 'war') return null;
      const months = Math.min(TRUCE_MAX_MONTHS, Math.max(1, Math.round(Number(args[2]) || 1) * 12));
      if (mine) return offer('truce', months);
      makeTruce(c, a.id, b.id, months);
      return `${a.name.ja}と${b.name.ja}が停戦した（${months}か月）`;
    }
    case 'ally': {
      if (rel === 'ally') return null;
      if (mine) return rel === 'neutral' ? offer('alliance') : SPARED;
      leaveWar(c, a.id, b.id);
      unbind();
      if (relation(c, a.id, b.id) !== 'neutral') return null;
      gs.alliances.push([a.id, b.id]);
      return `${a.name.ja}と${b.name.ja}が同盟を結んだ`;
    }
    case 'unally': {
      const n = gs.alliances.length;
      gs.alliances = gs.alliances.filter(([x, y]) => !isPair(x, y));
      return gs.alliances.length < n ? `${a.name.ja}と${b.name.ja}の同盟が解けた` : null;
    }
    case 'vassal': {
      // a が宗主、b が従う側。自分の家が他家に従うことは起こさない
      if (b.id === me) return SPARED;
      if (b.overlord === a.id) return null;
      if (a.id === me) return offer('vassal');
      leaveWar(c, a.id, b.id);
      unbind();
      b.overlord = a.id;
      return `${b.name.ja}は${a.name.ja}に従った`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- 領の動き（P28）

const H = S.history;
const GOVERNMENTS = new Set<string>(['tribe', 'chiefdom', 'monarchy', 'empire', 'republic', 'theocracy']);

interface RealmCtx { fid: (key: string) => number; placeProv: Record<string, number>; sc: Scenario; rng: RNG }
interface TerritoryCtx extends RealmCtx { id: string; text: string; kind: string; args: unknown[] }

const realmDef = (sc: Scenario, key: string): HRealm | undefined => sc.data?.realms?.find((r) => r.id === key);
const hexColor = (s: string | undefined): [number, number, number] | undefined => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s ?? '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : undefined;
};
const provNames = (c: Campaign, ids: number[]): string => ids.map((i) => c.gs.provinces[i].name.ja).join('・');

/** 2家の約束（同盟・停戦・従属）をほどく */
function unbindPair(c: Campaign, a: number, b: number): void {
  const gs = c.gs, isPair = (x: number, y: number) => (x === a && y === b) || (x === b && y === a);
  gs.alliances = gs.alliances.filter(([x, y]) => !isPair(x, y));
  gs.truces = gs.truces.filter((t) => !isPair(t.a, t.b));
  if (gs.factions[a]?.overlord === b) gs.factions[a].overlord = 0;
  if (gs.factions[b]?.overlord === a) gs.factions[b].overlord = 0;
}

/** 領の動きを1つ起こす。自分の家にかかわる部分は、選ぶ欄（c.history.choices）に回す */
function territory(c: Campaign, t: TerritoryCtx): { effects: string[]; choice: boolean } {
  const gs = c.gs, me = c.player, out: string[] = [];
  let choice = false, k = 0;
  const F = (key: unknown): GFaction | undefined => (typeof key === 'string' ? gs.factions[t.fid(key)] : undefined);
  const provsOf = (places: unknown): number[] => (Array.isArray(places)
    ? [...new Set(places.map((p) => t.placeProv[String(p)]).filter((id): id is number => id !== undefined && !!gs.provinces[id] && !gs.provinces[id].out))]
    : []);
  const isMine = (p: number): boolean => !!me && gs.provinces[p].owner === me;
  const ask = (ch: Omit<HistoryChoice, 'id' | 'text' | 'until'>, line: string): void => {
    (c.history.choices ??= []).push({ ...ch, id: `${t.id}:${k++}`, text: t.text, until: gs.tick + H.choiceMonths });
    out.push(line);
    choice = true;
  };
  /** 領を to へ渡す。自分の家の領は、渡すかどうかを選ぶ。自分の家が受け取るときも選ぶ */
  const give = (provs: number[], to: GFaction): void => {
    const mine = provs.filter(isMine), rest = provs.filter((p) => !isMine(p) && gs.provinces[p].owner !== to.id);
    if (to.id === me) {
      if (rest.length) ask({ kind: 'give', provs: rest, to: me }, `あなたの家に${provNames(c, rest)}が渡されようとしている`);
      return;
    }
    if (rest.length) {
      const moved = handOver(c, rest, to.id);
      if (moved.length) out.push(`${provNames(c, moved)}は${to.name.ja}のものになった`);
    }
    if (mine.length) ask({ kind: 'cede', provs: mine, to: to.id }, `${to.name.ja}があなたの家に${provNames(c, mine)}を求めている`);
  };
  switch (t.kind) {
    case 'cede': {
      // 渡す側が「*」なら、だれの領でも
      const from = t.args[0] === '*' ? undefined : F(t.args[0]), to = F(t.args[1]);
      if (!to || (t.args[0] !== '*' && !from)) break;
      give(provsOf(t.args[2]).filter((p) => !from || gs.provinces[p].owner === from.id), to);
      break;
    }
    case 'strip': {
      // 残す領のほかは、すべて to へ
      const from = F(t.args[0]), to = F(t.args[1]);
      if (!from || !to || from.id === to.id) break;
      const keep = new Set(provsOf(t.args[2]));
      give(provincesOf(c, from.id).map((p) => p.id).filter((p) => !keep.has(p)), to);
      break;
    }
    case 'annex': {
      const a = F(t.args[0]), b = F(t.args[1]);
      if (!a || !b || a.id === b.id) break;
      if (b.id === me) { ask({ kind: 'annex', provs: [], to: a.id }, `${a.name.ja}があなたの家を併せようとしている`); break; }
      if (a.id === me) { ask({ kind: 'absorb', provs: [], from: b.id }, `${b.name.ja}をあなたの家に併せられる`); break; }
      const name = b.name.ja;
      if (absorb(c, a.id, b.id)) out.push(`${a.name.ja}が${name}を併せた`);
      break;
    }
    case 'partition': {
      // 本家（parent）から、新しい家がそれぞれの本拠と領を持って分かれる。本家には少なくとも1つ領を残す
      const parent = F(t.args[0]);
      if (!parent) break;
      for (const key of (Array.isArray(t.args[1]) ? t.args[1] : []).map(String)) {
        const def = realmDef(t.sc, key);
        if (!def) continue;
        const provs = provsOf([def.capital, ...(def.places ?? [])]).filter((p) => gs.provinces[p].owner === parent.id);
        if (provs.length && provs.length >= provincesOf(c, parent.id).length) provs.splice(Math.max(0, provs.indexOf(parent.capital)), 1);
        if (!provs.length) continue;
        if (parent.id === me) { ask({ kind: 'rise', provs, key, parent: me }, `あなたの家の${provNames(c, provs)}から${def.label.ja}が分かれて立とうとしている`); continue; }
        const id = createRealm(c, t, key, provs, false);
        if (id) out.push(`${parent.name.ja}から${gs.factions[id].name.ja}が分かれた（${provNames(c, provs)}）`);
      }
      break;
    }
    case 'rise': {
      // 新しい家が、領を奪って起こる（奪われた家とは戦になる）
      const key = String(t.args[0]), def = realmDef(t.sc, key), provs = provsOf(t.args[1]);
      if (!provs.length) break;
      const mine = provs.filter(isMine), rest = provs.filter((p) => !isMine(p));
      let id: number | null = null;
      if (rest.length) {
        id = createRealm(c, t, key, rest, true);
        if (id) out.push(`${gs.factions[id].name.ja}が起こった（${provNames(c, rest)}）`);
      }
      if (!mine.length) break;
      if (id && gs.factions[id]) ask({ kind: 'cede', provs: mine, to: id }, `${gs.factions[id].name.ja}があなたの家の${provNames(c, mine)}に加わろうとしている`);
      else if (def || gs.factions[t.fid(key)]) ask({ kind: 'rise', provs: mine, key, parent: me }, `あなたの家の${provNames(c, mine)}で${def?.label.ja ?? key}が起ころうとしている`);
      break;
    }
  }
  return { effects: out, choice };
}

/**
 * 新しい家を起こし、領を渡す。シナリオの家の決まりから、名・色・本拠・当主（系図のその年の人）を作る。
 * 当主が武将としていれば（他家の当主でなければ）その武将が立つ。いなければ新しく作り、兵を持たせる。
 * シナリオでその家に属する人物が武将としていれば加わる（自分の家の武将は除く）。rebel なら、領を奪われた家と戦になる。
 * その家がもうあれば、領を渡すだけ。
 */
function createRealm(c: Campaign, t: RealmCtx, key: string, provs: number[], rebel: boolean): number | null {
  const gs = c.gs, have = gs.factions[t.fid(key)];
  const losers = [...new Set(provs.map((p) => gs.provinces[p].owner).filter((o) => o && o !== have?.id))];
  if (have) {
    handOver(c, provs, have.id);
    if (rebel) for (const l of losers) if (gs.factions[l]) declareWar(c, have.id, l);
    return have.id;
  }
  const def = realmDef(t.sc, key);
  const parent = gs.factions[losers[0]] ?? gs.factions[t.fid(def?.parent ?? '')];
  if (!def || !parent || !provs.length) return null;
  const used = [...Object.keys(gs.factions).map(Number), ...Object.values(t.sc.nationOf ?? {}), ...Object.values(c.history.nations ?? {})];
  const id = Math.max(0, ...used) + 1;
  const capProv = t.placeProv[def.capital ?? ''];
  const capital = provs.includes(capProv) ? capProv : provs[0];
  const f: GFaction = {
    id, name: def.label, color: hexColor(def.color) ?? parent.color,
    government: (GOVERNMENTS.has(def.gov ?? '') ? def.gov : parent.government) as Government, economy: parent.economy,
    capital, overlord: 0, supply: H.newRealmSupply, income: 0, lordId: '', tech: parent.tech, prestige: 0, stability: parent.stability,
    reforms: [], opinions: {}, recruit: { ...parent.recruit }, troopLevel: parent.troopLevel,
  };
  gs.factions[id] = f;
  (c.history.nations ??= {})[key] = id;
  handOver(c, provs, id);
  // 当主：系図のその年の人（系図が無ければ、家の名の長）
  const year = gs.year, line = def.line ?? [];
  const row = line.find((r) => { const a = gameYear(t.sc, r[2]), b = gameYear(t.sc, r[3]); return Math.min(a, b) <= year && year <= Math.max(a, b); }) ?? line[0];
  let g = row ? Object.values(gs.generals).find((x) => x.name.ja === row[0] && !x.isLord && !(c.player && x.faction === c.player)) : undefined;
  if (g) { g.faction = id; g.prov = capital; delete c.away[g.id]; }
  else {
    const rec = row?.[4] ?? {};
    const age = rec.born !== undefined ? Math.max(16, year - gameYear(t.sc, rec.born)) : 35;
    const root = def.root ?? def.label;
    let gid = `h${id}`;
    while (gs.generals[gid]) gid += '_';
    g = makeOfficer(gs, gid, row ? { ja: row[0], en: row[1] } : { ja: `${root.ja}の長`, en: `Leader of ${root.en}` }, id, capital,
      startLevel(H.newRealmFame, age, true), rec.tr ?? [], { ab: rec.ab, age, fame: H.newRealmFame, house: def.house });
  }
  g.isLord = true; g.role = 'ruler';
  f.lordId = g.id;
  // 当主の兵（采配力の内で）
  const want = Math.max(H.newRealmTroopsMin, Math.min(H.newRealmTroopsMax, provs.length * H.newRealmTroopsPerProv));
  const pool = Object.entries(f.recruit).filter(([u, w]) => D.byUnit[u] && w > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = pool.reduce((s, [, w]) => s + w, 0);
  for (let i = g.troops.length; i < want && total > 0; i++) {
    let r = t.rng.float() * total, unit = pool[0][0];
    for (const [u, w] of pool) { r -= w; if (r <= 0) { unit = u; break; } }
    if (g.troops.reduce((s, x) => s + D.byUnit[x.unitId].cost, 0) + D.byUnit[unit].cost > g.command) break;
    g.troops.push(makeTroop(D.byUnit[unit], f.troopLevel));
  }
  // その家の人物
  for (const p of t.sc.data?.people ?? []) {
    if (p[2] !== key) continue;
    const o = Object.values(gs.generals).find((x) => x.name.ja === p[0] && !x.isLord && x.faction !== id && !(c.player && x.faction === c.player));
    if (o) { o.faction = id; o.prov = capital; delete c.away[o.id]; }
  }
  if (rebel) for (const l of losers) if (gs.factions[l]) declareWar(c, id, l);
  return id;
}

/** 選ぶ欄の1行：何が起ころうとしているか */
export function choiceLine(c: Campaign, ch: HistoryChoice): string {
  const gs = c.gs, other = gs.factions[ch.to ?? ch.from ?? -1]?.name.ja ?? '相手', ps = provNames(c, ch.provs.filter((p) => gs.provinces[p]));
  const sc = scenarioOf(c.world);
  switch (ch.kind) {
    case 'give': return `${ps}をあなたの家が受け取れる`;
    case 'cede': return `${other}があなたの家に${ps}を求めている`;
    case 'rise': return `あなたの家の${ps}が、${(sc && ch.key ? realmDef(sc, ch.key)?.label.ja : undefined) ?? '新しい家'}として分かれようとしている`;
    case 'annex': return `${other}があなたの家を併せようとしている`;
    case 'absorb': return `${other}をあなたの家に併せられる`;
  }
}

/** 受けたとき・断ったときに起きること */
export function choiceOutcome(c: Campaign, ch: HistoryChoice, yes: boolean): string {
  const other = c.gs.factions[ch.to ?? ch.from ?? -1]?.name.ja ?? '相手';
  switch (ch.kind) {
    case 'give': return yes ? '領があなたの家のものになります。' : '何も起きません。';
    case 'absorb': return yes ? `${other}の領と武将が、あなたの家のものになります。` : '何も起きません。';
    case 'cede': return yes ? `領が${other}のものになります（本拠だけは残ります）。` : `${other}の心証が${-H.refuseOpinion}下がり、${other}と戦になります。`;
    case 'rise': return yes ? '領が新しい家のものになります（本拠だけは残ります）。' : `新しい家は立ちませんが、その領の不満が${H.refuseUnrest}上がります。`;
    case 'annex': return yes ? `家は滅びず、${other}に従います（従う家とは攻め合えません）。` : `${other}の心証が${-H.refuseOpinion}下がり、${other}と戦になります。`;
  }
}

/**
 * 自分の家にかかわる領の動きを、受けるか断るか。
 * 断ると：領を求めた家とは戦になり、心証が下がる。新しく起きる家を断ると、その領の不満が上がる。得るものを断っても何も起きない
 */
export function chooseHistory(c: Campaign, id: string, yes: boolean): boolean {
  const gs = c.gs, list = c.history.choices ?? [], ch = list.find((x) => x.id === id), me = c.player, mf = gs.factions[me];
  if (!ch) return false;
  c.history.choices = list.filter((x) => x !== ch);
  if (!mf) return false;
  const other = gs.factions[ch.to ?? ch.from ?? -1];
  const mine = ch.provs.filter((p) => gs.provinces[p]?.owner === me);
  // 自分の領を全部は渡さない（本拠は残す）
  const spare = (ps: number[]): number[] => (ps.length >= provincesOf(c, me).length ? ps.filter((p) => p !== mf.capital) : ps);
  const refuse = (who: GFaction | undefined): string => {
    if (!who || who.id === me) return '';
    who.opinions[me] = Math.max(-100, (who.opinions[me] ?? 0) + H.refuseOpinion);
    if (relation(c, me, who.id) !== 'war') { unbindPair(c, me, who.id); declareWar(c, who.id, me); }
    return `${who.name.ja}と戦になった`;
  };
  let result = '';
  switch (ch.kind) {
    case 'give': {
      if (!yes) { result = '領を受け取るのを断った'; break; }
      const moved = handOver(c, ch.provs.filter((p) => gs.provinces[p] && gs.provinces[p].owner !== me), me);
      result = moved.length ? `${provNames(c, moved)}を受け取った` : '受け取れる領が無かった';
      break;
    }
    case 'cede': {
      if (yes && other) { const moved = handOver(c, spare(mine), other.id); result = moved.length ? `${provNames(c, moved)}を${other.name.ja}に渡した` : '渡す領が無かった'; }
      else result = `${provNames(c, mine) || '領'}を渡すのを断った。${refuse(other)}`;
      break;
    }
    case 'rise': {
      const ps = spare(mine);
      if (yes && ch.key && ps.length) {
        const sc = scenarioOf(c.world) ?? {};
        const nationOf = sc.nationOf ?? {};
        const nid = createRealm(c, { fid: (k) => c.history.nations?.[k] ?? nationOf[k], placeProv: sc.placeProv ?? {}, sc, rng: new RNG(codeToSeed(`${gs.seed}:choice:${id}`)) }, ch.key, ps, false);
        result = nid ? `${provNames(c, ps)}は${gs.factions[nid].name.ja}として立った` : '新しい家は立たなかった';
      } else {
        for (const p of mine) gs.provinces[p].unrest = Math.min(100, gs.provinces[p].unrest + H.refuseUnrest);
        result = `${provNames(c, mine) || '領'}が分かれるのを認めなかった（不満+${H.refuseUnrest}）`;
      }
      break;
    }
    case 'annex': {
      if (yes && other) { leaveWar(c, me, other.id); unbindPair(c, me, other.id); mf.overlord = other.id; result = `${other.name.ja}に従った`; }
      else result = `${other?.name.ja ?? '相手'}に併せられるのを断った。${refuse(other)}`;
      break;
    }
    case 'absorb': {
      const name = other?.name.ja ?? '';
      result = yes && other && absorb(c, me, other.id) ? `${name}を併せた` : `${name}を併せるのをやめた`;
      break;
    }
  }
  note(c, 'historyChoice', { result });
  return true;
}

/** 出来事の本文：{n_家}は勢力の名前、{r_家}は当主の名前、[[p:名|見出し]] は見出し（無ければ名） */
export function historyText(c: Campaign, ev: HEvent, nationOf: Record<string, number>): string {
  const gs = c.gs, sc = scenarioOf(c.world);
  return ev.ja
    .replace(/\{([nr])_(\w+)\}/g, (_m, kind: string, key: string) => {
      const f = gs.factions[c.history.nations?.[key] ?? nationOf[key]];
      // もう無い家（この出来事で併せられた、など）は、シナリオの家の名で呼ぶ
      if (!f) return (sc && realmDef(sc, key)?.label.ja) ?? key;
      return kind === 'r' ? gs.generals[f.lordId]?.name.ja ?? f.name.ja : f.name.ja;
    })
    .replace(/\[\[\w+:([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_m, name: string, label?: string) => label ?? name);
}
