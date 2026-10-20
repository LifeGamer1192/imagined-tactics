// 小窓（説明）に出す文章。特性・性格・兵種・技・軍略を、データの数字から組み立てる。
// 数字は data/system の JSON から読むので、調整してもここを直す必要はない。

import cfgJson from '../../data/system/convert.json';
import { AI, AXES, type Axis, type Personality } from '../ai/personality';
import { D, L } from '../data/db';
import type { Passive, SkillDef, TacticDef, UnitDef } from '../data/types';
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
  // 戦場の効き目（P56）：将と、配下のすべての兵に効く
  const army: string[] = [], self: string[] = [], realm: string[] = [];
  const add = (to: string[], k: string, label: string, unit = '%'): void => { const v = r[k]; if (typeof v === 'number' && v) to.push(`${label}${v > 0 ? '+' : ''}${v}${unit}`); };
  add(army, 'strPct', T.str()); add(army, 'intPct', T.int()); add(army, 'agiPct', T.agi()); add(army, 'hpPct', T.hp()); add(army, 'mpPct', T.mp()); add(army, 'defPct', '防御');
  add(army, 'move', '移動', ''); add(army, 'healPct', '回復の量'); add(army, 'critPct', '会心', '％ポイント'); add(army, 'counterPct', '反撃の威力');
  add(army, 'hitPct', '命中'); add(army, 'evadePct', '回避'); add(army, 'resistPct', '軍略への耐性');
  add(army, 'statusPct', '状態の軍略の成功率', '％ポイント'); add(army, 'mpCostPct', '軍略の気力'); add(army, 'supportMpCostPct', '味方への補助の軍略の気力');
  add(self, 'command', '采配', ''); add(self, 'commandRange', '采配の届く範囲', ''); add(self, 'expPct', '得る経験');
  if (typeof r.loyalty === 'number' && r.loyalty) self.push(r.loyalty > 0 ? '主君を裏切りにくい' : '主君を裏切ることがある');
  if (S.people.wound.shortTraits.includes(t)) self.push(`深手が早く治る（${S.people.wound.short}か月）`);
  if (S.people.wound.longTraits.includes(t)) self.push(`深手の治りが遅い（${S.people.wound.long}か月）`);
  if (typeof r.buildCostMult === 'number') realm.push(`この武将がいる領は、普請の兵糧が${Math.round(Number(r.buildCostMult) * 100)}%`);
  if (typeof r.recruitCostMult === 'number') realm.push(`この武将が雇う兵（当主なら家じゅうの兵）の兵糧が${Math.round(Number(r.recruitCostMult) * 100)}%`);
  if (army.length) out.push(`戦場（将と配下のすべての兵に効く）：${army.join('、')}`);
  if (self.length) out.push(`将だけ：${self.join('、')}`);
  if (realm.length) out.push(`領の仕事：${realm.join('、')}`);
  if (!army.length && !self.length && !realm.length) out.push('能力：数値の変化はなし');
  const ax = AI.traits[t] ?? {};
  const way = AXES.filter((a) => Math.abs(ax[a] ?? 0) >= 0.2).map((a) => AXIS_WORD[a][(ax[a] ?? 0) > 0 ? 0 : 1]);
  if (way.length) out.push(`戦い方：${way.join('、')}（敵の武将と配下の兵は、この性格で動きます。味方のおまかせは、選んだ方針で動きます）`);
  return out.filter(Boolean).join('\n');
}

/** 性格の説明（戦い方の傾向） */
export function personalityTip(p: Personality, label: string): string {
  const lines = AXES.filter((a) => Math.abs(p[a]) >= 0.15).sort((a, b) => Math.abs(p[b]) - Math.abs(p[a]))
    .map((a) => `・${AXIS_WORD[a][p[a] > 0 ? 0 : 1]}（${p[a] > 0 ? '強め' : '弱め'} ${Math.round(Math.abs(p[a]) * 100)}）`);
  return [`【性格：${label}】`, '特性と能力から決まる、戦場での動き方です。おまかせのとき、この武将と率いる兵はこの傾向で動きます。', ...(lines.length ? lines : ['・目立った癖はなく、状況に応じて動く'])].join('\n');
}

const MARK: Record<string, string> = { sure: '必中', o: '有効', tri: '効きにくい', x: '効かない' };

const sgn = (v: number): string => (v > 0 ? `+${v}` : String(v));

/** 騎乗（得意地形が「騎」になる）で何が変わるか：地形ごとの動きやすさを、平地が得意のときと比べて（データから） */
function mountedText(): string {
  const mc = D.terrain.moveCost as Record<string, Record<string, number | null>>;
  const better: string[] = [], worse: string[] = [], barred: string[] = [];
  for (const k of ['plain', 'road', 'forest', 'mountain', 'swamp', 'paddy', 'desert', 'snowfield', 'town']) {
    const a = mc[k]?.plain, b = mc[k]?.rider, name = TERRAIN_WORD[k] ?? k;
    if (a === undefined || b === undefined) continue;
    if (b === null && a !== null) barred.push(name);
    else if (a !== null && b !== null && b < a) better.push(name);
    else if (a !== null && b !== null && b > a) worse.push(name);
  }
  return [`得意地形が「騎」になる（馬に乗る）`, better.length ? `${better.join('・')}で動きやすくなる` : '', worse.length ? `${worse.join('・')}では動きにくくなる` : '', barred.length ? `${barred.join('・')}には入れなくなる` : '', '受ける技は、技ごとの「騎馬の相手」への効き目で決まる'].filter(Boolean).join('。') + '。';
}
const TERRAIN_WORD: Record<string, string> = { plain: '平地', road: '道', forest: '森', mountain: '山', swamp: '湿地', paddy: '田', desert: '荒れ地', snowfield: '雪原', town: '町' };

/**
 * 状態（強化・弱化・状態異常）が、かかるとどう変わるか。数字は statuses.json から。
 * 技・軍略の説明と、遊び方の状態の表の両方で使う
 */
export function statusEffect(id: string): string {
  const s = D.status as unknown as Record<string, Record<string, number | [number, number]>>;
  const hp = T.hp(), agi = T.agi(), int = T.int();
  const n = (k: string, f: string): number => Number((s[k]?.[f] as number) ?? 0);
  const span = (k: string): string => { const t = s[k]?.turns; return Array.isArray(t) ? `${t[0]}〜${t[1]}ターン` : `${t}ターン`; };
  switch (id) {
    case 'poison': return `番の始めに、最大${hp}の${n('poison', 'pct')}%を失う。戦いが終わるまで続く。`;
    case 'daze': return `${span('daze')}動けず、受ける攻撃が必ず当たる。`;
    case 'stun': return `${span('stun')}動けず、受ける攻撃が必ず当たる。攻撃を受けると解ける。`;
    case 'confuse': return `動けず、受ける攻撃が必ず当たる。防御が${n('confuse', 'def')}になる。戦いが終わるまで続く。`;
    case 'silence': return `${span('silence')}、軍略を使えない。`;
    case 'defect': return `${span('defect')}、相手の陣営として動く。反撃もしない。兵だけがかかり、武将はかからない。`;
    case 'weaken': return `${span('weaken')}、攻撃${sgn(n('weaken', 'atk'))}、防御${sgn(n('weaken', 'def'))}。`;
    case 'atkDown': return `${span('atkDown')}、攻撃${sgn(n('atkDown', 'atk'))}。`;
    case 'intDown': return `${span('intDown')}、${int}${sgn(n('intDown', 'int'))}（軍略の威力と、軍略への強さが下がる）。`;
    case 'grounded': return `${span('grounded')}、${agi}${sgn(n('grounded', 'agi'))}。得意地形が平地になる（馬から降ろされる）。`;
    case 'atkNext': return `次に使う技の攻撃${sgn(n('atkNext', 'atk'))}。`;
    case 'sureNext': return '次に使う技が必ず当たる。';
    case 'atkUp': return `${span('atkUp')}、攻撃${sgn(n('atkUp', 'atk'))}。`;
    case 'defUp': return `${span('defUp')}、防御${sgn(n('defUp', 'def'))}。`;
    case 'agiUp': return `${span('agiUp')}、${agi}${sgn(n('agiUp', 'agi'))}。`;
    case 'moveUp': return `${span('moveUp')}、移動${sgn(n('moveUp', 'move'))}。`;
    case 'resistUp': return `${span('resistUp')}、軍略で受けるダメージと、かけられる軍略の成功率が${n('resistUp', 'pct')}%下がる。`;
    case 'regen': return `${span('regen')}、番の始めに最大${hp}の${n('regen', 'pct')}%を回復する。`;
    case 'ward': return '次に受ける軍略を、1度だけ無効にする。味方からの回復も無効になる。';
    case 'extraAct': return '行動のあと、もう1度動ける。';
    case 'mounted': return mountedText();
    case 'routed': return '倒れた兵が、収容した側の陣営で戦う。戦いが終わると失われる。';
    default: return '';
  }
}
/** 「状態の名前（効き目）」 */
const withEffect = (id: string): string => { const e = statusEffect(id); return `${(STATUS_NAME as Record<string, string>)[id] ?? id}${e ? `（${e.replace(/。$/, '')}）` : ''}`; };

/** 技の説明 */
export function skillTip(s: SkillDef): string {
  const shape = s.shape.type === 'around' ? `自分の周り${s.shape.n}マス` : s.shape.type === 'line' ? `向いた方へ直線${s.shape.n}マス` : `1体（射程${s.range[0] === s.range[1] ? s.range[1] : `${s.range[0]}〜${s.range[1]}`}）`;
  const out = [`【${L(s.name)}】`, `対象：${shape}${s.targets === 'all' ? '（味方も巻き込む）' : ''}`];
  if (!s.noDamage) out.push(`威力${s.power}${s.hit ? `、命中${s.hit > 0 ? '+' : ''}${s.hit}` : ''}`);
  if (s.mp) out.push(`気力を${s.mp}使う`);
  out.push(`地上の相手：${MARK[s.vsGround] ?? s.vsGround}、騎馬の相手：${MARK[s.vsRider] ?? s.vsRider}`);
  out.push(s.afterMove ? '動いたあとでも使える' : '動く前にしか使えない');
  if (s.counter) out.push('反撃にも使う');
  // 反撃を受けるか（P49）
  if (s.noCounter) out.push('反撃：受けない（相手は反撃できない技）');
  else if (s.shape.type !== 'single') out.push('反撃：受けない（範囲の技には反撃できない）');
  else if (s.range[0] >= 2) out.push(`反撃：相手の通常攻撃が距離${s.range[0]}以上に届くときだけ受ける（近くしか届かない相手からは受けない）`);
  else out.push('反撃：受けることがある（相手の通常攻撃が届く距離なら。相手が動けない・寝返り中なら受けない）');
  if (s.needsWater) out.push('水の上でしか使えない');
  for (const e of s.effects) {
    if (e.type === 'status') out.push(`当たると${e.chance}%で${withEffect(e.status)}`);
    else if (e.type === 'lifesteal') out.push(`与えたダメージの${Math.round(e.rate * 100)}%を回復`);
    else if (e.type === 'weakenStun') out.push(`当たると${e.chance}%で${withEffect('weaken')}と${withEffect('stun')}`);
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
  // 状態は、かかるとどう変わるかを必ず添える（「騎乗」だけでは分からないため）
  if (t.status && typeof t.status === 'object') out.push(`当たると${t.status.chance}%で${STATUS_NAME[t.status.status] ?? t.status.status}：${statusEffect(t.status.status) || '（効き目は状態の表を参照）'}`);
  else if (t.status) out.push(`${STATUS_NAME[t.status] ?? t.status}${t.kind === 'status' && !t.sure ? '（相手の知略しだいでかかる）' : '（必ずかかる）'}：${statusEffect(t.status) || '（効き目は状態の表を参照）'}`);
  if (t.kind === 'cure') out.push('毒・眩暈・気絶・混乱・軍略封じ・寝返りなどの悪い状態を治す');
  if (t.kind === 'dispel') out.push('かかっている強化（攻撃・防御・機敏・移動の上昇、次の一撃、用心など）と弱化を消す');
  if (t.kind === 'mpRestore' && t.amount) out.push(`味方の気力を${t.amount}回復する`);
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
  for (const p of u.promote ?? []) {
    if (!D.byUnit[p.to]) continue;
    // 品の要る昇進は、品とレベルの両方（練兵の書ではレベルを飛ばせない）
    const need = [p.lv ? `Lv${p.lv}` : '', p.item ? `品「${D.items[p.item]?.jp ?? p.item}」` : ''].filter(Boolean).join('と');
    out.push(`${need}で${L(D.byUnit[p.to].name)}へ昇格できる${p.item && p.lv ? '（練兵の書ではレベルを飛ばせない）' : ''}`);
  }
  // 特徴とおすすめの使い方（P51）
  const f = unitTraits(u);
  if (f.strong.length || f.weak.length) out.push('', `特徴：${[...f.strong.map((x) => `◎${x}`), ...f.weak.map((x) => `△${x}`)].join('、')}`);
  out.push(`おすすめ：${unitAdvice(u, f)}`);
  return out.join('\n');
}

/** 同じ格（下級・中級・上級）の兵種の平均。兵種の能力の高い・低いは、これと比べる */
const avgCache = new Map<number, Record<string, number>>();
function tierAvg(tier: number): Record<string, number> {
  let a = avgCache.get(tier);
  if (a) return a;
  const us = D.units.filter((x) => x.tier === tier);
  a = {};
  for (const k of ['hp', 'str', 'int', 'agi', 'def', 'move', 'cost'] as const) a[k] = us.reduce((s, x) => s + Number(x[k]), 0) / Math.max(1, us.length);
  avgCache.set(tier, a);
  return a;
}

/** 兵種の特徴：同じ格の平均より目立って高い・低い能力、射程、軍略の種類 */
function unitTraits(u: UnitDef): { strong: string[]; weak: string[]; ranged: boolean; heal: boolean; caster: boolean; fast: boolean; tough: boolean; hard: boolean; light: boolean } {
  const a = tierAvg(u.tier), strong: string[] = [], weak: string[] = [];
  const cmp = (k: 'hp' | 'str' | 'int' | 'agi' | 'def', name: string): void => { const r = Number(u[k]) / Math.max(1, a[k]); if (r >= 1.15) strong.push(`${name}が高い`); else if (r <= 0.85) weak.push(`${name}が低い`); };
  cmp('hp', T.hp()); cmp('str', T.str()); cmp('int', T.int()); cmp('agi', T.agi()); cmp('def', '防御');
  const basic = u.skills.map((id) => D.skills.find((s) => s.id === id)).find((s) => s?.basic);
  const ranged = !!basic && basic.range[1] >= 2;
  if (ranged) strong.push(`離れた所から攻撃できる（射程${basic!.range[0]}〜${basic!.range[1]}）`);
  const kinds = new Set(u.tactics.map((id) => D.byTactic[id]?.kind).filter(Boolean));
  const heal = kinds.has('heal') || kinds.has('revive');
  if (heal) strong.push('味方を回復できる');
  if (kinds.has('buff')) strong.push('味方を強くする軍略');
  if (kinds.has('debuff') || kinds.has('status')) strong.push('敵を弱らせる軍略');
  const caster = kinds.has('damage');
  if (caster) strong.push('軍略で攻撃できる');
  const fast = u.move >= a.move + 1, slow = u.move <= a.move - 1;
  if (fast) strong.push(`足が速い（移動${u.move}）`); else if (slow) weak.push(`足が遅い（移動${u.move}）`);
  const light = u.cost <= a.cost * 0.8;
  if (light) strong.push(`采配が軽く、数をそろえやすい（${u.cost}）`); else if (u.cost >= a.cost * 1.3) weak.push(`采配が重い（${u.cost}）`);
  if (u.affinity !== 'plain') strong.push(`${AFFINITY_NAME[u.affinity] ?? u.affinity}が得意`);
  return { strong, weak, ranged, heal, caster, fast, tough: Number(u.hp) >= a.hp * 1.15, hard: u.def >= a.def * 1.15, light };
}

/** 系統ごとの使いどころ（P51）。能力から決まる使い方に添える */
const LINE_ADVICE: Record<number, string> = {
  1: '数をそろえて前に並べ、壁にする。弓や鉄砲など後ろの兵を守り、敵を囲んで削る',
  2: '前衛のすぐ後ろに置き、ぶつかる直前に味方を強くする。自分は前に出さない',
  3: '川や海の多い戦場で使う。陸の上ではふつうより弱い',
  4: '前衛の後ろから強い一撃を撃つ。近づかれると脆いので、前衛で守る',
  5: '足を活かして回り込み、弱った敵や後ろの兵を突く。正面からのぶつかり合いは避ける',
  6: '前衛の後ろから撃ち続ける。森・櫓・高い所に置くとさらに強い',
  7: '大きく動いて回り込み、弱った敵や後ろの兵を狩る。森や山では動きにくい',
  8: '前衛のすぐ後ろで、傷んだ味方を回復する。狙われないよう前に出さない',
  9: '最前列で敵の攻撃を受け止め、後ろの兵を守る。門の前や狭い道をふさぐ',
  10: '城攻めで門・柵を壊す役。戦うより、道を開くのに使う',
  11: '敵の前衛を正面から崩す攻め手。将の近くの敵や、硬い敵にぶつける',
  12: '山や森の多い戦場で、地形を活かして戦う。平地ではふつう',
  13: '平地で正面から突撃する主力。湿地・森・山は避け、開けた所で使う',
  14: '森や茂みに潜ませ、近づいた敵を叩く。守る戦いで特に強い',
  15: '固まった敵を火で焼く。味方を巻き込まないよう、敵の群れに向ける',
  16: '水の多い戦場の主力。川や海の上から攻める',
  17: '将の近くで味方を支える。軍略で味方を助け、自分は前に出ない',
  18: '敵の後ろへ近づき、寝返りや混乱で乱す。打たれ弱いので深入りしない',
};

function unitAdvice(u: UnitDef, f: ReturnType<typeof unitTraits>): string {
  const line = LINE_ADVICE[u.line];
  if (line) return `${line}。`;
  if (f.heal) return '前衛のすぐ後ろで、傷んだ味方を回復する。';
  if (f.ranged) return '前衛の後ろから撃つ。近づかれないよう守る。';
  if (f.hard || f.tough) return '最前列で敵の攻撃を受け止める。';
  if (f.fast) return '回り込んで、弱った敵や後ろの兵を狙う。';
  return '前に出て敵とぶつかる。';
}

/** 役職（謀士など）の説明（P51）：攻撃の種類と射程、防御・移動、得意な地形、能力への加減、覚える軍略、なる条件 */
export function classTip(classId: string): string {
  const c = D.byClass[classId];
  if (!c) return '';
  const tier = ['', '下級', '中級', '上級'][c.tier] ?? '';
  const out = [`【${L(c.name)}】${tier}の役職${c.unique === 'lord' ? '（当主だけ）' : ''}`];
  const atk = c.attack.kind === 'bow' ? `飛び道具（射程${c.attack.range[0]}〜${c.attack.range[1]}）` : `近接（射程${c.attack.range[1]}）`;
  out.push(`通常攻撃：${atk}、威力${c.attack.power}　防御${c.def}　移動${c.move}　得意な地形：${AFFINITY_NAME[c.affinity] ?? c.affinity}`);
  const mod = (['hp', 'mp', 'str', 'int', 'agi'] as const).filter((k) => c.mod[k]).map((k) => `${T[k]()}${sgn(c.mod[k])}`);
  if (mod.length) out.push(`能力：${mod.join('・')}`);
  if (c.tactics.length) out.push(`使える軍略：${c.tactics.map((id) => (D.byTactic[id] ? L(D.byTactic[id].name) : id)).join('・')}`);
  const role = c.attack.kind === 'bow' ? '後ろから撃つ将' : c.tactics.some((id) => D.byTactic[id]?.kind === 'heal') ? '味方を回復して支える将' : (c.mod.int ?? 0) > (c.mod.str ?? 0) ? '軍略で戦う将（知略が大事）' : '前に出て戦う将（武力が大事）';
  out.push(`向き：${role}`);
  const req = Object.entries(c.req).filter(([, v]) => v).map(([k, v]) => `${k === 'lv' ? 'Lv' : k === 'mastery' ? '熟練' : T[k as 'str' | 'int' | 'agi']()}${v}`);
  if (c.from && D.byClass[c.from]) out.push(`${L(D.byClass[c.from].name)}から昇進${req.length ? `（${req.join('・')}以上）` : ''}`);
  return out.join('\n');
}

/** 強さの説明（P51）：何を足した数か、と大陸全土の武将と比べた10段階の評価 */
export const STRENGTH_WORDS = ['未熟', '頼りない', '物足りない', 'やや劣る', '並', 'やや優れる', '頼もしい', '一流', '当代屈指', '天下無双'];
export function strengthRank(v: number, all: number[]): { rank: number; word: string; top: number } {
  const sorted = [...all].sort((a, b) => a - b);
  const below = sorted.filter((x) => x < v).length;
  const pct = sorted.length ? below / sorted.length : 0.5;
  const rank = Math.max(0, Math.min(9, Math.floor(pct * 10)));
  return { rank, word: STRENGTH_WORDS[rank], top: Math.max(1, Math.round((1 - pct) * 100)) };
}
export function strengthTip(v: number, all: number[]): string {
  const r = strengthRank(v, all);
  return [`【強さ ${Math.round(v)}】評価：${r.word}（10段階の${r.rank + 1}・大陸全土の武将${all.length}人の上位${r.top}%）`,
    '武将と率いる兵をまとめた、戦いの強さの目安です。',
    '＝ レベル×8 ＋（武力＋知略）÷4 ＋ 体力÷20 ＋ 兵ごとに（采配の重さ×0.6 ＋ 兵のレベル×3）',
    'レベルを上げる・兵を増やす・兵を育てると上がります。勢力どうしの強さの比べ合い（攻めるかどうかの判断）にも使われます。',
    `評価の段階：${STRENGTH_WORDS.join(' ＜ ')}`].join('\n');
}

/** 采配の説明（P51） */
export function commandTip(used: number, max: number, range: number): string {
  return [`【采配 ${used}／${max}（残り${Math.max(0, max - used)}）】`,
    '武将が率いられる兵の重さの合計です。兵種ごとに采配の重さ（采◯）があり、合計が最大を超える兵は雇えず、受け取れません。',
    `バーの右端が最大の采配で、区切りの幅がそれぞれの兵の重さです。`,
    `采配の範囲（${range}マス）：戦場で、配下の兵が武将からこの距離の外に出ると「采配範囲外」になり、弱くなります。`,
    '最大の采配は魅力・名声・特性（カリスマなど）で決まり、役職が上がると増えます。'].join('\n');
}
