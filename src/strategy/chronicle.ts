// 年表（P57）：自分の家の歩みを書き留める（起った日・攻め取った領・奪われた領・滅ぼした家・開戦・同盟・停戦・本拠の移り・当主の交代・史実の出来事）。
// 天下を統一したときに、年表と功臣を発表する。記録（c.log）はセーブで直近だけに切り詰めるので、年表は別に持つ。

import type { Campaign, CampaignLog } from './campaign';

export type ChronKind = 'start' | 'capture' | 'lost' | 'fall' | 'war' | 'ally' | 'truce' | 'capital' | 'lord' | 'history' | 'unify' | 'captive' | 'diverge';
export interface ChronEntry { year: number; month: number; kind: ChronKind; text: string; provs?: number }
/** 武将ごとの戦の数・勝った数・倒した敵将の数（功臣を決める） */
export interface Feat { battles: number; wins: number; foes: number }

const dateOf = (c: Campaign): { year: number; month: number } => ({ year: c.gs.year, month: c.gs.month });
const myProvs = (c: Campaign): number => c.gs.provinces.filter((p) => p.owner === c.player && !p.out).length;

export function chron(c: Campaign, kind: ChronKind, text: string): void {
  if (!c.player) return;
  (c.chronicle ??= []).push({ ...dateOf(c), kind, text, provs: myProvs(c) });
}

/** 家が起った日（年表が無いときだけ） */
export function startChronicle(c: Campaign): void {
  const me = c.gs.factions[c.player];
  if (!me || c.chronicle?.length) return;
  const cap = c.gs.provinces[me.capital];
  chron(c, 'start', `${me.name.ja}、${cap?.name.ja ?? ''}を本拠に、${myProvs(c)}の領をもって天下をめざす`);
}

/** 記録の1件から、自分の家に関わるものを年表へ写す（note から呼ぶ） */
export function chronFromLog(c: Campaign, e: CampaignLog): void {
  const me = c.gs.factions[c.player]?.name.ja;
  if (!me) return;
  const v = e.vars, s = (k: string): string => String(v[k] ?? '');
  switch (e.key) {
    case 'capture':
      if (s('faction') === me) chron(c, 'capture', `${s('prov')}を${s('from') || '在地の兵'}から攻め取る`);
      else if (s('from') === me) chron(c, 'lost', `${s('prov')}を${s('faction')}に奪われる`);
      break;
    case 'chainCapture':
      if (s('faction') === me) chron(c, 'capture', `勢いに乗り、${s('from')}の${s('provs')}も一気に取る`);
      else if (s('from') === me) chron(c, 'lost', `${s('faction')}の勢いに押され、${s('provs')}も失う`);
      break;
    case 'fall':
      if (s('by') === me) chron(c, 'fall', `${s('faction')}を滅ぼす`);
      break;
    case 'war':
      if (s('a') === me) chron(c, 'war', `${s('b')}に戦を仕掛ける`);
      else if (s('b') === me) chron(c, 'war', `${s('a')}が攻めかかってくる`);
      break;
    case 'alliance':
      if (s('a') === me || s('b') === me) chron(c, 'ally', `${s('a') === me ? s('b') : s('a')}と同盟を結ぶ`);
      break;
    case 'truce':
      if (s('a') === me || s('b') === me) chron(c, 'truce', `${s('a') === me ? s('b') : s('a')}と停戦する`);
      break;
    case 'vassal':
      if (s('lord') === me) chron(c, 'ally', `${s('faction')}が従属する`);
      break;
    case 'capitalMoved':
      if (s('faction') === me) chron(c, 'capital', `本拠を${s('prov')}へ移す`);
      break;
    case 'succeed': case 'newLord':
      if (s('faction') === me) chron(c, 'lord', `${s('name')}が当主となる`);
      break;
    case 'abdicate':
      if (s('faction') === me) chron(c, 'lord', `${s('late')}が隠居し、${s('name')}が当主となる（譲り）`);
      break;
    // 捕虜（P72）
    case 'captured':
      if (s('by') === me) chron(c, 'captive', `${s('from')}の${s('name')}${s('lord')}を捕らえる`);
      else if (s('from') === me) chron(c, 'captive', `${s('name')}${s('lord')}が${s('by')}に捕らえられる`);
      break;
    case 'captiveRecruit': if (s('by') === me) chron(c, 'captive', `${s('name')}（もと${s('from')}）を家臣とする`); break;
    case 'captiveExecute':
      if (s('by') === me) chron(c, 'captive', `捕虜の${s('name')}${s('lord')}を処断する`);
      else if (s('from') === me) chron(c, 'captive', `${s('name')}${s('lord')}が${s('by')}に処断される`);
      break;
    case 'captiveRelease': if (s('by') === me) chron(c, 'captive', `捕虜の${s('name')}を解き放つ`); break;
    // 兆し（P74）
    case 'omenAverted': chron(c, 'diverge', `${s('name')}、${s('cause')}の難を逃れる（史実と違う道）`); break;
    case 'omenFell': chron(c, 'history', `${s('name')}、史実どおり${s('cause')}により世を去る`); break;
    // 史実の合戦（P75）
    case 'histBattleResult': chron(c, 'history', `${s('name')}を戦い、${s('foe')}に${s('result')}`); break;
    case 'histBattleDiverged': chron(c, 'diverge', `${s('name')}、史実と逆の結果（史実と違う道）`); break;
    // 史実の目標（P76）
    case 'histGoalDone': chron(c, 'history', `史実どおり${s('name')}を果たす（${s('target')}の領を取る）`); break;
    case 'imaArrive': chron(c, 'lord', s('text')); break;
    case 'history':
      if (s('text') && (String(v.text).includes(me) || v.choice)) chron(c, 'history', String(v.text));
      break;
  }
}

/** 戦の結果を功臣の記録に足す（自分の家の武将だけ） */
export function addFeats(c: Campaign, ids: string[], won: boolean, foesBeaten: number): void {
  if (!c.player) return;
  const f = (c.feats ??= {});
  for (const id of ids) {
    const g = c.gs.generals[id];
    if (!g || g.faction !== c.player) continue;
    const x = (f[id] ??= { battles: 0, wins: 0, foes: 0 });
    x.battles++;
    if (won) { x.wins++; x.foes += foesBeaten; }
  }
}

// ---------------------------------------------------------------- 家ごとの歩み（P60：滅亡の窓に使う）

/** 月ごとの家のようす：領・武将・兵の数 */
export interface RealmSample { year: number; month: number; provs: number; gens: number; troops: number }
export interface RealmHist {
  name: string; color: [number, number, number];
  start: RealmSample;
  samples: RealmSample[];
  events: { year: number; month: number; text: string }[];
  /** 滅んだときのこと */
  fell?: { year: number; month: number; by: string; lord: string; ronin: number };
}
// セーブが大きくなりすぎないよう、月ごとの記録は120件まで（超えたら1つおきに間引く）、出来事は80件まで
const SAMPLE_MAX = 120, EVENT_MAX = 80;

function sampleOf(c: Campaign, fid: number): RealmSample {
  const gens = Object.values(c.gs.generals).filter((g) => g.faction === fid);
  return { ...dateOf(c), provs: c.gs.provinces.filter((p) => p.owner === fid && !p.out).length, gens: gens.length, troops: gens.reduce((s, g) => s + g.troops.length, 0) };
}

/** 毎月の終わりに、すべての家のようすを書き留める（長くなったら1つおきに間引く） */
export function sampleRealms(c: Campaign): void {
  const h = (c.realms ??= {});
  for (const f of Object.values(c.gs.factions)) {
    const s = sampleOf(c, f.id);
    const r = (h[f.id] ??= { name: f.name.ja, color: f.color, start: s, samples: [], events: [] });
    r.name = f.name.ja; r.color = f.color;
    r.samples.push(s);
    if (r.samples.length > SAMPLE_MAX) r.samples = r.samples.filter((_x, i) => i % 2 === 0 || i === r.samples.length - 1);
  }
}

export function realmEvent(c: Campaign, name: string, text: string): void {
  const f = Object.values(c.gs.factions).find((x) => x.name.ja === name);
  const h = (c.realms ??= {});
  const r = f ? (h[f.id] ??= { name: f.name.ja, color: f.color, start: sampleOf(c, f.id), samples: [], events: [] }) : Object.values(h).find((x) => x.name === name);
  if (!r) return;
  r.events.push({ ...dateOf(c), text });
  if (r.events.length > EVENT_MAX) r.events.splice(1, r.events.length - EVENT_MAX);
}

/** 記録の1件から、家ごとの歩みへ写す（note から呼ぶ） */
export function realmFromLog(c: Campaign, e: CampaignLog): void {
  const s = (k: string): string => String(e.vars[k] ?? '');
  switch (e.key) {
    case 'capture':
      realmEvent(c, s('faction'), `${s('prov')}を${s('from') || '在地の兵'}から攻め取る`);
      if (s('from')) realmEvent(c, s('from'), `${s('prov')}を${s('faction')}に奪われる`);
      break;
    case 'chainCapture':
      realmEvent(c, s('faction'), `勢いに乗り、${s('from')}の${s('provs')}も取る`);
      realmEvent(c, s('from'), `${s('faction')}に${s('provs')}も一気に取られる`);
      break;
    case 'fall': realmEvent(c, s('by'), `${s('faction')}を滅ぼす`); break;
    case 'war': realmEvent(c, s('a'), `${s('b')}に戦を仕掛ける`); realmEvent(c, s('b'), `${s('a')}に攻めかかられる`); break;
    case 'alliance': realmEvent(c, s('a'), `${s('b')}と同盟`); realmEvent(c, s('b'), `${s('a')}と同盟`); break;
    case 'truce': realmEvent(c, s('a'), `${s('b')}と停戦`); realmEvent(c, s('b'), `${s('a')}と停戦`); break;
    case 'vassal': realmEvent(c, s('faction'), `${s('lord')}に従属する`); realmEvent(c, s('lord'), `${s('faction')}を従える`); break;
    case 'capitalMoved': realmEvent(c, s('faction'), `本拠を${s('prov')}へ移す`); break;
    case 'succeed': case 'newLord': realmEvent(c, s('faction'), `${s('name')}が当主となる`); break;
    case 'abdicate': realmEvent(c, s('faction'), `${s('late')}が隠居し、${s('name')}が当主となる（譲り）`); break;
    case 'defect': realmEvent(c, s('from'), `${s('name')}が${s('to')}へ寝返る`); realmEvent(c, s('to'), `${s('name')}が寝返ってくる`); break;
    case 'death': realmEvent(c, s('faction'), `${s('name')}が世を去る（${s('age')}歳）`); break;
    case 'captured': realmEvent(c, s('from'), `${s('name')}${s('lord')}が${s('by')}に捕らえられる`); realmEvent(c, s('by'), `${s('from')}の${s('name')}${s('lord')}を捕らえる`); break;
    case 'captiveRecruit': realmEvent(c, s('by'), `捕虜の${s('name')}を家臣とする`); break;
    case 'captiveExecute': realmEvent(c, s('from'), `${s('name')}${s('lord')}が${s('by')}に処断される`); break;
    // 史実の出来事は、本文に名が出てくる家すべての歩みに書く
    case 'history': case 'historyChoice': {
      const text = s('text') || s('result');
      // 史実の出来事は家を併せたあとに記録されるので、滅んだ家の名も探す
      const names = new Set([...Object.values(c.gs.factions).map((f) => f.name.ja), ...Object.values(c.realms ?? {}).map((r) => r.name)]);
      if (text) for (const n of names) {
        // 本文では「三村」のように「家」を付けずに呼ぶことがある
        const short = n.replace(/家$/, '');
        if (text.includes(n) || (short.length >= 2 && text.includes(short))) realmEvent(c, n, `【史実】${text}`);
      }
      break;
    }
  }
}

/** 家が滅んだときに、最後のようすを書き留める（eliminate から、家を消す前に呼ぶ） */
export function realmFell(c: Campaign, fid: number, by: string): void {
  const f = c.gs.factions[fid];
  if (!f) return;
  const h = (c.realms ??= {});
  const r = (h[fid] ??= { name: f.name.ja, color: f.color, start: sampleOf(c, fid), samples: [], events: [] });
  const gens = Object.values(c.gs.generals).filter((g) => g.faction === fid);
  r.samples.push({ ...dateOf(c), provs: 0, gens: gens.length, troops: gens.reduce((s, g) => s + g.troops.length, 0) });
  r.fell = { ...dateOf(c), by, lord: c.gs.generals[f.lordId]?.name.ja ?? '', ronin: gens.length };
  (c.fallen ??= []).push(fid);
}

/** 統一までの年月（「◯年◯か月」） */
export function spanText(c: Campaign): string {
  const s = c.chronicle?.[0], e = dateOf(c);
  if (!s) return `${c.months}か月`;
  const months = (e.year - s.year) * 12 + (e.month - s.month);
  const y = Math.floor(months / 12), m = months % 12;
  return y ? `${y}年${m ? `${m}か月` : ''}` : `${m}か月`;
}
