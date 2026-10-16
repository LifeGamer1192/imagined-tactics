// 小窓（説明）に出す文章。特性・性格・兵種・技・軍略を、データの数字から組み立てる。
// 数字は data/system の JSON から読むので、調整してもここを直す必要はない。

import cfgJson from '../../data/system/convert.json';
import { AI, AXES, type Axis, type Personality } from '../ai/personality';
import { D, L } from '../data/db';
import type { Passive, SkillDef, TacticDef } from '../data/types';
import { S } from '../strategy/config';
import { AFFINITY_NAME, STATUS_NAME, T, TRAIT_NAME } from './text';

const CFG = cfgJson as unknown as { traits: Record<string, Record<string, number | string>> };

/** 特性の人柄（そもそもどういう人か） */
const TRAIT_STORY: Record<string, string> = {
  brave: '恐れを知らず、自ら先頭に立って斬り込む人。危うい場面でも退かない。',
  craven: '危ういことを嫌い、身を守ることを第一に考える人。逃げ足が速く、攻撃をかわすのがうまい。',
  warrior: '武芸ひとすじに生きてきた人。一騎打ちに強く、狙った相手を外さない。',
  wise: '物事の筋道を見抜く人。軽はずみに動かず、策を練ってから戦う。',
  scholar: '書を好み、学ぶことを楽しむ人。経験から学ぶのが早い。',
  genius: '抜きん出た才覚の持ち主。何をさせても飲み込みが早く、策も鋭い。',
  foolish: '考えが浅く、先を読まない人。策にかかりやすく、勢いだけで動く。',
  charismatic: '人を惹きつけてやまない人。大勢の兵を従え、遠くまで指図が届く。',
  drunkard: '酒に目がない人。足もとがおぼつかず、配下の規律も緩みがち。',
  pious: '神仏を敬い、信心の深い人。傷ついた者をいたわり、手当てがうまい。',
  cruel: '情けをかけない人。弱った相手を容赦なく狙い、急所を突く。',
  paranoid: '人を信じず、いつも裏を疑う人。守りを固め、無理をしない。',
  cynical: '冷めた目で損得を測る人。きれいごとより、勝つための手を選ぶ。',
  sickly: '体の弱い人。戦えないほどではないが、深手を負うと治りが遅い。',
  just: '筋を通し、約束を守る人。正面から戦うことを好み、主君を裏切りにくい。',
  kind: '情に厚い人。味方を大事にし、敵にも情けをかける。主君を裏切りにくい。',
  content: '今の暮らしに満ち足りている人。出世を望まず、穏やかに務める。主君を裏切りにくい。',
  generous: '気前がよく、人に分け与える人。配下に慕われ、主君を裏切りにくい。',
  greedy: '欲の深い人。利のある方へなびきやすく、主君を裏切ることがある。',
  ambitious: '上を目指してやまない人。手柄を求めて攻めに出る。条件しだいで主君を裏切ることがある。',
  builder: '城や町を築く才のある人。hist-sim では普請に強い。戦いでは守りを重んじる。',
  unifier: '天下をまとめる器の人。人の心をひとつにし、軍をよく束ねる。',
  reformer: '古いしきたりを改める人。新しいやり方を好み、知恵がまわる。',
};

const AXIS_WORD: Record<Axis, [string, string]> = {
  aggression: ['攻めに出やすい', '攻めを控える'],
  caution: ['傷つくと早めに退く', '傷ついても退かない'],
  discipline: ['隊列を乱さない', '隊列が乱れやすい'],
  cunning: ['策や軍略を好む', 'まっすぐ攻める'],
  cruelty: ['弱った敵を狙う', '弱った敵に情けをかける'],
  care: ['味方をいたわる', '味方を顧みない'],
  honor: ['正面から戦う', '搦め手を使う'],
};

const PASSIVE_TEXT = (p: Passive): string => {
  switch (p.type) {
    case 'counterDamage': return `反撃の威力+${p.pct}%`;
    case 'evade': return `回避+${p.pct}%`;
    case 'hit': return `命中+${p.pct}%`;
    case 'crit': return `会心+${p.pct}%`;
    case 'regen': return `毎ターン体力を${p.pct}%回復${p.on === 'forest' ? '（森で）' : p.on === 'water' ? '（水辺で）' : ''}`;
    case 'shield': return `盾で受ける（${Math.round(p.chance <= 1 ? p.chance * 100 : p.chance)}%）`;
    case 'immune': return `${p.statuses.map((s) => STATUS_NAME[s] ?? s).join('・')}にかからない`;
    case 'tacticResist': return `軍略への耐性+${p.pct}%`;
    case 'bane': return `${AFFINITY_NAME[p.vs] ?? p.vs}の相手に威力+${p.pct}%`;
    case 'baneOnTerrain': return `${p.terrain}で威力+${p.pct}%`;
    case 'remove': return '倒されても戦場から下がるだけ（失われにくい）';
    case 'doubleAct': return '1ターンに2回動けることがある';
  }
};

/** 特性の説明（人柄・能力への効き目・戦い方・深手の長さ） */
export function traitTip(t: string): string {
  const name = TRAIT_NAME[t] ?? t, r = CFG.traits[t] ?? {}, out: string[] = [];
  out.push(`【${name}】`, TRAIT_STORY[t] ?? '');
  const eff: string[] = [];
  const add = (k: string, label: string, unit = ''): void => { const v = r[k]; if (typeof v === 'number' && v) eff.push(`${label}${v > 0 ? '+' : ''}${v}${unit}`); };
  add('str', T.str()); add('int', T.int()); add('agi', T.agi()); add('command', '采配'); add('commandRange', '采配の届く範囲');
  add('expPct', '得る経験', '%'); add('healPct', '回復', '%'); add('critPct', '会心', '%');
  if (r.passive === 'counterDamage') eff.push('反撃の威力+20%');
  if (r.passive === 'evade') eff.push('回避+10%');
  if (r.passive === 'hit') eff.push('命中+10%');
  if (typeof r.loyalty === 'number' && r.loyalty) eff.push(r.loyalty > 0 ? '主君を裏切りにくい' : '主君を裏切ることがある');
  if (S.people.wound.shortTraits.includes(t)) eff.push(`深手が早く治る（${S.people.wound.short}か月）`);
  if (S.people.wound.longTraits.includes(t)) eff.push(`深手の治りが遅い（${S.people.wound.long}か月）`);
  out.push(`能力：${eff.length ? eff.join('、') : '数値の変化はなし'}`);
  const ax = AI.traits[t] ?? {};
  const way = AXES.filter((a) => Math.abs(ax[a] ?? 0) >= 0.2).map((a) => AXIS_WORD[a][(ax[a] ?? 0) > 0 ? 0 : 1]);
  if (way.length) out.push(`戦い方：${way.join('、')}（兵も、率いる武将の性格で動きます）`);
  return out.filter(Boolean).join('\n');
}

/** 性格の説明（戦い方の傾向） */
export function personalityTip(p: Personality, label: string): string {
  const lines = AXES.filter((a) => Math.abs(p[a]) >= 0.15).sort((a, b) => Math.abs(p[b]) - Math.abs(p[a]))
    .map((a) => `・${AXIS_WORD[a][p[a] > 0 ? 0 : 1]}（${p[a] > 0 ? '強め' : '弱め'} ${Math.round(Math.abs(p[a]) * 100)}）`);
  return [`【性格：${label}】`, '特性と能力から決まる、戦場での動き方です。おまかせのとき、この武将と率いる兵はこの傾向で動きます。', ...(lines.length ? lines : ['・目立った癖はなく、状況に応じて動く'])].join('\n');
}

const MARK: Record<string, string> = { sure: '必中', o: '有効', tri: '効きにくい', x: '効かない' };

/** 技の説明 */
export function skillTip(s: SkillDef): string {
  const shape = s.shape.type === 'around' ? `自分の周り${s.shape.n}マス` : s.shape.type === 'line' ? `向いた方へ直線${s.shape.n}マス` : `1体（射程${s.range[0] === s.range[1] ? s.range[1] : `${s.range[0]}〜${s.range[1]}`}）`;
  const out = [`【${L(s.name)}】`, `対象：${shape}${s.targets === 'all' ? '（味方も巻き込む）' : ''}`];
  if (!s.noDamage) out.push(`威力${s.power}${s.hit ? `、命中${s.hit > 0 ? '+' : ''}${s.hit}` : ''}`);
  if (s.mp) out.push(`気力を${s.mp}使う`);
  out.push(`地上の相手：${MARK[s.vsGround] ?? s.vsGround}、騎馬の相手：${MARK[s.vsRider] ?? s.vsRider}`);
  out.push(s.afterMove ? '動いたあとでも使える' : '動く前にしか使えない');
  if (s.counter) out.push('反撃にも使う');
  if (s.noCounter) out.push('相手は反撃できない');
  if (s.needsWater) out.push('水の上でしか使えない');
  for (const e of s.effects) {
    if (e.type === 'status') out.push(`当たると${e.chance}%で${STATUS_NAME[e.status] ?? e.status}`);
    else if (e.type === 'lifesteal') out.push(`与えたダメージの${Math.round(e.rate * 100)}%を回復`);
    else if (e.type === 'weakenStun') out.push(`当たると${e.chance}%で攻撃・防御ダウンと気絶`);
    else if (e.type === 'mpHalf') out.push('相手の気力を半分にする');
    else if (e.type === 'heal') out.push('味方の体力を回復する');
    else if (e.type === 'knockback') out.push('相手を1マス押し出す');
    else if (e.type === 'critBonus') out.push('会心が出やすい');
  }
  return out.join('\n');
}

const TACTIC_KIND: Record<string, string> = {
  damage: 'ダメージを与える', heal: '体力を回復する', cure: '悪い状態を治す', mpRestore: '気力を回復する', buff: '味方を強くする', debuff: '敵を弱くする',
  status: '状態を変える', dispel: 'かかっている効果を消す', pull: '引き寄せる', revive: '倒れた味方を立て直す', displace: '位置を動かす',
};

/** 軍略の説明 */
export function tacticTip(t: TacticDef): string {
  const where = t.range === null ? (t.area ? `自分の周り${t.area}マス` : '戦場全体または自分') : t.area ? `射程${t.range}、半径${t.area}マスの範囲` : `1体（射程${t.range}）`;
  const out = [`【${L(t.name)}】`, `${TACTIC_KIND[t.kind] ?? t.kind}軍略。対象：${where}`, `気力を${t.mp}使う`];
  if (t.power) out.push(`威力${t.power}（${T.int()}が高いほど強い）`);
  // 状態の付き方：ダメージの軍略は当たったあと決まった確率で、状態の軍略は必中でなければ知略の比べ合い、強化・弱体は必ず付く
  if (t.status && typeof t.status === 'object') out.push(`${STATUS_NAME[t.status.status] ?? t.status.status}（${t.status.chance}%）`);
  else if (t.status) out.push(`${STATUS_NAME[t.status] ?? t.status}${t.kind === 'status' && !t.sure ? '（相手の知略しだいでかかる）' : '（必ずかかる）'}${t.turns ? `、${t.turns}ターン` : ''}`);
  if (t.atk) out.push(`攻撃${t.atk > 0 ? '+' : ''}${t.atk}%`);
  if (t.def) out.push(`防御${t.def > 0 ? '+' : ''}${t.def}%`);
  if (t.friendlyFire) out.push('味方も巻き込む');
  return out.join('\n');
}

/** 兵種の説明（能力・得意な地形・技・軍略・特技・費用・昇格） */
export function unitTip(unitId: string, level?: number): string {
  const u = D.byUnit[unitId];
  if (!u) return '';
  const out = [`【${L(u.name)}】${level ? ` Lv${level}` : ''}`];
  out.push(`${T.hp()}${u.hp}　${T.str()}${u.str}　${T.int()}${u.int}　${T.agi()}${u.agi}　防御${u.def}　移動${u.move}`);
  out.push(`得意な地形：${AFFINITY_NAME[u.affinity] ?? u.affinity}　采配の重さ：${u.cost}`);
  const skills = u.skills.map((id) => D.skills.find((s) => s.id === id)).filter((s): s is SkillDef => !!s).map((s) => L(s.name));
  if (skills.length) out.push(`技：${skills.join('・')}`);
  if (u.tactics.length) out.push(`軍略：${u.tactics.map((id) => (D.byTactic[id] ? L(D.byTactic[id].name) : id)).join('・')}`);
  if (u.passives.length) out.push(`特技：${u.passives.map(PASSIVE_TEXT).join('、')}`);
  for (const p of u.promote ?? []) if (D.byUnit[p.to]) out.push(`Lv${p.lv}で${L(D.byUnit[p.to].name)}へ昇格できる`);
  return out.join('\n');
}
