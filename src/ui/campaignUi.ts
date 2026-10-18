// 戦略パートの画面：戦略マップ、領と武将の情報、移動・徴兵・侵攻、月送り。

import type { BattleState, Side } from '../battle/types';
import type { BattleSummary } from '../battle/result';
import type { GGeneral, GTroop } from '../convert/model';
import { D, L } from '../data/db';
import { StrategyView } from '../render/strategyView';
import {
  autoMonth, battleFor, canAttack, endMonth, finishMonth, generalsAt, moveGeneral, moveTargets, neighborsOf, planAttack, provincesOf,
  declareWar, dismissTroop, garrisonOf, recruit, recruitCost, holderOf, moveTroopProblem, reserveKey, reserveOf, transferTroop, recruitProblem, relation, resolveBattle, siegeResist, strengthOf, traitsOf, troopLoad,
  S, supplyCap, type Campaign, type CampaignLog, type PendingBattle, BUILD_KINDS, build, buildCost, buildProblem, provinceLook, provinceMap, isExclave, exclaveLink, relocationPlan, relocationProblem, startRelocation,
} from '../strategy/campaign';
import { chooseHistory, choiceLine, choiceOutcome } from '../strategy/history';
import { profileHtml } from './profile';
import { toggleTrainAlways, trainMult, trainOnce, trainProblem } from '../strategy/training';
import { BM } from '../battle/map';
import { mapPreviewUrl } from '../render/mapPreview';
import {
  acceptOffer, allianceProblem, awayAt, breakAlliance, callProblem, callToArms, declineOffer, playerEnemies, proposeAlliance, proposeTruce, lowerProblem, lowerRefund, lowerToTroop, questProblem, raiseCost, raiseProblem, raiseToGeneral, renameGeneral, renameTroop, startQuest, troopUpgrades, truceProblem, upgradeTroop, woundedAt,
} from '../strategy/events';
import { generalPromotions, promoteGeneral } from '../rules/growth';
import { MAX_GENERALS } from '../battle/setup';
import { snapshot, type HexSave } from '../persist/save';
import { openSaveMenu, writeSlot } from './saveMenu';
import { TRAIT_NAME } from './text';
import { busy, toast } from './busy';
import { bannerHtml, sceneUrl, seasonBand, setScene } from './scene';
import { BGM_LEVEL_NAME, bgm, bgmLevel, setBgmLevel } from './bgm';
import { confirmBox } from './confirm';
import { personalityTip, traitTip, unitTip } from './describe';
import { initTips } from './tip';
import { personalityLabel, personalityOf } from '../ai/personality';
import { artUrl } from '../art/art';

/** 画面の土台（App）に求めるもの */
export interface Host {
  readonly root: HTMLElement;
  openBattle(st: BattleState, human: Set<Side>, done: (st: BattleState) => BattleSummary | null, back: { label: string; fn: () => void }, allowQuit: boolean, manualSide?: Side): void;
  /** hex-sim のセーブを読み込んで、その状態から続ける */
  loadHexSave(s: HexSave): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 国名の札：地図と同じ国の色を地にする（字は地の明るさで白か黒） */
const factionBadge = (name: string, [r, g, b]: [number, number, number]): string =>
  `<span class="fac" style="background:rgb(${r},${g},${b});color:${0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1612' : '#fff'}">${esc(name)}</span>`;
const REL_NAME = { self: '自分', ally: '味方', truce: '停戦中', war: '交戦中', neutral: '中立' } as const;
const LOG_TEXT: Record<string, string> = {
  capture: '{faction}が{prov}を取った',
  fall: '{faction}が滅んだ',
  battle: '{prov}の戦い：{attacker} 対 {defender} → {winner}の勝ち',
  month: '── {date} ──',
  siege: '{faction}が{prov}を囲んでいる（{pct}%）',
  wounded: '{names}が深手を負った（{months}か月は戦えない）',
  raised: '{by}の{unit}から、{name}が武将に取り立てられた',
  reserveTaken: '{faction}は、{prov}の予備兵{n}隊を手に入れた',
  lowered: '{name}は武将をやめ、予備兵の{unit}になった（兵糧{refund}が戻った）',
  war: '{a}が{b}に戦を仕掛けた',
  alliance: '{a}と{b}が同盟を結んだ',
  breakAlliance: '{a}が{b}との同盟を破った',
  truce: '{a}と{b}が停戦した（{months}か月）',
  train: '{name}が訓練した（経験値{exp}・×{mult}{lv}{troops}）',
  trainEvent: '【訓練】{name}：{text}',
  tieJoin: '{name}は、戦場で出会った{friend}との縁で{faction}に仕えた',
  surrender: '{name}が{faction}に降った',
  defect: '{name}が{from}を見限り、{to}へ寝返った',
  roninJoin: '浪人の{name}が{faction}に仕えた',
  death: '{faction}の{name}が世を去った（{age}歳）',
  succeed: '{faction}：{late}の跡を{name}が継いだ',
  newLord: '{faction}：{name}が当主になった',
  comeOfAge: '{name}が元服し、{faction}に加わった',
  rivalWin: '{name}が好敵手の{rival}を破り、互いに腕を上げた',
  avengeFight: '{name}は仇の{foe}と戦ったが、討ち漏らした',
  avenged: '{name}が仇の{foe}を討ち取った',
  vendetta: '{name}は、{late}を討った{foe}を仇と定めた',
  mentor: '{name}が{mentor}の教えを受けた（Lv{from} → Lv{to}）',
  offer_truce: '{faction}から停戦の申し込みが来た',
  offer_alliance: '{faction}から同盟の申し込みが来た',
  offer_vassal: '{faction}が従属を申し出た',
  vassal: '{faction}が{lord}に従属した',
  joinWar: '{ally}が{a}に加勢し、{b}と戦うことになった',
  questStart: '{name}が諸国巡りに出た',
  questItem: '{name}が諸国巡りから戻り、{item}を持ち帰った',
  questRonin: '{name}が諸国巡りから戻り、浪人の{ronin}を連れ帰った',
  questExp: '{name}が諸国巡りから戻り、見聞を広めた（Lv{from} → Lv{to}）',
  questNothing: '{name}が諸国巡りから戻った（得るものは無かった）',
  build: '{faction}が{prov}に{what}を建てた',
  buildFort: '{faction}が{prov}の城を固めた（城{fort}%）',
  retreated: '{faction}は{prov}の戦いから退いた（兵{troops}隊と兵糧{supply}を失った）',
  capitalMoveStart: '{faction}は本拠を{prov}へ移し始めた（{months}か月かかる）',
  capitalMoved: '{faction}は本拠を{prov}へ移した',
  capitalMoveFailed: '{faction}は{prov}を失い、本拠を移すのを取りやめた',
};
const logLine = (e: CampaignLog): string => {
  // 史実の出来事：本文と、起きた効果。自分の勢力への効果は、いまは起こさない（知らせだけ）
  if (e.key === 'history') return `【史実】${e.vars.text}${e.vars.effects ? `（${e.vars.effects}）` : ''}${e.vars.spared ? '（あなたの家には効果なし）' : ''}${e.vars.later ? '（領の動きは、まだ起こしません）' : ''}${e.vars.choice ? '（あなたの家は、受けるか断るかを選べます）' : ''}`;
  if (e.key === 'historyChoice') return `【史実】${e.vars.result}`;
  return (LOG_TEXT[e.key] ?? e.key).replace(/\{(\w+)\}/g, (_m, k) => String(e.vars[k] ?? ''));
};

export class CampaignScreen {
  private view!: StrategyView;
  private selected = -1;
  private hover = -1;
  /** 出陣・移動させる武将 */
  private picked = new Set<string>();
  private order: 'none' | 'move' | 'attack' = 'none';
  private queue: PendingBattle[] = [];
  private watchTimer = 0;
  private running = false;
  /** つまんで運んでいる兵 */
  private drag: { gid: string; i: number } | null = null;
  private justDragged = false;
  private townRetry = 0;
  /** 「1か月オート」：押した時刻（2度押しでずっとオート）、ずっとオート中か */
  private autoClick = 0;
  private autoOn = false;
  /** 今月の知らせを拾う、月の初めの記録の位置 */
  private logMark = 0;
  /** 攻め込む・攻められる窓を出している間、地図で目立たせる二つの領 */
  private alarm: { from: number; to: number } | null = null;
  private tappedAt = -1e9;
  /** 戦場の下見の絵（領のようす → 絵と、目立つもの）と、開いているか */
  private previews = new Map<string, { url: string; features: string; edge: string }>();
  /** 下見で選んでいる、攻めてくる領（領の番号 → 隣の領） */
  private previewFrom: Record<number, number> = {};
  private previewOpen = false;
  /** 普請で選んでいるもの */
  private buildKind = 'fort';

  private toggleTroopMenu(gid: string, i: number): void {
    this.troopMenu = this.troopMenu?.gid === gid && this.troopMenu.i === i ? null : { gid, i };
    this.refresh();
  }
  /** 入れ替えの欄を開いている兵（武将の番号と、何番目の兵か） */
  private troopMenu: { gid: string; i: number } | null = null;
  /** 「12か月進める」を途中でやめる（やめる・読み込みを押した）ための番号 */
  private runToken = 0;

  constructor(private host: Host, private c: Campaign, private exit: () => void) {
    this.selected = c.player ? c.gs.factions[c.player].capital : -1;
    // 開発時の動作確認（tools/smoke.mjs）から操作できるようにする
    if (import.meta.env.DEV) (window as unknown as { __campaign?: CampaignScreen }).__campaign = this;
    this.mount();
  }

  private date(): string {
    const gs = this.c.gs;
    return `${gs.year < 0 ? `前${-gs.year + 1}` : gs.year}年${gs.month}月`;
  }

  private mount(): void {
    const gs = this.c.gs;
    setScene(null, sceneUrl('setup', gs.variant));
    initTips();
    this.host.root.innerHTML = `
      <div class="battle">
        <canvas></canvas>
        <aside><div id="panel"></div><div id="log"></div></aside>
      </div>`;
    const canvas = this.host.root.querySelector('canvas')!;
    this.view = new StrategyView(canvas);
    this.view.setState(gs, this.c.world);
    this.view.cam.attachInput(
      (sx, sy) => { const p = this.view.pick(sx, sy); if (p !== this.hover) { this.hover = p; this.draw(); } },
      (sx, sy) => this.onClick(this.view.pick(sx, sy)),
    );
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.order = 'none'; this.refresh(); });
    this.attachTroopDrag();
    this.refresh();
  }

  /**
   * 兵をつまんで運ぶ操作。マウスでも指でも同じに動くよう、ポインターの動きで自前に作る
   * （ブラウザ備え付けのドラッグは、指で触る画面では働かない）。
   * 武将の欄に落とすと渡す（渡せないときは理由を出す）。武将の欄の外に落とすと、手放すかを聞く。
   * 情報欄は書き換えのたびに中身が入れ替わるので、外側の枠で受ける。
   */
  private attachTroopDrag(): void {
    const frame = this.host.root.querySelector<HTMLElement>('.battle')!;
    const genAt = (x: number, y: number): HTMLElement | null => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-gen]') ?? null;
    const genAtChip = (x: number, y: number): HTMLElement | null => document.elementFromPoint(x, y)?.closest<HTMLElement>('.chip[data-troop]') ?? null;
    const clearMarks = (): void => frame.querySelectorAll('.drop, .nodrop').forEach((el) => el.classList.remove('drop', 'nodrop'));
    let start: { x: number; y: number; gid: string; i: number; chip: HTMLElement; id: number } | null = null;
    let ghost: HTMLElement | null = null;
    let scrollTimer = 0;
    let py = 0;
    const stop =(): void => {
      clearMarks();
      ghost?.remove(); ghost = null;
      start?.chip.classList.remove('dragging');
      start = null; this.drag = null;
      window.clearInterval(scrollTimer); scrollTimer = 0;
    };
    frame.addEventListener('pointerdown', (e) => {
      const chip = e.target instanceof Element ? e.target.closest<HTMLElement>('.chip[data-troop]') : null;
      if (!chip || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = { x: e.clientX, y: e.clientY, gid: chip.dataset.troop!, i: Number(chip.dataset.i), chip, id: e.pointerId };
    });
    frame.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      py = e.clientY;
      if (!this.drag) {
        // 少し動かしたら、つまんだことにする（動かさずに離せば、ふつうの「押す」）
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
        this.drag = { gid: start.gid, i: start.i };
        this.troopMenu = null;
        start.chip.classList.add('dragging');
        ghost = start.chip.cloneNode(true) as HTMLElement;
        ghost.className = 'chip ghost';
        document.body.appendChild(ghost);
        // 欄の上下の端へ寄せたら、欄を送る（隠れている武将へ運べるように）
        const panel = frame.querySelector<HTMLElement>('#panel');
        scrollTimer = window.setInterval(() => {
          if (!panel) return;
          const r = panel.getBoundingClientRect();
          if (py < r.top + 36) panel.scrollTop -= 14; else if (py > r.bottom - 36) panel.scrollTop += 14;
        }, 30);
      }
      e.preventDefault();
      ghost!.style.left = `${e.clientX + 10}px`; ghost!.style.top = `${e.clientY + 10}px`;
      clearMarks();
      const gen = genAt(e.clientX, e.clientY), to = gen?.dataset.gen;
      // 渡せる相手は枠が金に、渡せない相手は朱になる
      if (gen && to && to !== this.drag.gid) gen.classList.add(moveTroopProblem(this.c, this.drag.gid, this.drag.i, to) ? 'nodrop' : 'drop');
    });
    frame.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const d = this.drag;
      if (!d) {
        // 動かさずに離した：指のときは、ここで兵の欄を開く（運んだ直後などに、ブラウザが「押した」を届けないことがある）
        const s = start;
        start = null;
        if (e.pointerType !== 'mouse' && genAtChip(e.clientX, e.clientY) === s.chip) { this.tappedAt = performance.now(); this.toggleTroopMenu(s.gid, s.i); }
        return;
      }
      // つまんで運んだあとの「押した」は無かったことにする（入れ替えの欄が開かないように）
      this.justDragged = true;
      window.setTimeout(() => { this.justDragged = false; }, 0);
      const gen = genAt(e.clientX, e.clientY);
      stop();
      const c = this.c;
      if (!holderOf(c, d.gid)?.troops[d.i]) { this.refresh(); return; }
      if (gen) {
        const to = gen.dataset.gen!;
        if (to !== d.gid && holderOf(c, to)) {
          const problem = moveTroopProblem(c, d.gid, d.i, to);
          if (problem) toast(`${this.holderName(to)}には渡せません：${problem}`);
          else transferTroop(c, d.gid, d.i, to);
        }
        this.refresh();
        return;
      }
      this.askDismiss(d.gid, d.i);
    });
    frame.addEventListener('pointercancel', stop);
  }

  /** 窓を出す枠 */
  private frame(): HTMLElement { return this.host.root.querySelector<HTMLElement>('.battle')!; }

  /** 武将の後ろ姿（顔は描かない）。役割と性別で選ぶ */
  private figure(g: GGeneral): string {
    const v = this.c.gs.variant;
    const role = g.isLord || g.role === 'heir' ? 'lord' : g.sex === 'f' ? 'woman' : !g.faction || g.role === 'hero' ? 'wanderer'
      : g.role === 'minister' ? 'strategist' : g.role === 'scholar' || g.role === 'artist' ? 'monk'
      : g.stats.int > g.stats.str + 10 ? 'strategist' : 'general';
    const url = artUrl(`figure/${v}/${role}`);
    return url ? `<img class="fig" src="${url}" alt="" draggable="false">` : '';
  }

  /** 自分の勢力の動きもおまかせにして、1か月進める */
  private autoOne(news: boolean): void {
    const c = this.c;
    if (c.over) { this.stopAuto(); return; }
    this.order = 'none'; this.picked.clear();
    const mark = c.log.length;
    autoMonth(c);
    c.log.push({ key: 'month', vars: { date: this.date() } });
    this.autosave();
    this.mount();
    if (news) this.showNews(mark);
  }

  /** ずっとオート：どこかを押すまで、1か月ずつおまかせで進める */
  private startAuto(): void {
    this.autoOn = true;
    this.refresh();
    const token = ++this.runToken;
    const stop = (e: Event): void => { e.stopPropagation(); e.preventDefault(); this.stopAuto(); };
    // 2度目の押す操作が終わってから、止めるための「押す」を待つ
    window.setTimeout(() => { if (this.autoOn) window.addEventListener('pointerdown', stop, { capture: true, once: true }); }, 0);
    this.stopListener = stop;
    const step = (): void => {
      if (!this.autoOn || token !== this.runToken) return;
      this.autoOne(false);
      if (this.c.over) { this.stopAuto(); return; }
      this.watchTimer = window.setTimeout(step, 450);
    };
    this.watchTimer = window.setTimeout(step, 60);
  }

  private stopListener: ((e: Event) => void) | null = null;

  private stopAuto(): void {
    if (!this.autoOn) return;
    this.autoOn = false;
    clearTimeout(this.watchTimer);
    if (this.stopListener) window.removeEventListener('pointerdown', this.stopListener, { capture: true });
    this.stopListener = null;
    toast('手動に戻しました');
    this.refresh();
  }

  /** 今月の、自分の勢力にかかわる大きな出来事を、絵を添えた窓で知らせる（亡くなった・代替わり・寝返り・外交・諸国巡り・仕官） */
  private showNews(from: number): void {
    const c = this.c, me = c.player ? c.gs.factions[c.player] : null;
    if (!me || c.over) return;
    const KIND: Record<string, string> = {
      death: 'death', succeed: 'succession', newLord: 'succession', defect: 'defect', alliance: 'envoy', truce: 'envoy', vassal: 'envoy', breakAlliance: 'envoy', joinWar: 'envoy',
      questItem: 'travel', questRonin: 'travel', questExp: 'travel', questNothing: 'travel', roninJoin: 'promote', tieJoin: 'promote', comeOfAge: 'promote', history: 'history',
    };
    const ORDER = ['death', 'defect', 'succession', 'history', 'envoy', 'travel', 'promote'];
    // 史実の出来事は、大きなもの（imp 2 以上）か、自分の勢力の名前が出るものを知らせる
    const items = c.log.slice(from).filter((e) => KIND[e.key] && (e.key.startsWith('quest') || Object.values(e.vars).some((v) => v === me.name.ja)
      || (e.key === 'history' && (Number(e.vars.imp) >= 2 || String(e.vars.text).includes(me.name.ja)))));
    if (!items.length) return;
    const kind = ORDER.find((k) => items.some((e) => KIND[e.key] === k))!;
    const TITLE: Record<string, string> = { death: '訃報', defect: '寝返り', succession: '代替わり', history: '史実の出来事', envoy: '外交の知らせ', travel: '諸国巡りから', promote: '新たな顔ぶれ' };
    void confirmBox(this.frame(), {
      title: `今月の知らせ：${TITLE[kind]}`, banner: sceneUrl(kind === 'history' ? 'envoy' : kind, c.gs.variant),
      body: `<ul class="news">${items.slice(0, 8).map((e) => `<li>${esc(logLine(e))}</li>`).join('')}</ul>`,
      ok: '閉じる', single: true,
    });
  }

  /** 名前を入れる窓（武将や兵の名前の変更、兵を武将に取り立てるときの名前） */
  private askName(title: string, value: string, note: string, done: (name: string) => void, banner: string | null = null): void {
    this.host.root.querySelector('.result.ask')?.remove();
    const box = document.createElement('div');
    box.className = 'result ask';
    box.innerHTML = `${banner ? bannerHtml(banner) : ''}<h2 class="wrap">${esc(title)}</h2>
      <p><input type="text" maxlength="${S.officer.nameMax}" value="${esc(value)}" class="name" autocomplete="off" autocapitalize="off" enterkeyhint="done"></p>
      <p class="dim small">${esc(note)}</p>
      <button class="primary" data-a="ok">決める</button> <button data-a="no">やめる</button>`;
    this.host.root.querySelector('.battle')!.appendChild(box);
    const input = box.querySelector('input')!;
    input.focus(); input.select();
    const finish = (ok: boolean): void => { const v = input.value; box.remove(); if (ok) done(v); this.refresh(); };
    input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); e.stopPropagation(); };
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.onclick = () => finish(b.dataset.a === 'ok'); });
  }

  /** 兵の持ち主の呼び名（武将の名前か、「予備兵」） */
  private holderName(key: string): string {
    return holderOf(this.c, key)?.general?.name.ja ?? '予備兵';
  }

  /** 武将を兵に下げるかを聞く窓 */
  private askLower(gid: string): void {
    const c = this.c, g = c.gs.generals[gid];
    if (!g) return;
    this.host.root.querySelector('.result.ask')?.remove();
    const problem = lowerProblem(c, g);
    const box = document.createElement('div');
    box.className = 'result ask';
    box.innerHTML = `<h2 class="wrap">${esc(g.name.ja)}を兵にする</h2>
      <p>兵糧が${lowerRefund(g.level)}戻ります。</p>
      <p class="dim small">武将ではなくなり、この領の予備兵1隊になります（名前とレベルは残ります。能力・特性・縁は残りません）。${g.troops.length ? `率いている${g.troops.length}隊も予備兵になります。` : ''}元には戻せません。</p>
      ${problem ? `<p class="status">${esc(problem)}</p>` : ''}
      <button data-a="yes" ${problem ? 'disabled' : ''}>兵にする</button> <button class="primary" data-a="no">やめる</button>`;
    this.host.root.querySelector('.battle')!.appendChild(box);
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => { if (b.dataset.a === 'yes' && lowerToTroop(c, gid)) this.picked.delete(gid); box.remove(); this.refresh(); };
    });
  }

  /** 兵の名前の札（自分の兵は、つまんで運べる） */
  private chipHtml(key: string, t: GTroop, i: number): string {
    const unit = L(D.byUnit[t.unitId].name);
    return `<button class="chip ${this.troopMenu?.gid === key && this.troopMenu.i === i ? 'on' : ''}" data-troop="${key}" data-i="${i}" data-tip="${esc(`${unitTip(t.unitId, t.level)}\n\nつまんで別の武将や予備兵へ運ぶと渡せます。欄の外へ落とすと手放すかを聞きます。押すと、名前の変更などの欄が開きます。`)}">${this.icon(t.unitId)}<span class="nm">${esc(t.name ?? unit)}</span><span class="dim">${t.level}</span></button>`;
  }

  /** 兵の名前の横に添える、小さな兵の絵（絵の無い兵種は名前だけ） */
  private icon(unitId: string): string {
    const url = artUrl(`unit/${this.c.gs.variant}/${unitId}`);
    return url ? `<img class="uicon" src="${url}" alt="" draggable="false">` : '';
  }

  /** 領の予備兵の欄（どの武将にも付いていない兵。ここへ兵を運ぶと予備兵になり、ここから武将へ運ぶと付けられる） */
  private reserveHtml(prov: number): string {
    const c = this.c, key = reserveKey(prov), list = reserveOf(c, prov);
    return `<div class="gen reserve" data-gen="${key}"><span><b>予備兵</b> <span class="dim">${list.length}/${S.reserve.max}隊　戦いには出ません。武将へ運ぶと付けられます</span><br>
      <span class="troops">${list.map((t, i) => this.chipHtml(key, t, i)).join('') || '<span class="dim">なし（兵をここへ運ぶと、予備兵になります）</span>'}</span> ${this.troopMenuHtml(key)}</span></div>`;
  }

  /** 兵を手放すかを聞く窓（武将の欄の外へ落としたとき） */
  private askDismiss(gid: string, i: number): void {
    const c = this.c, t = holderOf(c, gid)?.troops[i];
    if (!t) return;
    this.host.root.querySelector('.result.ask')?.remove();
    const box = document.createElement('div');
    box.className = 'result ask';
    box.innerHTML = `<h2>手放しますか？</h2>
      <p class="wrap">${esc(this.holderName(gid))}の${esc(t.name ?? L(D.byUnit[t.unitId].name))}（Lv${t.level}）</p>
      <p class="dim small">手放した兵は戻りません。兵糧も戻りません。</p>
      <button data-a="yes">手放す</button> <button class="primary" data-a="no">やめる</button>`;
    this.host.root.querySelector('.battle')!.appendChild(box);
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => { if (b.dataset.a === 'yes') dismissTroop(c, gid, i); box.remove(); this.refresh(); };
    });
  }

  private mine(): GGeneral[] {
    return this.selected >= 0 && this.c.player ? generalsAt(this.c, this.selected, this.c.player) : [];
  }
  private pickedHere(): string[] {
    return this.mine().filter((g) => this.picked.has(g.id) && !this.c.moved.has(g.id)).map((g) => g.id);
  }

  private targets(kind: 'move' | 'attack'): Set<number> {
    const c = this.c, out = new Set<number>();
    if (this.selected < 0 || !c.player || !this.pickedHere().length) return out;
    // 移動は、自分の領づたいに3つ先まで。攻めるのは隣の領だけ
    if (kind === 'move') return moveTargets(c, this.selected, c.player);
    for (const n of neighborsOf(c, this.selected)) {
      const owner = c.gs.provinces[n].owner;
      if (owner !== c.player && canAttack(c, c.player, owner)) out.add(n);
    }
    return out;
  }

  private onClick(prov: number): void {
    const c = this.c;
    if (prov < 0 || c.over) return;
    if (this.order !== 'none' && c.player) {
      const ok = this.targets(this.order).has(prov);
      if (ok && this.order === 'move') {
        for (const id of this.pickedHere()) moveGeneral(c, id, prov);
        this.picked.clear(); this.order = 'none'; this.selected = prov;
      } else if (ok) {
        const pb = planAttack(c, c.player, this.selected, prov, this.pickedHere());
        this.order = 'none'; this.picked.clear();
        if (pb) { void busy('攻め込んでいます…', () => this.fight(pb, 0, () => this.mount())); return; }
      } else this.order = 'none';
      this.refresh();
      return;
    }
    this.selected = prov; this.picked.clear();
    this.refresh();
  }

  /**
   * 戦いを決着させる。守る武将がいれば、自分で戦うか、おまかせかを選ぶ。
   * 守る武将がいなければ守備兵との戦いになり、観戦（両方おまかせ）で始まる（手動に切り替えると、自分の側を動かせる）。
   */
  private fight(pb: PendingBattle, side: Side, after: () => void): void {
    const c = this.c, gs = c.gs;
    const p = gs.provinces[pb.prov];
    const who = side === 0 ? `${p.name.ja}へ攻め込みます` : `${gs.factions[pb.attacker]?.name.ja ?? ''}が${p.name.ja}へ攻めてきました`;
    const names = (ids: string[]) => ids.map((id) => `${gs.generals[id].name.ja}（Lv${gs.generals[id].level}・兵${gs.generals[id].troops.length}）`).join('、');
    // 守る武将がいなければ、守備兵が相手。選べるのは「観戦」か「おまかせ」（観戦のあとで、戦闘画面の「手動にする」を押せば自分で動かせる）
    const garrison = !pb.def.length, g = garrisonOf(c, pb.prov);
    const box = document.createElement('div');
    box.className = 'result low';
    const fromName = gs.provinces[pb.from]?.name.ja ?? '';
    box.innerHTML = `${bannerHtml(sceneUrl('setup', gs.variant))}<h2>${esc(who)}</h2>
      <p class="where"><span class="from">${esc(fromName)}</span> から <span class="to">${esc(p.name.ja)}</span> へ <span class="dim small">（地図に朱と金で示しています）</span></p>
      <p>攻め手：${esc(names(pb.atk))}</p>
      <p>守り手：${garrison ? `守備兵（Lv${g.level}・${g.troops}隊）<span class="dim">　守る武将はいません</span>` : esc(names(pb.def))}</p>
      ${garrison
        ? '<button class="primary" data-a="play">自分で戦う</button> <button data-a="watch">観戦</button> <button data-a="auto">おまかせ</button><p class="dim small">自分で戦うは、自分の側を動かします。観戦は、戦いを見ます（途中で「手動にする」を押すと、自分で動かせます）。おまかせは、結果だけ出ます。</p>'
        : '<button class="primary" data-a="play">自分で戦う</button> <button data-a="auto">おまかせ</button>'}`;
    this.host.root.querySelector('.battle')!.appendChild(box);
    // 攻めてきた領と攻められた領を、地図で目立たせて真ん中へ寄せる
    this.alarm = { from: pb.from, to: pb.prov };
    this.view.focusOn(pb.from, pb.prov);
    this.draw();
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        this.alarm = null;
        if (b.dataset.a === 'auto') { void busy('戦っています…', () => { resolveBattle(c, pb); after(); }); return; }
        const human = b.dataset.a === 'watch' ? new Set<Side>() : new Set<Side>([side]);
        void busy('戦場を用意しています…', () => this.host.openBattle(battleFor(c, pb), human, (st) => resolveBattle(c, pb, st), { label: '戦略マップへ', fn: after }, false, side));
      };
    });
  }

  /** 攻められた戦いを順に決着させ、すべて終わったら月を締める */
  private nextQueued(): void {
    const pb = this.queue.shift();
    if (pb) { this.mount(); this.fight(pb, 1, () => this.nextQueued()); return; }
    finishMonth(this.c);
    this.c.log.push({ key: 'month', vars: { date: this.date() } });
    this.autosave();
    this.mount();
    this.showNews(this.logMark);
  }

  private advance(): void {
    const c = this.c;
    this.order = 'none'; this.picked.clear();
    if (!c.player) { autoMonth(c); c.log.push({ key: 'month', vars: { date: this.date() } }); if (!this.running) this.autosave(); this.refresh(); return; }
    this.logMark = c.log.length;
    this.queue = endMonth(c);
    this.nextQueued();
  }

  /** 月が変わるたびに、自動の枠へ保存する（失敗しても遊びは続ける） */
  private autosave(): void { void writeSlot('auto', snapshot(this.c)); }

  private draw(): void {
    const c = this.c;
    const counts = new Map<number, number>();
    for (const g of Object.values(c.gs.generals)) {
      if (!g.faction || g.prov < 0) continue;
      if (c.player && g.faction !== c.player && c.gs.provinces[g.prov].owner !== g.faction) continue;
      counts.set(g.prov, (counts.get(g.prov) ?? 0) + 1);
    }
    const wars = new Set<string>();
    for (const w of c.gs.wars) for (const a of w.attackers) for (const b of w.defenders) wars.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    const sieges = new Map<number, number>();
    for (const [k, sg] of Object.entries(c.sieges)) sieges.set(Number(k), sg.progress / siegeResist(c, Number(k)));
    this.view.hl = {
      wars, sieges,
      selected: this.selected, hover: this.hover, counts, player: c.player || undefined,
      move: this.order === 'move' ? this.targets('move') : undefined,
      attack: this.order === 'attack' ? this.targets('attack') : undefined,
      alarm: this.alarm ?? undefined,
    };
    this.view.draw();
  }

  private generalHtml(g: GGeneral, own: boolean): string {
    const c = this.c, cls = D.byClass[g.classId];
    // 兵の名前の横に、小さな兵の絵を添える（絵の無い兵種は名前だけ）
    const icon = (unitId: string): string => { const url = artUrl(`unit/${c.gs.variant}/${unitId}`); return url ? `<img class="uicon" src="${url}" alt="" draggable="false">` : ''; };
    // 自分の武将の兵は、つまんで別の武将の欄へ運ぶと渡せる。武将の欄の外へ落とすと、手放すかを聞く。
    // （指で触る画面ではつまんで運べないので、押すと渡す・手放すの欄が開く動きも残してある）
    const troops = g.troops.map((t, i) => own
      ? this.chipHtml(g.id, t, i)
      : `<span class="tname" data-tip="${esc(unitTip(t.unitId, t.level))}">${icon(t.unitId)}<span class="nm">${esc(t.name ?? L(D.byUnit[t.unitId].name))}</span><span class="dim">${t.level}</span></span>`).join(own ? '' : '、') || '<span class="dim">兵なし</span>';
    const moved = c.moved.has(g.id);
    const check = own ? `<input type="checkbox" data-pick="${g.id}" ${this.picked.has(g.id) ? 'checked' : ''} ${moved ? 'disabled' : ''}>` : '';
    let rec = '';
    if (own) {
      const f = c.gs.factions[g.faction];
      const opts = Object.keys(f.recruit).filter((u) => !recruitProblem(c, g, u))
        .map((u) => `<option value="${u}">${L(D.byUnit[u].name)}（兵糧${recruitCost(u, f, isExclave(c, g.prov))}）</option>`).join('');
      rec = opts ? `<span class="rec"><select data-unit="${g.id}">${opts}</select><button data-recruit="${g.id}">徴兵</button></span>` : '';
      // 昇進：武将は役職、兵は兵種。条件を満たした昇進先だけをボタンにする
      const ups: string[] = [];
      for (const p of generalPromotions(g)) {
        if (p.ok) ups.push(`<button data-promo="${g.id}" data-to="${p.to.id}">昇進：${L(p.to.name)}</button>`);
      }
      g.troops.forEach((t, i) => {
        for (const p of troopUpgrades(g, i, c.items)) {
          if (p.ok) ups.push(`<button data-up="${g.id}" data-i="${i}" data-to="${p.to}">${L(D.byUnit[t.unitId].name)} → ${L(D.byUnit[p.to].name)}</button>`);
        }
      });
      if (!g.isLord && !(g.id in c.away)) ups.push(`<button data-lower="${g.id}" title="武将ではなくなり、この領の予備兵1隊になります。兵糧が${lowerRefund(g.level)}戻ります">兵にする</button>`);
      // 訓練：1か月訓練（行動済みになる）と、ずっと訓練（切り替え。その月ほかの命令で動いたときは訓練しない）
      const tp = trainProblem(c, g), always = c.training?.[g.id] === 'always', tm = trainMult(c, g);
      const multText = tm.mult > 1 ? `経験値×${Math.round(tm.mult * 100) / 100}（${tm.why.join('・')}）` : '経験値×1';
      ups.push(`<button data-train="${g.id}" ${tp ? `disabled title="${esc(tp)}"` : `title="${esc(`この月は訓練して行動済みになります。月の終わりに、${g.name.ja}と配下の兵に経験値が入ります。${multText}`)}"`}>1か月訓練</button>`);
      ups.push(`<button data-train-always="${g.id}" class="${always ? 'on' : ''}" title="${esc(`毎月の終わりに訓練します（その月に移動・攻めるなどで動かしたときは訓練しません）。${multText}`)}">ずっと訓練：${always ? '入' : '切'}</button>`);
      if (!questProblem(c, g)) ups.push(`<button data-quest="${g.id}" title="2か月のあいだ戦えないが、浪人や昇進の品を得ることがある">諸国巡りに出す</button>`);
      if (ups.length) rec += `<div class="ups">${ups.join('')}</div>`;
    }
    const pers = personalityOf(g.traits, g.ab), plabel = personalityLabel(pers);
    const fig = this.figure(g);
    return `<div class="gen" ${own ? `data-gen="${g.id}"` : ''}>${check}${fig}<span><b class="wrap gname" data-profile="${g.id}" title="押すと、能力と列伝を読めます">${esc(g.name.ja)}</b>${own ? `<button class="pen" data-rename="${g.id}" title="名前を変える">✎</button>` : ''}${g.isLord ? ' <span class="tag">当主</span>' : ''}
      ${L(cls.name)} Lv${g.level} <span class="dim">強さ${Math.round(strengthOf(g))} 采配${troopLoad(g)}/${g.command}${moved ? ' ・行動済' : ''}${own && (c.trainedThisMonth ?? []).includes(g.id) ? ' ・今月は訓練' : own && c.training?.[g.id] === 'always' ? ' ・ずっと訓練' : ''}
      ${g.traits.length ? ` ・${g.traits.map((t) => `<span class="trait" data-tip="${esc(traitTip(t))}">${TRAIT_NAME[t] ?? t}</span>`).join('・')}` : ''}
      ・<span class="trait" data-tip="${esc(personalityTip(pers, plabel))}">性格：${plabel}</span></span><br>
      <span class="troops">${troops}</span> ${own ? this.troopMenuHtml(g.id) : ''}${rec}</span></div>`;
  }

  /** 包囲の進み具合（守る武将のいない領が攻められているとき） */
  private siegeHtml(prov: number): string {
    const c = this.c, sg = c.sieges[prov];
    if (!sg || !c.gs.factions[sg.by]) return '';
    return `<div class="card status">${esc(c.gs.factions[sg.by].name.ja)}に囲まれている：${Math.floor((sg.progress / siegeResist(c, prov)) * 100)}%（100%で落ちる）</div>`;
  }

  /** ほかの勢力の領を選んだときの、外交の操作。できないものは理由を添えて押せなくする */
  private diplomacyHtml(me: number, other: number): string {
    const c = this.c, rel = relation(c, me, other);
    const btn = (kind: string, label: string, problem: string | null) =>
      `<button data-dip="${kind}" data-to="${other}" ${problem ? `disabled title="${esc(problem)}"` : ''}>${label}</button>${problem ? `<span class="dim small">${esc(problem)}</span>` : ''}`;
    const opinion = Math.round(c.gs.factions[other].opinions[me] ?? 0);
    let buttons = '';
    if (rel === 'neutral') buttons = btn('ally', '同盟を申し込む', allianceProblem(c, me, other)) + btn('war', '戦を仕掛ける', null);
    else if (rel === 'war') buttons = btn('truce', '停戦を申し込む', truceProblem(c, me, other));
    else if (rel === 'ally') {
      // 味方には、今戦っている相手への加勢を頼める
      for (const e of playerEnemies(c)) {
        if (e === other) continue;
        const problem = callProblem(c, other, e);
        if (problem === 'すでに戦っています') continue;
        buttons += `<button data-call="${other}" data-enemy="${e}" ${problem ? `disabled title="${esc(problem)}"` : ''}>${esc(c.gs.factions[e].name.ja)}への加勢を頼む</button>${problem ? `<span class="dim small">${esc(problem)}</span>` : ''}`;
      }
      if (c.gs.alliances.some(([x, y]) => (x === me && y === other) || (x === other && y === me))) buttons += btn('break', '同盟を破る', null);
    }
    return `<div class="dip"><span class="dim">外交（相手の心証 ${opinion}）</span>${buttons}</div>`;
  }

  /** 史実の領の動きで、自分の家にかかわるもの（受けるか断るかを選ぶ。放っておくと断ったことになる） */
  private choicesHtml(): string {
    const c = this.c;
    // 絵は付けない（いくつも並ぶことがあるため、小さく）
    return (c.history.choices ?? []).map((ch) => `<div class="card status hchoice">
        <div><b>史実：</b>${esc(choiceLine(c, ch))} <span class="dim small">あと${Math.max(0, ch.until - c.gs.tick)}か月（過ぎると断ったことになる）</span></div>
        <div class="dip"><button data-hchoice="${esc(ch.id)}" data-yes="1">受ける</button><button data-hchoice="${esc(ch.id)}">断る</button></div>
      </div>`).join('');
  }

  /** ほかの勢力からの申し込み（受けるか断るかを選ぶ。放っておくと流れる） */
  private offersHtml(): string {
    const c = this.c, KIND = { truce: '停戦', alliance: '同盟', vassal: '従属' } as const;
    const envoy = sceneUrl('envoy', c.gs.variant);
    return this.choicesHtml() + c.offers.filter((o) => c.gs.factions[o.from]).map((o) => `<div class="card status">
        ${envoy ? `<div class="vignette" style="background-image:url('${envoy}')"></div>` : ''}
        <div>${esc(c.gs.factions[o.from].name.ja)}から${KIND[o.kind]}の申し込み${o.months ? `（${o.months}か月）` : ''} <span class="dim small">${o.hist ? '史実の出来事から・' : ''}あと${o.until - c.gs.tick}か月</span></div>
        <div class="dip"><button data-offer="${o.from}" data-yes="1">受ける</button><button data-offer="${o.from}">断る</button></div>
      </div>`).join('');
  }

  /** 兵の入れ替えの欄（押した兵について：同じ領の武将や予備兵へ渡す、手放す、名前を変える、武将にする） */
  private troopMenuHtml(key: string): string {
    const c = this.c, m = this.troopMenu, h = holderOf(c, key);
    if (!m || m.gid !== key || !h?.troops[m.i]) return '';
    const t = h.troops[m.i], name = t.name ?? L(D.byUnit[t.unitId].name);
    const others = [...generalsAt(c, h.prov, h.faction), ...awayAt(c, h.prov, h.faction)].filter((o) => o.id !== key);
    // 押せないボタンは、理由を横に添える（指で触る画面では、ボタンに重ねた説明が出ないため）
    const why = (p: string | null): string => (p ? `<span class="dim small">${esc(p)}</span>` : '');
    const give = others.map((o) => {
      const problem = moveTroopProblem(c, key, m.i, o.id);
      return `<button data-give="${o.id}" ${problem ? `disabled title="${esc(problem)}"` : ''}><span class="nm">${esc(o.name.ja)}</span>へ<span class="dim">（采配${troopLoad(o)}/${o.command}）</span></button>`;
    }).join('');
    const rk = reserveKey(h.prov), rp = h.general ? moveTroopProblem(c, key, m.i, rk) : null;
    const raise = raiseProblem(c, key, m.i);
    return `<div class="tmenu"><span class="dim wrap">${esc(name)}を</span>${give ? `<div class="gives">${give}</div>` : '<span class="dim">渡せる武将がいません</span>'}
      ${h.general ? `<button data-give="${rk}" ${rp ? 'disabled' : ''}>予備兵にする</button>${why(rp)}` : ''}
      <button data-dismiss="1">手放す</button>
      <button data-tname="1">名前を変える</button>
      <button data-raise="1" ${raise ? `disabled title="${esc(raise)}"` : ''}>武将にする（兵糧${raiseCost(t.level)}）</button>${why(raise)}
      <button data-tclose="1">やめる</button>
      <div class="udesc small">${esc(unitTip(t.unitId, t.level))}</div></div>`;
  }

  /** 飛び地の警告：何が悪くなっているかと、直し方（取ればつながる領の名前） */
  private exclaveHtml(prov: number): string {
    const c = this.c, gs = c.gs, p = gs.provinces[prov], f = gs.factions[p.owner];
    const link = exclaveLink(c, prov).map((id) => gs.provinces[id]);
    const names = link.slice(0, 4).map((q) => `<b>${esc(q.name.ja)}</b>${q.owner && gs.factions[q.owner] ? `<span class="dim">（${esc(gs.factions[q.owner].name.ja)}）</span>` : '<span class="dim">（持ち主なし）</span>'}`).join('・');
    const how = link.length
      ? `${names}${link.length > 4 ? ` ほか、計${link.length}領` : ''}を取ると、本拠（${esc(gs.provinces[f.capital].name.ja)}）とつながって解けます。本拠をこちら側へ移しても（下の「本拠を移す」）、数え直されます。`
      : `本拠（${esc(gs.provinces[f.capital].name.ja)}）とつながる道がありません。まわりの領を取って、本拠からの道をつくってください。`;
    return `<div class="exclave"><b>⚠ 飛び地です</b>　本拠から、自分の領づたい（陸の隣と海路）にたどり着けません。
      <div class="small">罰：収入${Math.round(S.exclave.incomeMult * 100)}%・守備兵が弱い（レベル${Math.abs(S.exclave.garrisonLevel)}減・${Math.abs(S.exclave.garrisonTroops)}隊減）・徴兵の兵糧×${S.exclave.recruitCostMult}・ここを守る戦いと、ここから攻めて出る戦いでは攻撃・防御${S.exclave.battleAtkDefPct}%</div>
      <div class="small">直し方：${how}</div></div>`;
  }

  /** 戦場の下見：この領で今戦うとどんな戦場になるか（領のようすが変わるたびに作り直す） */
  private previewHtml(prov: number): string {
    const c = this.c, gs = c.gs, p = gs.provinces[prov];
    // どこから攻めるか：隣の領から選べる。はじめは、自分の領のうち隣にあるもの（無ければ最初の隣）
    const nbs = neighborsOf(c, prov);
    if (!nbs.includes(this.previewFrom[prov] ?? -1)) this.previewFrom[prov] = nbs.find((n) => c.player && gs.provinces[n].owner === c.player && p.owner !== c.player) ?? nbs[0] ?? -1;
    const from = this.previewFrom[prov];
    const key = `${prov}:${from}:${JSON.stringify(provinceLook(c, prov))}`;
    let pv = this.previews.get(key);
    if (!pv) {
      const m = provinceMap(c, prov, from >= 0 ? from : undefined);
      pv = { url: mapPreviewUrl(m), features: (m.features ?? []).join('・'), edge: m.edgeName ?? '' };
      if (this.previews.size > 60) this.previews.clear();
      this.previews.set(key, pv);
    }
    const opts = nbs.map((n) => `<option value="${n}" ${n === from ? 'selected' : ''}>${esc(gs.provinces[n].name.ja)}${gs.provinces[n].owner === c.player && c.player ? '（自領）' : ''}から</option>`).join('');
    return `<details class="bmap" ${this.previewOpen ? 'open' : ''}><summary>戦場：${esc(pv.features || '野戦')}</summary>
      ${nbs.length ? `<div class="rec"><select id="pvFrom" title="どの領から攻めると、どんな戦場になるか">${opts}</select><span class="dim small">${esc(pv.edge)}の端から攻める</span></div>` : ''}
      <img src="${pv.url}" alt="この領の戦場" draggable="false">
      <div class="dim small">北が上で、地形は本当の地理のままです。攻め手は攻めてきた方角の端（「攻」）から入り、守り手と城は反対側。どこから攻めるかで、山や川の有利・不利が変わります。領の地形・人口・収入・不穏・城の強さ・建物で形が決まり、普請や本拠の移りでも変わります。</div></details>`;
  }

  /** 本拠を移す欄：移している最中なら残りの月、そうでなければ費用と月数とボタン */
  private capitalHtml(prov: number): string {
    const c = this.c, gs = c.gs, me = gs.factions[c.player], p = gs.provinces[prov];
    if (!me) return '';
    const r = c.relocations[me.id];
    if (r) return r.to === prov ? `<div class="card status">本拠をここへ移しているところです（あと${Math.max(0, r.until - gs.tick)}か月。${esc(gs.provinces[me.capital].name.ja)}から）。途中でこの領を失うと取りやめになり、兵糧は戻りません。</div>` : '';
    if (me.capital === prov) return '';
    const plan = relocationPlan(c, me.id, prov), problem = relocationProblem(c, me.id, prov);
    return `<div class="card build"><div><b>本拠を移す</b> <span class="dim small">兵糧${plan.cost}・${plan.months}か月かかる</span></div>
      <div class="dim small">本拠は城になり、守りが固くなります。飛び地は、新しい本拠から数え直します。${problem ? `<br>${esc(problem)}` : ''}</div>
      <div><button id="moveCapital" ${problem ? 'disabled' : ''}>${esc(p.name.ja)}を本拠にする</button></div></div>`;
  }

  /** 普請の欄：建物を建てる、城を固める */
  private buildHtml(prov: number): string {
    const c = this.c, p = c.gs.provinces[prov];
    const unusable = (k: string) => k !== 'fort' && (p.buildings.includes(k) || (!!BM.buildings[k]?.coastal && !p.coastal));
    if (unusable(this.buildKind)) this.buildKind = 'fort';
    const fortNext = Math.round(Math.min(BM.build.fortMax, p.fort + BM.build.fortStep) * 100);
    const opts = BUILD_KINDS.map((k) => {
      const name = k === 'fort' ? `城を固める（城${Math.round(p.fort * 100)}% → ${fortNext}%）` : BM.buildings[k]?.name ?? k;
      const tail = k !== 'fort' && p.buildings.includes(k) ? '（建っている）' : unusable(k) ? '（海沿いの領だけ）' : `（兵糧${buildCost(c, prov, k)}）`;
      return `<option value="${k}" ${k === this.buildKind ? 'selected' : ''} ${unusable(k) ? 'disabled' : ''}>${esc(name + tail)}</option>`;
    }).join('');
    const k = this.buildKind, problem = buildProblem(c, c.player, prov, k);
    const text = k === 'fort' ? '城の強さが上がります。守備兵が強くなり、戦場の拠点が 陣 → 砦 → 城 → 城壁つきの城 と変わっていきます。' : BM.buildings[k]?.text ?? '';
    const have = p.buildings.map((b) => BM.buildings[b]?.name ?? b).join('・');
    return `<div class="card build"><div><b>普請</b> <span class="dim small">建てたものは、この領の戦場に現れます（1つの領で1か月に1回）</span></div>
      ${have ? `<div class="small">建っているもの：${esc(have)}</div>` : ''}
      <div class="rec"><select id="buildKind">${opts}</select><button id="buildGo" ${problem ? 'disabled' : ''}>普請する</button></div>
      <div class="dim small">${esc(text)}${problem ? `<br>${esc(problem)}` : ''}</div></div>`;
  }

  private itemsText(): string {
    const list = Object.entries(this.c.items).filter(([, n]) => n > 0).map(([id, n]) => `${D.items[id]?.[this.c.gs.variant] ?? id}×${n}`);
    return list.length ? `　品：${list.join('、')}` : '';
  }

  private refresh(): void {
    const c = this.c, gs = c.gs;
    bgm(`map_${gs.variant}`);
    this.draw();
    const me = c.player ? gs.factions[c.player] : null;
    const p = this.selected >= 0 ? gs.provinces[this.selected] : null;
    let body = '<div class="card dim">領をクリックすると情報が出ます。</div>';
    if (p) {
      const owner = gs.factions[p.owner];
      const own = !!me && p.owner === me.id;
      const gens = owner ? generalsAt(c, p.id, owner.id) : [];
      const rel = me && owner && !own ? `（${REL_NAME[relation(c, me.id, owner.id)]}）` : '';
      const picked = this.pickedHere().length;
      const town = this.view.townImage(p.id);
      // 町の絵がまだ読めていなければ、少し待って描き直す（地図の絵は、あとから読み込まれる）
      if (!town && !this.townRetry) this.townRetry = window.setTimeout(() => { this.townRetry = 0; if (this.host.root.contains(this.view.canvas)) this.refresh(); }, 400);
      body = `<div class="card">
          ${town ? `<img class="town" src="${town}" alt="" draggable="false">` : ''}
          <div><b>${esc(p.name.ja)}</b> ${owner ? factionBadge(owner.name.ja, owner.color) : '<span class="dim">持ち主なし</span>'}<span class="dim">${rel}${owner?.capital === p.id ? '・本拠' : ''}</span></div>
          <div class="dim">人口${Math.round(p.pop)} 収入${Math.round(p.income)} 城${Math.round(p.fort * 100)}% 不穏${Math.round(p.unrest * 100)}%${p.coastal ? ' 海沿い' : ''}</div>
          ${owner && isExclave(c, p.id) ? this.exclaveHtml(p.id) : ''}
          ${this.previewHtml(p.id)}
        </div>
        ${this.siegeHtml(p.id)}${me && owner && !own ? this.diplomacyHtml(me.id, owner.id) : ''}
        ${own ? `<div class="actions row">
          <button id="move" ${picked ? '' : 'disabled'} class="${this.order === 'move' ? 'on' : ''}" title="自分の領づたいに行ける所まで">移動（${S.move.range}つ先まで）</button>
          <button id="attack" ${picked && picked <= MAX_GENERALS ? '' : 'disabled'} class="${this.order === 'attack' ? 'on' : ''}">攻める（${MAX_GENERALS}人まで）</button>
        </div><div class="dim">${this.order === 'move' ? '青い領をクリックで移動（自分の領づたいに行ける所）' : this.order === 'attack' ? '赤い領をクリックで侵攻' : '武将にチェックを入れて、移動か攻めるを選びます'}</div>` : ''}
        ${own && gens.some((g) => !c.moved.has(g.id)) ? `<div class="sel"><span class="dim">まとめて選ぶ</span>
          <button id="selAll">全員</button><button id="selTop">レベルの高い${MAX_GENERALS}人</button><button id="selNone" ${picked ? '' : 'disabled'}>外す</button></div>` : ''}
        <div class="gens2">${gens.map((g) => this.generalHtml(g, own)).join('') || `<div class="dim">武将はいません。守備兵が守ります（Lv${garrisonOf(c, p.id).level}・${garrisonOf(c, p.id).troops}隊）</div>`}</div>
        ${own ? this.reserveHtml(p.id) : ''}${own ? this.buildHtml(p.id) : ''}${own ? this.capitalHtml(p.id) : ''}
        ${!own && reserveOf(c, p.id).length ? `<div class="card status">予備兵 ${reserveOf(c, p.id).length}隊（${reserveOf(c, p.id).map((t) => `<span class="nm">${esc(t.name ?? L(D.byUnit[t.unitId].name))}</span>Lv${t.level}`).join('、')}）<span class="dim small">この領を奪えば手に入ります</span></div>` : ''}
        ${owner ? woundedAt(c, p.id, owner.id).map((g) => `<div class="dim">${esc(g.name.ja)} Lv${g.level}：深手（あと${c.wounded[g.id] - gs.tick}か月は戦えない）</div>`).join('') : ''}
        ${own && me ? awayAt(c, p.id, me.id).map((g) => `<div class="dim">${esc(g.name.ja)}：諸国巡り中（あと${c.away[g.id] - gs.tick}か月）</div>`).join('') : ''}
        `;
    }
    const over = c.over ? `<div class="card status over">${bannerHtml(sceneUrl(c.over === 'win' ? 'victory' : 'defeat', gs.variant))}${c.over === 'win' ? '天下を取りました' : '自分の勢力は滅びました'}</div>` : '';
    this.host.root.querySelector('#panel')!.innerHTML = `
      <div class="turn" style="background:${seasonBand(me ? me.color : null, gs.month)}">${this.date()} <small>${me ? `${esc(me.name.ja)}　兵糧${me.supply}／${supplyCap(me)}（+${me.income}／月）　領${provincesOf(c, me.id).length}` : '観戦'}</small></div>
      <div class="foot">
        <button id="next" class="primary" ${c.over || this.autoOn ? 'disabled' : ''}>月を進める</button>
        ${c.player ? `<button id="autoMonth" class="${this.autoOn ? 'on autoing' : ''}" ${c.over ? 'disabled' : ''} data-tip="押すと、自分の勢力の動きもおまかせにして1か月進めます。2度押すと、ずっとおまかせで進みます（どこかを押すと手動に戻ります）。">${this.autoOn ? 'ずっとオート中…（押すと手動）' : '1か月オート'}</button>` : ''}
        ${c.player ? '' : '<button id="run">12か月進める</button>'}
        <span class="dim">勢力${Object.keys(gs.factions).length}・${c.months}か月・${S.difficulty[c.difficulty].name}</span>
        <button id="saves">セーブ</button>
        <button id="bgmBtn" title="曲の音量（押すたびに切・小・中・大）">曲：${BGM_LEVEL_NAME[bgmLevel()]}</button>
        <button id="exit">やめる</button>
      </div>
      ${me ? `<div class="dim small">特色：${traitsOf(me).map((t) => `${t.name}（${t.text}）`).join('、')}${this.itemsText()}</div>` : ''}
      ${this.offersHtml()}${over}${body}`;
    const root = this.host.root;
    root.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((cb) => {
      cb.onchange = () => { if (cb.checked) this.picked.add(cb.dataset.pick!); else this.picked.delete(cb.dataset.pick!); this.refresh(); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-recruit]').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        const sel = root.querySelector<HTMLSelectElement>(`[data-unit="${b.dataset.recruit}"]`);
        if (sel && recruit(c, b.dataset.recruit!, sel.value)) this.refresh();
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-promo]').forEach((b) => {
      b.onclick = () => { if (promoteGeneral(gs.generals[b.dataset.promo!], b.dataset.to!)) this.refresh(); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => {
      b.onclick = () => { if (upgradeTroop(c, b.dataset.up!, Number(b.dataset.i), b.dataset.to!)) this.refresh(); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-quest]').forEach((b) => {
      b.onclick = async () => {
        const gid = b.dataset.quest!, g = gs.generals[gid];
        if (!g) return;
        const ok = await confirmBox(this.frame(), {
          title: `${esc(g.name.ja)}を諸国巡りに出す`, banner: sceneUrl('travel', gs.variant),
          body: `<p>武将がひとりで諸国をめぐる旅に出ます。<b>${S.quest.months}か月</b>のあいだ戻らず、攻めにも守りにも出られません（率いている兵も、そのあいだ戦いには出ません）。</p>
            <p>旅から戻るとき、次のどれかを得ることがあります。</p>
            <ul class="small"><li>浪人を見つけて連れ帰る（新しい武将が加わる）</li><li>昇進の品を持ち帰る（兵の昇格に使う）</li><li>見聞を広めて経験を得る（レベルが上がる）</li><li>何も得られないこともある</li></ul>`,
          ok: '旅に出す',
        });
        if (ok && startQuest(c, gid)) { this.picked.delete(gid); this.refresh(); }
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-train]').forEach((b) => {
      b.onclick = () => { if (trainOnce(c, b.dataset.train!)) { this.picked.delete(b.dataset.train!); toast('この月は訓練します（月の終わりに経験値が入ります）'); this.refresh(); } };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-train-always]').forEach((b) => {
      b.onclick = () => { const on = toggleTrainAlways(c, b.dataset.trainAlways!); toast(on ? 'ずっと訓練にしました' : 'ずっと訓練をやめました'); this.refresh(); };
    });
    // 将の名前：押すと、能力と列伝の窓
    root.querySelectorAll<HTMLElement>('[data-profile]').forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        const g = gs.generals[el.dataset.profile!];
        if (g) void confirmBox(this.frame(), { title: '能力と列伝', body: profileHtml(c, g, this.figure(g), logLine), ok: '閉じる', single: true });
      };
    });
    root.querySelector<HTMLDetailsElement>('details.bmap')?.addEventListener('toggle', (e) => { this.previewOpen = (e.target as HTMLDetailsElement).open; });
    const mc = root.querySelector<HTMLButtonElement>('#moveCapital');
    if (mc && p && me) mc.onclick = async () => {
      const plan = relocationPlan(c, me.id, p.id);
      const ok = await confirmBox(this.frame(), {
        title: `本拠を${esc(p.name.ja)}へ移す`,
        body: `<p>兵糧を<b>${plan.cost}</b>使い（今${me.supply}）、<b>${plan.months}か月</b>かけて本拠を移します。終わるまでは、今の本拠（${esc(gs.provinces[me.capital].name.ja)}）のままです。</p>
          <ul class="small"><li>終わると、${esc(p.name.ja)}が本拠になり、この領の戦場は城になります</li><li>飛び地は、新しい本拠から数え直します</li><li>途中で${esc(p.name.ja)}を失うと取りやめになり、兵糧は戻りません</li></ul>`,
        ok: '本拠を移す',
      });
      if (!ok) return;
      if (startRelocation(c, me.id, p.id)) { toast(`本拠を${p.name.ja}へ移し始めました（${plan.months}か月）`); this.refresh(); }
      else toast(relocationProblem(c, me.id, p.id) ?? '本拠を移せません');
    };
    const pvFrom = root.querySelector<HTMLSelectElement>('#pvFrom');
    if (pvFrom && p) pvFrom.onchange = () => { this.previewFrom[p.id] = Number(pvFrom.value); this.refresh(); };
    const kindSel = root.querySelector<HTMLSelectElement>('#buildKind');
    if (kindSel) kindSel.onchange = () => { this.buildKind = kindSel.value; this.refresh(); };
    const buildGo = root.querySelector<HTMLButtonElement>('#buildGo');
    if (buildGo && p) buildGo.onclick = async () => {
      const k = this.buildKind, prov = p.id, cost = buildCost(c, prov, k);
      const name = k === 'fort' ? '城を固める' : BM.buildings[k]?.name ?? k;
      const ok = await confirmBox(this.frame(), {
        title: `${esc(p.name.ja)}で普請：${esc(name)}`,
        body: `<p>${esc(k === 'fort' ? `城の強さが ${Math.round(p.fort * 100)}% から ${Math.round(Math.min(BM.build.fortMax, p.fort + BM.build.fortStep) * 100)}% に上がります。` : BM.buildings[k]?.text ?? '')}</p>
          <p>兵糧を<b>${cost}</b>使います（今${me?.supply ?? 0}）。この領の普請は今月これで終わりです。</p>
          <p class="dim small">この領で戦うときの戦場が変わります（領の欄の「戦場」で下見できます）。</p>`,
        ok: '普請する',
      });
      if (!ok) return;
      if (build(c, c.player, prov, k)) { this.previewOpen = true; toast(`${p.name.ja}で${name}の普請が済みました。戦場も変わります`); this.refresh(); }
      else toast(buildProblem(c, c.player, prov, k) ?? '普請できません');
    };
    root.querySelectorAll<HTMLButtonElement>('[data-rename]').forEach((b) => {
      b.onclick = () => { const gid = b.dataset.rename!, g = gs.generals[gid]; if (g) this.askName('武将の名前を変える', g.name.ja, `${S.officer.nameMax}文字まで`, (n) => { renameGeneral(c, gid, n); }); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-lower]').forEach((b) => { b.onclick = () => this.askLower(b.dataset.lower!); });
    root.querySelectorAll<HTMLButtonElement>('[data-tname]').forEach((b) => {
      b.onclick = () => {
        const m = this.troopMenu, t = m ? holderOf(c, m.gid)?.troops[m.i] : null;
        if (!m || !t) return;
        this.askName('兵の名前を変える', t.name ?? L(D.byUnit[t.unitId].name), `${S.officer.nameMax}文字まで。空にすると、兵種の名前（${L(D.byUnit[t.unitId].name)}）に戻ります`, (n) => { renameTroop(c, m.gid, m.i, n === L(D.byUnit[t.unitId].name) ? '' : n); this.troopMenu = null; });
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-raise]').forEach((b) => {
      b.onclick = () => {
        const m = this.troopMenu, t = m ? holderOf(c, m.gid)?.troops[m.i] : null;
        if (!m || !t) return;
        this.askName('兵を武将にする', t.name ?? '', `新しい武将の名前を決めてください。兵糧を${raiseCost(t.level)}使います。この隊は無くなり、同じ領にLv${t.level}の武将が加わります（兵は連れていません）。兵のときの特技と軍略はそのまま使え、将としての特性を1つ得ます。`, (n) => {
          const made = raiseToGeneral(c, m.gid, m.i, n);
          if (!made) { toast(n.trim() ? raiseProblem(c, m.gid, m.i) ?? '武将にできません' : '名前を入れてください'); return; }
          this.troopMenu = null;
          toast(`${made.name.ja}が武将になりました（特性：${made.traits.map((x) => TRAIT_NAME[x] ?? x).join('・')}）`);
        }, sceneUrl('promote', gs.variant));
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-troop]').forEach((b) => {
      // 指で触ったときは、離した時点で欄を開いている（attachTroopDrag）。そのあとに届く「押した」は二重になるので捨てる
      b.onclick = () => { if (!this.justDragged && performance.now() - this.tappedAt > 600) this.toggleTroopMenu(b.dataset.troop!, Number(b.dataset.i)); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-give]').forEach((b) => {
      b.onclick = () => { const m = this.troopMenu; if (m && transferTroop(c, m.gid, m.i, b.dataset.give!)) { this.troopMenu = null; this.refresh(); } };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-dismiss]').forEach((b) => {
      b.onclick = () => { const m = this.troopMenu; if (m) { this.troopMenu = null; this.askDismiss(m.gid, m.i); } };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-tclose]').forEach((b) => { b.onclick = () => { this.troopMenu = null; this.refresh(); }; });
    root.querySelectorAll<HTMLButtonElement>('[data-offer]').forEach((b) => {
      b.onclick = async () => {
        const from = Number(b.dataset.offer), o = c.offers.find((x) => x.from === from), f = gs.factions[from];
        if (!o || !f) return;
        const KIND = { truce: '停戦', alliance: '同盟', vassal: '従属' } as const;
        const what = o.kind === 'alliance' ? '同盟を結ぶと、互いに攻め合えなくなり、相手が攻められたときに加勢を頼まれることがあります。' : o.kind === 'truce' ? `停戦すると、${o.months ? `${o.months}か月` : 'しばらく'}のあいだ互いに攻め合えなくなります。` : '従属を受けると、相手はこちらの下につき、攻め合えなくなります。';
        const ok = await confirmBox(this.frame(), {
          title: `${esc(f.name.ja)}からの${KIND[o.kind]}の申し込みを${b.dataset.yes ? '受ける' : '断る'}`, banner: sceneUrl('envoy', gs.variant),
          body: `<p>${what}</p><p class="dim small">${b.dataset.yes ? '受けると、すぐに結ばれます。' : '断ると、相手の心証が少し下がります。'}</p>`,
          ok: b.dataset.yes ? '受ける' : '断る',
        });
        if (!ok) return;
        if (b.dataset.yes) acceptOffer(c, from); else declineOffer(c, from);
        this.refresh();
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-hchoice]').forEach((b) => {
      b.onclick = async () => {
        const ch = (c.history.choices ?? []).find((x) => x.id === b.dataset.hchoice);
        if (!ch) return;
        const yes = !!b.dataset.yes;
        const ok = await confirmBox(this.frame(), {
          title: `史実の出来事を${yes ? '受ける' : '断る'}`, banner: sceneUrl('envoy', gs.variant),
          body: `<p>${esc(ch.text)}</p><p>${esc(choiceLine(c, ch))}</p><p class="dim small">${esc(choiceOutcome(c, ch, yes))}</p>`,
          ok: yes ? '受ける' : '断る',
        });
        if (!ok) return;
        chooseHistory(c, ch.id, yes);
        this.refresh();
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-call]').forEach((b) => {
      b.onclick = () => { if (callToArms(c, Number(b.dataset.call), Number(b.dataset.enemy))) this.refresh(); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-dip]').forEach((b) => {
      b.onclick = async () => {
        const to = Number(b.dataset.to), a = c.player, kind = b.dataset.dip!, f = gs.factions[to];
        const TEXT: Record<string, [string, string, boolean]> = {
          war: ['戦を仕掛ける', '宣戦すると、この勢力と戦になります。互いに領を攻め合えるようになり、相手の味方も敵に回ることがあります。停戦するまで続きます。', true],
          ally: ['同盟を申し込む', '受けてもらえるかは、相手の心証と力の差しだいです。結べば互いに攻め合えなくなり、加勢を頼み合えます。', false],
          break: ['同盟を破る', '同盟を破ると、この勢力との約束はなくなります。ほかの勢力からの心証も下がります。', true],
          truce: ['停戦を申し込む', '受けてもらえるかは、戦の形勢と相手の心証しだいです。結べばしばらく互いに攻め合えなくなります。', false],
        };
        const tx = TEXT[kind];
        if (!f || !tx) return;
        if (!(await confirmBox(this.frame(), { title: `${esc(f.name.ja)}に${tx[0]}`, body: `<p>${tx[1]}</p>`, ok: tx[0], danger: tx[2], banner: sceneUrl('envoy', gs.variant) }))) return;
        const ok = b.dataset.dip === 'war' ? declareWar(c, a, to) : b.dataset.dip === 'ally' ? proposeAlliance(c, a, to)
          : b.dataset.dip === 'break' ? breakAlliance(c, a, to) : proposeTruce(c, a, to);
        if (ok) this.refresh();
      };
    });
    const on = (id: string, fn: () => void) => { const b = root.querySelector<HTMLButtonElement>(id); if (b) b.onclick = fn; };
    // まとめて選ぶ：今月まだ動いていない武将だけが対象。並びはレベルの高い順（generalsAt の順）
    const movable = (): GGeneral[] => this.mine().filter((g) => !c.moved.has(g.id));
    on('#selAll', () => { this.picked = new Set(movable().map((g) => g.id)); this.refresh(); });
    on('#selTop', () => { this.picked = new Set(movable().slice(0, MAX_GENERALS).map((g) => g.id)); this.refresh(); });
    on('#selNone', () => { this.picked.clear(); this.order = 'none'; this.refresh(); });
    on('#move', () => { this.order = this.order === 'move' ? 'none' : 'move'; this.refresh(); });
    on('#attack', () => { this.order = this.order === 'attack' ? 'none' : 'attack'; this.refresh(); });
    on('#next', () => busy('月を進めています…', () => this.advance()));
    on('#run', () => {
      // 1か月ごとに表示を書き換えながら進める（進み具合が見える）
      this.running = true;
      const token = ++this.runToken;
      void (async () => {
        for (let k = 1; k <= 12 && !this.c.over && token === this.runToken; k++) await busy(`月を進めています…（${k}／12）`, () => this.advance());
        this.running = false;
        if (token === this.runToken) this.autosave();
      })();
    });
    on('#bgmBtn', () => { setBgmLevel((bgmLevel() + 1) % BGM_LEVEL_NAME.length); this.refresh(); });
    on('#saves', () => { void openSaveMenu(root.querySelector<HTMLElement>('.battle')!, { current: () => snapshot(this.c), onLoad: (s) => { clearTimeout(this.watchTimer); this.runToken++; void busy('読み込んでいます…', () => this.host.loadHexSave(s)); } }); });
    on('#exit', async () => {
      const ok = await confirmBox(this.frame(), { title: '戦略をやめる', body: '<p>題の画面に戻ります。</p><p class="dim small">月が変わるたびに自動の枠へ保存しているので、「つづきから」で今月の初めから続けられます。今月に動かした分は残りません。残したいときは、先に「セーブ」で保存してください。</p>', ok: 'やめる', cancel: '続ける', danger: true });
      if (!ok) return;
      this.stopAuto(); clearTimeout(this.watchTimer); this.runToken++; void busy('戻っています…', () => this.exit());
    });
    const autoBtn = root.querySelector<HTMLButtonElement>('#autoMonth');
    if (autoBtn) autoBtn.onclick = () => {
      if (this.autoOn) { this.stopAuto(); return; }
      // 2度押し（0.3秒以内）なら、ずっとオート
      if (this.autoClick) { clearTimeout(this.autoClick); this.autoClick = 0; this.startAuto(); return; }
      autoBtn.classList.add('on');
      this.autoClick = window.setTimeout(() => { this.autoClick = 0; void busy('おまかせで1か月進めています…', () => this.autoOne(true)); }, 300);
    };
    const logEl = root.querySelector<HTMLElement>('#log')!;
    logEl.innerHTML = c.log.slice(-80).map((e) => `<div class="${e.key === 'month' ? 'sep' : ''}">${esc(logLine(e))}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}
