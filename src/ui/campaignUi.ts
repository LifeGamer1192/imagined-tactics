// 戦略パートの画面：戦略マップ、領と武将の情報、移動・徴兵・侵攻、月送り。

import type { BattleState, Side } from '../battle/types';
import type { BattleSummary } from '../battle/result';
import type { GGeneral, GTroop } from '../convert/model';
import { D, L } from '../data/db';
import { StrategyView } from '../render/strategyView';
import {
  autoMonth, autoPlayMonth, battleFor, canAttack, endMonth, finishMonth, generalsAt, moveGeneral, moveTargets, neighborsOf, planAttack, provincesOf,
  declareWar, dismissTroop, garrisonOf, recruit, recruitCost, recruitCostFor, recruitTraitMult, holderOf, moveTroopProblem, reserveKey, reserveOf, transferTroop, recruitProblem, relation, resolveBattle, siegeResist, strengthOf, traitsOf, troopLoad,
  S, supplyCap, provinceRecruit, isNativeUnit, isResting, historicBattle, endHistoricBattle, skipHistoricBattle, type Campaign, type CampaignLog, type PendingBattle, type ReelBattle, BUILD_KINDS, build, buildCost, buildProblem, provinceLook, provinceMap, isExclave, exclaveLink, relocationPlan, relocationProblem, startRelocation,
} from '../strategy/campaign';
import { CAUSE_NAME, chooseHistory, chooseOmen, choiceLine, choiceOutcome, histBattleSetup } from '../strategy/history';
/** 兆しの文（P74） */
const OMEN_SIGN: Record<string, string> = { assassination: '刺客の噂がある', battle_wound: '戦場で討たれる兆しがある', suicide: '追い詰められて自ら命を絶つ兆しがある', executed: '捕らえられて処刑される兆しがある' };
import { profileHtml } from './profile';
import { toggleTrainAlways, trainMult, trainOnce, trainProblem } from '../strategy/training';
import { envoyBonus, envoyPlan, envoyProblem, giftBonus, sendEnvoy, type DipKind } from '../strategy/envoy';
import { abdicate, abdicateLoyaltyLoss, abdicateProblem, factionStrength } from '../strategy/events';
import { chancellorOf, nearChancellor, officeBlocks, officeFx, officeLines } from '../strategy/office';
import { appointChancellor, approx, missionGain, officeGain, roughCount, scoutOf, scoutProblem, scoutTier, sendScout, type ScoutTier } from '../strategy/scouting';
import { BM } from '../battle/map';
import { mapPreviewUrl } from '../render/mapPreview';
import {
  acceptOffer, allianceProblem, awayAt, breakAlliance, callProblem, callToArms, declineOffer, playerEnemies, proposeAlliance, proposeTruce, lowerProblem, lowerRefund, lowerToTroop, questProblem, raiseCost, raiseProblem, raiseToGeneral, renameGeneral, renameTroop, startQuest, troopUpgrades, truceProblem, upgradeTroop, woundedAt,
} from '../strategy/events';
import { generalPromotions, promoteGeneral } from '../rules/growth';
import { changeTable, changeText, generalArtsHtml, generalChange, troopArtsHtml, troopChange, type ChangeRow } from './classChange';
import { MAX_GENERALS } from '../battle/setup';
import { snapshot, type HexSave } from '../persist/save';
import { openSaveMenu, writeSlot } from './saveMenu';
import { TRAIT_NAME } from './text';
import { TIE_NAME } from '../strategy/biography';
import { busy, toast } from './busy';
import { autoRecruit, ROLE_NAME, unitRole } from '../strategy/autoplay';
import { bannerHtml, sceneUrl, seasonBand, seasonUrl, setScene } from './scene';
import { BGM_LEVEL_NAME, bgm, bgmLevel, jingle, setBgmLevel } from './bgm';
import { play } from './sound';
import { confirmBox } from './confirm';
import { captiveOf, executeCaptive, myCaptives, myCaptured, ransomCaptive, ransomCost, recruitCaptive, recruitChance, releaseCaptive } from '../strategy/captive';
import { artMp, artName, forgetArt, learnerName, learnersOf, lessonLearner, lessonMonths, maxMpOf, slotsLeft, slotsOfLearner, startLesson, teachableArts, teacherProblem, teachProblem } from '../strategy/teach';
import { classTip, commandTip, personalityTip, strengthRank, strengthTip, traitTip, unitTip } from './describe';
import { initTips } from './tip';
import { personalityLabel, personalityOf, planLabel, PLAN_LABEL, PLAN_TIP } from '../ai/personality';
import { bindPlan, getPlan, planPickerHtml, wirePlanPicker } from './autoPlan';
import { spanText, startChronicle } from '../strategy/chronicle';
import { artUrl } from '../art/art';
import { faceFor } from '../art/faces';

/** 画面の土台（App）に求めるもの */
export interface Host {
  readonly root: HTMLElement;
  openBattle(st: BattleState, human: Set<Side>, done: (st: BattleState) => BattleSummary | null, back: { label: string; fn: () => void }, allowQuit: boolean, manualSide?: Side): void;
  /** hex-sim のセーブを読み込んで、その状態から続ける */
  loadHexSave(s: HexSave): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * 月送りの演出（他国の戦い）を見せるか。足もとのボタンで切り替え、ブラウザに覚える。
 * 自動で操作されているブラウザ（確認の道具）では、はじめは見せない（道具が演出で止まらないように。visual-check は 'on' にして確かめる）
 */
const REEL_KEY = 'hexsim.reel';
function reelOn(): boolean {
  let v: string | null = null;
  try { v = localStorage.getItem(REEL_KEY); } catch { /* 覚えられないときは既定 */ }
  return v ? v === 'on' : !navigator.webdriver;
}
function setReel(on: boolean): void { try { localStorage.setItem(REEL_KEY, on ? 'on' : 'off'); } catch { /* 覚えられなくても続ける */ } }

/** 海路の攻めか（陸で隣り合っていない、海の向こうの領から） */
const bySea = (gs: Campaign['gs'], from: number, to: number): boolean => !!gs.provinces[from] && !gs.provinces[from].nb.includes(to) && gs.provinces[from].sea.includes(to);

/** 国名の札：地図と同じ国の色を地にする（字は地の明るさで白か黒） */
const factionBadge = (name: string, [r, g, b]: [number, number, number]): string =>
  `<span class="fac" style="background:rgb(${r},${g},${b});color:${0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1612' : '#fff'}">${esc(name)}</span>`;
const REL_NAME = { self: '自分', ally: '味方', truce: '停戦中', war: '交戦中', neutral: '中立' } as const;
const LOG_TEXT: Record<string, string> = {
  capture: '{faction}が{prov}を取った',
  imaArrive: '【ima-rpg から】{text}',
  chainCapture: '{faction}は、勢いに乗って{from}の{provs}（守る武将のいない領）も一気に取った',
  fall: '{faction}が滅んだ{why}',
  battle: '{prov}の戦い：{attacker} 対 {defender} → {winner}の勝ち',
  month: '── {date} ──',
  siege: '{faction}が{prov}を囲んでいる（{pct}%）',
  wounded: '{names}が深手を負った（{months}か月は戦えない{by}）',
  raised: '{by}の{unit}から、{name}が武将に取り立てられた',
  reserveTaken: '{faction}は、{prov}の予備兵{n}隊を手に入れた',
  lowered: '{name}は武将をやめ、予備兵の{unit}になった（兵糧{refund}が戻った）',
  war: '{a}が{b}に戦を仕掛けた',
  alliance: '{a}と{b}が同盟を結んだ',
  breakAlliance: '{a}が{b}との同盟を破った',
  truce: '{a}と{b}が停戦した（{months}か月）',
  train: '{name}が訓練した（経験値{exp}・×{mult}{lv}{troops}）',
  trainEvent: '【訓練】{name}：{text}',
  scouted: '{name}が{prov}を偵察した（偵察度{v}）',
  envoy: '{name}を使者として{faction}へ送った（土産：兵糧{gift}。心証{from}→{to}）',
  envoyRefused: '{faction}に断られた（{why}）',
  resting: '{name}は戦場から退却し、翌月まで休養する（守りの出陣だけできる）',
  caught: '【捕獲】{from}の{unit}を捕まえ、{to}に加えた（Lv{lv}）',
  tieJoin: '{name}は、戦場で出会った{friend}との縁で{faction}に仕えた',
  surrender: '{name}が{faction}に降った',
  defect: '{name}が{from}を見限り、{to}へ寝返った',
  roninJoin: '浪人の{name}が{faction}に仕えた',
  death: '{faction}の{name}が世を去った（{age}歳）',
  succeed: '{faction}：{late}の跡を{name}が継いだ',
  newLord: '{faction}：{name}が当主になった',
  abdicate: '{faction}：{late}が隠居し、{name}に当主を譲った',
  teachStart: '直伝：{teacher}が{learner}に「{art}」を教え始めた（{months}か月）',
  teachDone: '直伝：{learner}が{teacher}から「{art}」を教わった（借り物。戦いで使うと身につく）',
  teachCancel: '直伝：{teacher}から{learner}への「{art}」は取りやめになった',
  teachReset: '直伝：療養のため、{teacher}から{learner}への「{art}」はやり直しになった',
  histGoal: '史実の目標：史実では、この頃{name}（{target}へ攻め込む）。{months}か月のうちに{target}の領を1つ取れば、ほうび',
  histGoalDone: '史実の目標を果たした：{name}（名声+{prestige}・兵糧+{supply}）',
  histGoalMissed: '史実の目標「{name}」は期限が過ぎた',
  histBattle: '史実の合戦：{name}（{foe}・{prov}）。戦うか見送るかを選べる',
  histBattleResult: '{name}：{foe}に{result}',
  histBattleDiverged: '{name}は史実と逆の結果になった（{result}）。史実と違う道',
  omen: '兆し：{name}に{sign}（あと{months}か月ほど）',
  omenAverted: '{name}は{cause}の難を逃れた（史実と違う道）',
  omenFell: '{name}は史実どおり{cause}により世を去った',
  captured: '{by}が、{from}の{name}{lord}を{prov}で捕らえた',
  captiveRefuse: '{name}は{by}に仕えることを断った（捕虜のまま）',
  captiveRecruit: '{name}（もと{from}）が{by}に仕えることになった',
  captiveRelease: '{by}は捕虜の{name}を解き放った（{to}へ）',
  captiveExecute: '{by}は捕虜の{name}{lord}を処断した',
  captiveRansom: '身代金{cost}で、{by}に捕まっていた{name}を取り戻した',
  captiveFreed: '{by}に捕まっていた{name}は、領が取り返されて{to}へ戻った',
  captiveEscape: '{by}に捕まっていた{name}は、隙を見て逃げ出し{to}へ戻った',
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
  recovered: '{name}が深手から回復し、また戦えるようになった',
  canPromote: '{name}が{to}に昇進できる（役職名の隣の▲から）',
  canUpgrade: '{name}の{unit}が{to}に進める（兵の札の隣の▲から）',
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
  /** オート（P81）：進める長さ（1〜3か月、0 はずっと）、オート中か、残りの月数、始めたときの記録の位置（終わってから知らせを出す） */
  private autoLen = 1;
  /** 徴兵の選択を覚えておく（武将ごと・最後に選んだもの。P81） */
  private lastUnit: Record<string, string> = {};
  private lastUnitAny = '';
  private autoOn = false;
  private autoLeft = 0;
  private autoMark = 0;
  /** 今月の知らせを拾う、月の初めの記録の位置 */
  private logMark = 0;
  /** 攻め込む・攻められる窓を出している間、地図で目立たせる二つの領 */
  private alarm: { from: number; to: number } | null = null;
  /** 月送りの演出で、持ち主が変わったのを見せている領 */
  private flash: number | null = null;
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
    // 味方のおまかせの方針（P50）：セーブにあればそれ、無ければ前の設定。切り替えたらセーブにも残す
    if (c.player) bindPlan(c.autoPlan, (p) => { c.autoPlan = p; });
    // 年表（P57）：家が起った日を書き留める（古いセーブは、読み込んだ日から）
    if (c.player) startChronicle(c);
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
    // 月を進めても、戦いから戻っても、地図の拡大と位置はそのまま（中身は最新に描き直す。P53）
    const prev = this.view?.cam;
    const keep = prev ? { x: prev.x, y: prev.y, zoom: prev.zoom } : null;
    this.view = new StrategyView(canvas);
    this.view.setState(gs, this.c.world);
    if (keep) {
      const cam = this.view.cam;
      cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, keep.zoom));
      cam.x = keep.x; cam.y = keep.y;
      cam.clamp(); cam.onChange();
    }
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
        // 端で押さえ続けるほど速く送る（武将の多い領でも、すぐ下の予備兵の欄まで届くように）
        const panel = frame.querySelector<HTMLElement>('#panel');
        let held = 0;
        scrollTimer = window.setInterval(() => {
          if (!panel) return;
          const r = panel.getBoundingClientRect();
          const edge = py < r.top + 36 ? -1 : py > r.bottom - 36 ? 1 : 0;
          held = edge ? held + 1 : 0;
          if (edge) panel.scrollTop += edge * Math.min(70, 14 + held * 2);
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

  /** 武将の絵。史実の人物で顔絵があればその顔（hist-sim と共有）、なければ後ろ姿（顔は描かない）を役割と性別で選ぶ */
  private figure(g: GGeneral): string {
    const face = this.c.gs.scenario ? faceFor(this.c.gs.scenario, g.recordName ?? g.name.ja) : null;
    if (face) return `<img class="fig face" src="${import.meta.env.BASE_URL ?? './'}${face}" alt="" draggable="false">`;
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
    autoPlayMonth(c);
    c.reel = [];
    c.log.push({ key: 'month', vars: { date: this.date() } });
    this.autosave();
    this.mount();
    if (news) this.showNews(mark);
  }

  /** オート：months か月（0 はずっと）、どこかを押すまで、1か月ずつおまかせで進める。終わったら、その間の知らせをまとめて出す */
  private startAuto(months = 0): void {
    this.autoOn = true;
    this.autoLeft = months;
    this.autoMark = this.c.log.length;
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
      if (this.autoLeft > 0 && --this.autoLeft === 0) { this.stopAuto('オートで進め終えました'); return; }
      if (this.autoLeft > 0) this.refresh();
      this.watchTimer = window.setTimeout(step, 450);
    };
    this.watchTimer = window.setTimeout(step, 60);
  }

  private stopListener: ((e: Event) => void) | null = null;

  private stopAuto(msg = '手動に戻しました'): void {
    if (!this.autoOn) return;
    this.autoOn = false;
    this.autoLeft = 0;
    clearTimeout(this.watchTimer);
    if (this.stopListener) window.removeEventListener('pointerdown', this.stopListener, { capture: true });
    this.stopListener = null;
    toast(msg);
    this.refresh();
    // オートの間の大きな出来事を、まとめて知らせる
    this.showNews(this.autoMark);
  }

  /** 今月の、自分の勢力にかかわる大きな出来事を、絵を添えた窓で知らせる（亡くなった・代替わり・寝返り・外交・諸国巡り・仕官） */
  private showNews(from: number): void {
    const c = this.c, me = c.player ? c.gs.factions[c.player] : null;
    if (!me || c.over) return;
    const KIND: Record<string, string> = {
      death: 'death', succeed: 'succession', newLord: 'succession', abdicate: 'succession', defect: 'defect', alliance: 'envoy', truce: 'envoy', vassal: 'envoy', breakAlliance: 'envoy', joinWar: 'envoy',
      histGoal: 'hgoal', histGoalDone: 'hgoal', histGoalMissed: 'hgoal', histBattle: 'hbattle', histBattleResult: 'hbattle', histBattleDiverged: 'hbattle', omen: 'omen', omenAverted: 'omen', omenFell: 'death', captured: 'captive', captiveRecruit: 'captive', captiveRelease: 'captive', captiveExecute: 'captive', captiveFreed: 'captive', captiveEscape: 'captive', captiveRefuse: 'captive',
      questItem: 'travel', questRonin: 'travel', questExp: 'travel', questNothing: 'travel', roninJoin: 'promote', tieJoin: 'promote', comeOfAge: 'promote', history: 'history',
      recovered: 'recover', teachDone: 'teach', teachCancel: 'teach', teachReset: 'teach', capitalMoved: 'capital', capitalMoveFailed: 'capital', canPromote: 'classup', canUpgrade: 'classup',
    };
    const ORDER = ['hbattle', 'omen', 'hgoal', 'death', 'defect', 'captive', 'succession', 'capital', 'recover', 'teach', 'classup', 'history', 'envoy', 'travel', 'promote'];
    // 自分の家のことだけ書き留める出来事（療養明け・直伝・昇進できる）は、そのまま知らせる
    const MINE = new Set(['recovered', 'teachDone', 'teachCancel', 'teachReset', 'canPromote', 'canUpgrade']);
    // 史実の出来事は、大きなもの（imp 2 以上）か、自分の勢力の名前が出るものを知らせる
    const items = c.log.slice(from).filter((e) => KIND[e.key] && (MINE.has(e.key) || e.key.startsWith('quest') || e.key.startsWith('omen') || e.key.startsWith('histBattle') || e.key.startsWith('histGoal') || Object.values(e.vars).some((v) => v === me.name.ja)
      || (e.key === 'history' && (Number(e.vars.imp) >= 2 || String(e.vars.text).includes(me.name.ja)))));
    if (!items.length) return;
    const kinds = ORDER.filter((k) => items.some((e) => KIND[e.key] === k));
    const TITLE: Record<string, string> = { hgoal: '史実の目標', hbattle: '史実の合戦', omen: '兆し', death: '訃報', defect: '寝返り', captive: '捕虜', succession: '代替わり', history: '史実の出来事', envoy: '外交の知らせ', travel: '諸国巡りから', promote: '新たな顔ぶれ', capital: '遷都', recover: '療養明け', teach: '直伝', classup: '昇進できる' };
    const SCENE: Record<string, string> = { hbattle: 'setup', hgoal: 'setup', history: 'envoy', omen: 'envoy', captive: 'defect', death: 'death', defect: 'defect', succession: 'succession', envoy: 'envoy', travel: 'travel', promote: 'promote' };
    // 出来事の種類ごとに見出しを付けて並べる（種類が1つなら見出しは窓の題に）
    const list = (k: string): string => {
      const es = items.filter((e) => KIND[e.key] === k), more = es.length - 8;
      return `<ul class="news">${es.slice(0, 8).map((e) => `<li>${esc(logLine(e))}</li>`).join('')}${more > 0 ? `<li class="dim">ほか${more}件（記録に残っています）</li>` : ''}</ul>`;
    };
    const one = kinds.length === 1, top = kinds[0];
    void confirmBox(this.frame(), {
      title: one ? `今月の知らせ：${TITLE[top]}` : '今月の知らせ',
      // 絵はいちばん大きな知らせに合わせる（合う絵が無い知らせだけなら、季節の絵）
      banner: SCENE[top] ? sceneUrl(SCENE[top], c.gs.variant) : seasonUrl(c.gs.month),
      body: one ? list(top) : kinds.map((k) => `<h4 class="newshead">${TITLE[k]}</h4>${list(k)}`).join(''),
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

  /** 役職・兵種を進めたときの祝いの窓（P52）：紙吹雪、大きな「昇格！」、前と後の能力の比べ表 */
  private celebrateChange(title: string, sub: string, rows: ChangeRow[], img: string | null, arts = ''): void {
    const leaf = Array.from({ length: 34 }, (_v, i) => `<span class="leaf" style="left:${(i * 29) % 100}%;animation-delay:${((i * 0.19) % 2.2).toFixed(2)}s;animation-duration:${(2.4 + (i % 5) * 0.35).toFixed(1)}s"></span>`).join('');
    const box = document.createElement('div');
    box.className = 'result victory-box cc-box';
    box.innerHTML = `<div class="leaves">${leaf}</div>${bannerHtml(sceneUrl('victory', this.c.gs.variant))}
      <div class="kachidoki">昇格！</div>
      ${img ? `<div class="cc-fig"><img src="${img}" alt=""></div>` : ''}
      <h2 class="wrap">${esc(title)}</h2>
      <p class="vsub">${esc(sub)}</p>
      <p class="cbtns"><button class="primary" data-a="ok">見事！</button></p>
      ${changeTable(rows)}${arts}`;
    this.frame().appendChild(box);
    play('win');
    box.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => { box.remove(); this.refresh(); };
  }

  /**
   * 天下統一の窓（P57）：大きな「天下統一」、統一までの年月と数、功臣、年表（年ごとに、ひとつずつ浮かび上がる）。
   * 偉業を成し遂げた感じを出す。あとからは、天下を取った欄の「年表を見る」で開ける
   */
  private unifyWindow(): void {
    const c = this.c, gs = c.gs, me = gs.factions[c.player];
    if (!me) return;
    this.frame().querySelector('.unify')?.remove();
    const chron = c.chronicle ?? [];
    if (!chron.some((e) => e.kind === 'unify')) chron.push({ year: gs.year, month: gs.month, kind: 'unify', text: `${me.name.ja}、天下を統一する`, provs: provincesOf(c, me.id).length });
    c.chronicle = chron;
    const yr = (y: number): string => (y < 0 ? `前${-y + 1}年` : `${y}年`);
    const start = chron[0];
    const count = (k: string): number => chron.filter((e) => e.kind === k).length;
    const gens = Object.values(gs.generals).filter((g) => g.faction === me.id);
    const lord = gs.generals[me.lordId];
    // 功臣：勝った戦の多い順（倒した敵将、戦の数で並べ替え）
    const feats = Object.entries(c.feats ?? {}).map(([id, f]) => ({ g: gs.generals[id], f })).filter((x) => x.g && x.g.faction === me.id)
      .sort((a, b) => b.f.wins - a.f.wins || b.f.foes - a.f.foes || b.f.battles - a.f.battles).slice(0, 5);
    const totalBattles = Object.values(c.feats ?? {}).reduce((s, f) => Math.max(s, f.battles), 0);
    const TAG: Record<string, string> = { start: '起', capture: '取', lost: '失', fall: '滅', war: '戦', ally: '盟', truce: '和', capital: '移', lord: '主', history: '史', unify: '統', captive: '虜', diverge: '異' };
    // 年ごとにまとめる（長い年表は、大事な出来事を残して詰める）
    const keep = chron.length > 80 ? chron.filter((e, i) => i === 0 || e.kind !== 'capture' || i % 2 === 0) : chron;
    const years = new Map<number, typeof chron>();
    for (const e of keep) years.set(e.year, [...(years.get(e.year) ?? []), e]);
    let delay = 0;
    const timeline = [...years].map(([y, es]) => `<div class="uy"><div class="uyear">${yr(y)}</div><ul>${es.map((e) => {
      delay += 0.12;
      return `<li class="k-${e.kind}" style="animation-delay:${Math.min(delay, 9).toFixed(2)}s"><span class="ut">${TAG[e.kind] ?? '・'}</span><span class="um">${e.month}月</span>${esc(e.text)}${e.provs !== undefined && (e.kind === 'capture' || e.kind === 'lost' || e.kind === 'start') ? `<span class="dim small">（領${e.provs}）</span>` : ''}</li>`;
    }).join('')}</ul></div>`).join('');
    const leaf = Array.from({ length: 48 }, (_v, i) => `<span class="leaf" style="left:${(i * 23) % 100}%;animation-delay:${((i * 0.17) % 3).toFixed(2)}s;animation-duration:${(2.8 + (i % 6) * 0.4).toFixed(1)}s"></span>`).join('');
    const box = document.createElement('div');
    box.className = 'result victory-box unify';
    box.innerHTML = `<div class="leaves">${leaf}</div>${bannerHtml(sceneUrl('victory', gs.variant))}
      <div class="u-title">天下統一</div>
      <p class="u-lead">${factionBadge(me.name.ja, me.color)}　${yr(gs.year)}${gs.month}月、ついに天下をひとつにまとめる</p>
      <p class="u-sub">${start ? `${yr(start.year)}${start.month}月に起ってから、${esc(spanText(c))}。` : ''}${lord ? `当主 <b>${esc(lord.name.ja)}</b> のもと、` : ''}乱世はここに終わりを告げた。</p>
      <p class="u-sub small">難しさ：<b class="${c.difficulty === 'oni' ? 'oni' : ''}">${esc(S.difficulty[c.difficulty].name)}</b>${c.difficulty === 'oni' ? '　——鬼の難しさで天下を取った者は、古今にほとんどいない。まさに「鬼神」の業である。' : c.difficulty === 'veryHard' ? '　——並の将では成し得ぬ、非常の偉業である。' : ''}</p>
      <div class="u-stats">
        <div><b>${provincesOf(c, me.id).length}</b><span>領</span></div>
        <div><b>${gens.length}</b><span>武将</span></div>
        <div><b>${count('capture')}</b><span>攻め取った</span></div>
        <div><b>${count('fall')}</b><span>滅ぼした家</span></div>
        ${(c.history.diverged ?? []).length ? `<div><b>${(c.history.diverged ?? []).length}</b><span>史実と違う道</span></div>` : ''}
        <div><b>${esc(spanText(c))}</b><span>統一まで</span></div>
      </div>
      ${feats.length ? `<h4>功臣</h4><ol class="u-feats">${feats.map((x, i) => `<li>${i === 0 ? '<span class="u-first">筆頭</span>' : ''}<b>${esc(x.g.name.ja)}</b> <span class="dim">Lv${x.g.level}</span>　戦${x.f.battles}・勝${x.f.wins}${x.f.foes ? `・討った敵将${x.f.foes}` : ''}</li>`).join('')}</ol>` : totalBattles ? '' : ''}
      <h4>年表</h4>
      <div class="u-timeline">${timeline}</div>
      <p class="u-end">この偉業は、後の世まで長く語り継がれるであろう。</p>
      <p class="cbtns"><button class="primary" data-a="ok">天下統一を祝う</button></p>`;
    this.frame().appendChild(box);
    if (!jingle(`win_${gs.variant}`)) play('win');
    box.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => { box.remove(); this.refresh(); };
  }

  /**
   * 滅亡の窓（P60）：滅んだ家の歴史と経緯。起った（書き留め始めた）ときと滅んだときのようす、領・武将・兵の移り変わり（図）、
   * いちばん栄えたとき、出来事の年表、最後の当主と、滅ぼした家、浪人になった武将の数
   */
  private fallWindow(fid: number): void {
    const c = this.c, gs = c.gs, r = c.realms?.[fid];
    if (!r?.fell) { this.refresh(); return; }
    const yr = (y: number): string => (y < 0 ? `前${-y + 1}年` : `${y}年`);
    const mine = fid === c.player;
    const s = r.samples.length ? r.samples : [r.start];
    const peak = s.reduce((a, b) => (b.provs > a.provs ? b : a), s[0]);
    const peakGens = s.reduce((a, b) => (b.gens > a.gens ? b : a), s[0]);
    const months = (r.fell.year - r.start.year) * 12 + (r.fell.month - r.start.month);
    const span = months >= 12 ? `${Math.floor(months / 12)}年${months % 12 ? `${months % 12}か月` : ''}` : `${months}か月`;
    // 領と武将の移り変わりの図（折れ線）
    const W = 300, H = 70, maxP = Math.max(1, ...s.map((x) => x.provs)), maxG = Math.max(1, ...s.map((x) => x.gens));
    const pts = (k: 'provs' | 'gens', mx: number): string => s.map((x, i) => `${(s.length > 1 ? (i / (s.length - 1)) * W : W / 2).toFixed(1)},${(H - (x[k] / mx) * (H - 6) - 3).toFixed(1)}`).join(' ');
    const [cr, cg, cb] = r.color;
    const chart = `<svg class="fall-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts('gens', maxG)}" fill="none" stroke="rgba(200,190,170,0.8)" stroke-width="1.5" stroke-dasharray="4 3"/><polyline points="${pts('provs', maxP)}" fill="none" stroke="rgb(${cr},${cg},${cb})" stroke-width="2.5"/></svg>
      <div class="dim small">実線：領（最大${maxP}）　点線：武将（最大${maxG}）　${yr(s[0].year)}${s[0].month}月 → ${yr(r.fell.year)}${r.fell.month}月</div>`;
    const ev = r.events.slice(-24).map((e) => `<li><span class="um">${yr(e.year)}${e.month}月</span>${esc(e.text)}</li>`).join('');
    const left = (c.fallen ?? []).length;
    const box = document.createElement('div');
    box.className = 'result fall';
    box.innerHTML = `${bannerHtml(sceneUrl('defeat', gs.variant))}
      <div class="fall-title">${esc(r.name)}、滅亡</div>
      <p class="vsub">${esc(yr(r.fell.year))}${r.fell.month}月　${r.fell.why ? esc(r.fell.why) : r.fell.by ? `${esc(r.fell.by)}に滅ぼされる` : '領をすべて失う'}${mine ? '　<b>あなたの家</b>' : ''}</p>
      <div class="u-stats">
        <div><b>${esc(span)}</b><span>見届けた年月</span></div>
        <div><b>${r.start.provs} → 0</b><span>領</span></div>
        <div><b>${peak.provs}</b><span>最も栄えた時の領（${esc(yr(peak.year))}${peak.month}月）</span></div>
        <div><b>${r.start.gens} → ${r.fell.ronin}</b><span>武将（最多${peakGens.gens}）</span></div>
        <div><b>${r.start.troops} → ${s[s.length - 1].troops}</b><span>兵</span></div>
      </div>
      ${chart}
      <h4>経緯</h4>
      <ul class="small fall-events">${ev || '<li>目立った出来事は書き留められていない</li>'}</ul>
      <p class="small">最後の当主：<b>${esc(r.fell.lord || '（当主はすでにいない）')}</b>。${r.fell.ronin ? `残っていた武将${r.fell.ronin}人は、浪人となって野に散った。` : '仕える武将は、もう残っていなかった。'}</p>
      <p class="u-end">${mine ? 'あなたの家の物語は、ここで幕を閉じた。' : `こうして${esc(r.name)}の名は、歴史の中に消えていった。`}</p>
      <p class="cbtns"><button class="primary" data-a="ok">${left ? `次へ（あと${left}家）` : '閉じる'}</button>${left ? ` <button data-a="skip">残りの滅亡を飛ばす</button>` : ''}</p>`;
    this.frame().appendChild(box);
    play('lose');
    box.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => { box.remove(); this.refresh(); };
    box.querySelector<HTMLButtonElement>('[data-a="skip"]')?.addEventListener('click', () => { c.fallen = []; box.remove(); this.refresh(); });
  }

  /** 味方のおまかせの方針を選ぶ窓（P50） */
  private openPlan(): void {
    this.host.root.querySelector('.result.ask')?.remove();
    const box = document.createElement('div');
    box.className = 'result ask planbox';
    const draw = (): void => {
      box.innerHTML = `<h2>おまかせの方針</h2>
        <p class="small">味方をおまかせで戦わせるとき（攻め・守りの「おまかせ」「観戦」、1か月オート、戦闘中の一部だけおまかせ）は、武将の性格ではなく、ここで選んだ方針で動きます。敵は今までどおり武将の性格で動きます。戦闘の画面でも、いつでも切り替えられます。</p>
        ${planPickerHtml(getPlan())}
        <ul class="small dim">${(['push', 'aim', 'mind'] as const).map((k) => `<li>${PLAN_LABEL[k][getPlan()[k] as never]}：${PLAN_TIP[k][getPlan()[k] as never]}</li>`).join('')}</ul>
        <button class="primary" data-a="ok">閉じる</button>`;
      wirePlanPicker(box, () => draw());
      box.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => { box.remove(); this.refresh(); };
    };
    draw();
    this.host.root.querySelector('.battle')!.appendChild(box);
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
    // 武将から下げた兵が引き継いだ技・軍略（P59）
    const extra = [...(t.extraSkills ?? []).map((id) => D.skills.find((s) => s.id === id)?.name).filter(Boolean).map((n) => L(n!)), ...(t.extraTactics ?? []).map((id) => D.byTactic[id]?.name).filter(Boolean).map((n) => L(n!))];
    if (extra.length) return this.chipHtmlBody(key, t, i, unit, `\n引き継いだ技・軍略：${extra.join('・')}`);
    return this.chipHtmlBody(key, t, i, unit, '');
  }
  private chipHtmlBody(key: string, t: GTroop, i: number, unit: string, extraTip: string): string {
    return `<button class="chip ${this.troopMenu?.gid === key && this.troopMenu.i === i ? 'on' : ''}" data-troop="${key}" data-i="${i}" data-tip="${esc(`${unitTip(t.unitId, t.level)}${extraTip}\n\nつまんで別の武将や予備兵へ運ぶと渡せます。欄の外へ落とすと手放すかを聞きます。押すと、名前の変更などの欄が開きます。`)}">${this.icon(t.unitId)}<span class="nm">${esc(t.name ?? unit)}</span><span class="dim">${t.level}</span><span class="tcost">采${D.byUnit[t.unitId].cost}</span></button>`;
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

  /** 選んだ武将（どの領にいても。今月まだ動いていない自分の武将）。攻めるときは、複数の領から出られる（P35） */
  private pickedAll(): GGeneral[] {
    const c = this.c;
    return [...this.picked].map((id) => c.gs.generals[id]).filter((g): g is GGeneral => !!g && g.faction === c.player && !c.moved.has(g.id));
  }

  private targets(kind: 'move' | 'attack'): Set<number> {
    const c = this.c, out = new Set<number>();
    if (!c.player) return out;
    // 移動は、選んでいる領の武将を、自分の領づたいに3つ先まで
    if (kind === 'move') return this.selected >= 0 && this.pickedHere().length ? moveTargets(c, this.selected, c.player) : out;
    // 攻めるのは、選んだ武将のいる領のどれにも隣り合う領（複数の領から1つの領を攻める）
    const srcs = [...new Set(this.pickedAll().map((g) => g.prov))];
    if (!srcs.length) return out;
    for (const n of neighborsOf(c, srcs[0])) {
      const owner = c.gs.provinces[n].owner;
      if (owner === c.player || !canAttack(c, c.player, owner)) continue;
      if (srcs.every((s) => neighborsOf(c, s).includes(n))) out.add(n);
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
        void this.attackFrom(prov);
        return;
      } else this.order = 'none';
      this.refresh();
      return;
    }
    // 自分の領どうしを選び直すときは、選んだ武将を残す（複数の領から攻めるため）
    if (!c.player || c.gs.provinces[prov]?.owner !== c.player) this.picked.clear();
    this.selected = prov;
    this.refresh();
  }

  /** 選んだ武将で攻める。出陣する領が複数なら、戦場の向き（どの領の側から攻めるか）を選ぶ */
  private async attackFrom(prov: number): Promise<void> {
    const c = this.c, gs = c.gs, gens = this.pickedAll();
    const srcs = [...new Set(gens.map((g) => g.prov))];
    let from = srcs[0];
    if (srcs.length > 1) {
      const count = (s: number) => gens.filter((g) => g.prov === s).length;
      srcs.sort((a, b) => count(b) - count(a) || a - b);
      const pending = confirmBox(this.frame(), {
        title: `複数の領から${esc(gs.provinces[prov].name.ja)}へ攻める`,
        body: `<p>${srcs.map((s) => `<b>${esc(gs.provinces[s].name.ja)}</b>（${gens.filter((g) => g.prov === s).map((g) => esc(g.name.ja)).join('・')}）`).join('、')}から攻めます。</p>
          <label>戦場の向き：<select id="atkFrom">${srcs.map((s) => `<option value="${s}">${esc(gs.provinces[s].name.ja)}の側から</option>`).join('')}</select></label>
          <p class="dim small">戦場は、選んだ領の方角から攻め入る形になります。負けたら、武将はそれぞれの領に残ります。勝ったら、みな攻め取った領に移ります。</p>`,
        ok: '攻める',
      });
      const sel = this.frame().querySelector<HTMLSelectElement>('.confirm #atkFrom');
      if (!(await pending)) { this.order = 'none'; this.refresh(); return; }
      from = Number(sel?.value ?? from);
    }
    // 戦をしていない国の領へ攻めるときは、開戦してよいかを確かめる（P41）
    const owner = gs.factions[gs.provinces[prov].owner];
    if (owner && relation(c, c.player, owner.id) === 'neutral') {
      const allies = Object.values(gs.factions).filter((x) => x.id !== owner.id && x.id !== c.player && relation(c, x.id, owner.id) === 'ally').map((x) => esc(x.name.ja));
      const ok = await confirmBox(this.frame(), {
        title: `${esc(owner.name.ja)}と開戦して攻める`, danger: true, banner: sceneUrl('setup', gs.variant),
        body: `<p>${factionBadge(owner.name.ja, owner.color)} とは、いま戦をしていません（中立）。${esc(gs.provinces[prov].name.ja)}へ攻め込むと、<b>${esc(owner.name.ja)}と戦</b>になります。</p>
          <ul class="small"><li>停戦するまで、互いに領を攻め合えるようになる（${esc(owner.name.ja)}からも攻めてくる）</li>
          <li>${esc(owner.name.ja)}の心証が大きく下がる</li>
          ${allies.length ? `<li>${esc(owner.name.ja)}の味方（${allies.join('・')}）の心証も下がる</li>` : ''}</ul>`,
        ok: '開戦して攻める', cancel: 'やめる',
      });
      if (!ok) { this.order = 'none'; this.refresh(); return; }
    }
    // 相国は攻めに出られない（P77）：選んでいても外す
    const ch = gens.find((g) => officeBlocks(c, g.id, 'attack'));
    if (ch) toast(`相国の${ch.name.ja}は政務で城を離れられないので、攻めには出しません`);
    const pb = planAttack(c, c.player, from, prov, gens.map((g) => g.id));
    this.order = 'none'; this.picked.clear();
    if (pb) { void busy('攻め込んでいます…', () => this.fight(pb, 0, () => this.mount())); return; }
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
      <p class="where"><span class="from">${esc(fromName)}</span> から <span class="to">${esc(p.name.ja)}</span> へ${bySea(gs, pb.from, pb.prov) ? '<b>（海路）</b>' : ''} <span class="dim small">（地図に朱と金で示しています）</span></p>
      <p>攻め手：${esc(names(pb.atk))}</p>
      <p>守り手：${garrison ? `守備兵（Lv${g.level}・${g.troops}隊）<span class="dim">　守る武将はいません</span>` : esc(names(pb.def))}</p>
      ${garrison
        ? `<button class="primary" data-a="play">自分で戦う</button> <button data-a="watch">観戦</button> <button data-a="auto">おまかせ</button>${side === 0 ? ' <button data-a="cancel">攻めるのを中止</button>' : ''}<p class="dim small">自分で戦うは、自分の側を動かします。観戦は、戦いを見ます（途中で「手動にする」を押すと、自分で動かせます）。おまかせは、結果だけ出ます。</p>`
        : `<button class="primary" data-a="play">自分で戦う</button> <button data-a="auto">おまかせ</button>${side === 0 ? ' <button data-a="cancel">攻めるのを中止</button>' : ''}`}`;
    this.host.root.querySelector('.battle')!.appendChild(box);
    // 攻めてきた領と攻められた領を、地図で目立たせて真ん中へ寄せる
    this.alarm = { from: pb.from, to: pb.prov };
    this.view.focusOn(pb.from, pb.prov);
    this.draw();
    // 攻めて勝ち、領を取ったら、地図に戻ったあとで祝いの窓を出す（P38）
    const prevOwner = p.owner, mark = c.log.length;
    // 戦いの前の顔ぶれ（結果の窓で使う。P55）
    const roster = {
      atk: pb.atk.map((id) => gs.generals[id]).filter(Boolean).map((x) => ({ name: x.name.ja, lv: x.level, troops: x.troops.length })),
      def: garrison ? [{ name: '守備兵', lv: g.level, troops: g.troops }] : pb.def.map((id) => gs.generals[id]).filter(Boolean).map((x) => ({ name: x.name.ja, lv: x.level, troops: x.troops.length })),
    };
    let win: { sum: BattleSummary } | null = null;
    const won = (sum: BattleSummary | null): BattleSummary | null => {
      win = side === 0 && sum && c.player && gs.provinces[pb.prov].owner === c.player && prevOwner !== c.player ? { sum } : null;
      return sum;
    };
    // 捕らえた将がいれば、先に決める窓を出す（P73）
    const then = (): void => this.captiveWindows(() => { after(); if (win) this.celebrate(pb, win.sum, mark, prevOwner); });
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        this.alarm = null;
        // 攻めるのを中止（P47）：まだ戦も始まっておらず、武将も動いていないので、窓を閉じて地図に戻るだけ
        if (b.dataset.a === 'cancel') { box.remove(); toast('攻めるのを中止しました'); this.mount(); return; }
        if (b.dataset.a === 'auto') {
          void busy('戦っています…', () => {
            const sum = won(resolveBattle(c, pb));
            // 攻められた戦いと、攻めて負けた戦いは、結果を詳しく窓で出す（P55）。攻めて勝ったときは祝いの窓
            if (sum && !win) { this.mount(); this.battleReport(pb, sum, side, mark, prevOwner, roster, () => this.captiveWindows(after)); } else then();
          });
          return;
        }
        const human = b.dataset.a === 'watch' ? new Set<Side>() : new Set<Side>([side]);
        void busy('戦場を用意しています…', () => this.host.openBattle(battleFor(c, pb), human, (st) => won(resolveBattle(c, pb, st)), { label: '戦略マップへ', fn: then }, false, side));
      };
    });
  }

  /**
   * 戦いの結果の窓（P55）：攻められた戦い（と、攻めて負けた戦い）を「おまかせ」で決着させたとき。
   * 勝ち負け、両陣営の顔ぶれ・倒された武将・失った兵・手柄を立てた兵、深手、領の行方（奪われた・一気に取られた領・退いた先）、捕まえた兵
   */
  private battleReport(pb: PendingBattle, sum: BattleSummary, side: Side, mark: number, prevOwner: number, roster: { atk: { name: string; lv: number; troops: number }[]; def: { name: string; lv: number; troops: number }[] }, done: () => void): void {
    const c = this.c, gs = c.gs, p = gs.provinces[pb.prov];
    const logs = c.log.slice(mark);
    const iWon = sum.winner === side;
    const atkF = gs.factions[pb.attacker], defF = gs.factions[pb.defender];
    const atkName = atkF?.name.ja ?? (logs.find((l) => l.key === 'battle')?.vars.attacker as string) ?? '攻め手';
    const defName = defF?.name.ja ?? '守備兵';
    const lostProv = side === 1 && prevOwner === c.player && p.owner !== c.player;
    const chain = logs.filter((l) => l.key === 'chainCapture').flatMap((l) => String(l.vars.ids).split(',')).map((n) => gs.provinces[Number(n)]).filter((q) => q && q.owner !== c.player);
    const wounded = logs.filter((l) => l.key === 'wounded').map((l) => `${l.vars.names}（深手・${l.vars.months}か月${l.vars.by ?? ''}）`);
    const taken = logs.filter((l) => l.key === 'captured').map((l) => `${l.vars.by}が${l.vars.from}の${l.vars.name}${l.vars.lord ?? ''}を捕らえた`);
    const caught = logs.filter((l) => l.key === 'caught').map((l) => `${l.vars.from}の${l.vars.unit}`);
    const fell = logs.filter((l) => l.key === 'fall').map((l) => String(l.vars.faction));
    // 自分の武将の、いまいる領（退いた先）
    const mine = (side === 0 ? pb.atk : pb.def).map((id) => gs.generals[id]).filter((x) => x && x.faction === c.player);
    const whereNow = mine.map((x) => `${x.name.ja}：${gs.provinces[x.prov]?.name.ja ?? '—'}${x.prov !== pb.prov && side === 1 ? 'へ退いた' : ''}`);
    const li = (xs: string[]): string => xs.map((x) => `<li>${esc(x)}</li>`).join('');
    const sideBox = (s: 0 | 1): string => {
      const who = s === 0 ? atkName : defName, list = s === 0 ? roster.atk : roster.def;
      const beaten = sum.beaten.filter((_n, i) => sum.beatenSides[i] === s);
      const lost = sum.lost.filter((l) => l.side === s);
      const ups = sum.levelUps.filter((u) => u.side === s);
      const by = new Map<string, string[]>();
      for (const l of lost) by.set(l.general, [...(by.get(l.general) ?? []), l.unit]);
      return `<div class="side ${s === side ? 'me' : ''}"><h4>${s === 0 ? '攻め手' : '守り手'}　${esc(who)}${sum.winner === s ? '（勝ち）' : '（負け）'}${s === side ? ' <span class="tag">自分</span>' : ''}</h4>
        <p class="small">顔ぶれ：${list.map((x) => `${esc(x.name)} Lv${x.lv}・兵${x.troops}`).join('、') || '—'}</p>
        <p class="small"><span class="dim">倒された武将</span>　${beaten.length ? beaten.map(esc).join('、') : 'なし'}</p>
        <p class="small"><span class="dim">失った兵</span>　${lost.length ? `${lost.length}隊：${[...by].map(([gname, us]) => `${esc(gname)}の${us.map(esc).join('・')}`).join('、')}` : 'なし'}</p>
        ${ups.length ? `<p class="small"><span class="dim">レベルが上がった</span>　${ups.map((u) => `${esc(u.name)} Lv${u.from}→${u.to}`).join('、')}</p>` : ''}</div>`;
    };
    const fate = side === 1
      ? (lostProv ? [`${p.name.ja}を${atkName}に奪われた`, ...chain.map((q) => `勢いに乗られ、${q.name.ja}も奪われた（守る武将のいない領）`)] : [`${p.name.ja}を守り切った`])
      : [`${p.name.ja}は${defName}のまま`];
    const box = document.createElement('div');
    box.className = `result report ${iWon ? 'won' : 'lost'}`;
    box.innerHTML = `${bannerHtml(sceneUrl(iWon ? 'victory' : 'defeat', gs.variant))}
      <h2 class="${iWon ? '' : 'lost'}">${esc(side === 1 ? (iWon ? `${p.name.ja}を守り切った！` : `${p.name.ja}を奪われた`) : `${p.name.ja}攻め：敗れた`)}</h2>
      <p class="vsub">${esc(this.date())}　${atkF ? factionBadge(atkF.name.ja, atkF.color) : esc(atkName)} が ${esc(gs.provinces[pb.from]?.name.ja ?? '')} から ${esc(p.name.ja)} へ（${defF ? factionBadge(defF.name.ja, defF.color) : esc(defName)}）　${sum.rounds}巡で決着</p>
      <div class="sides">${sideBox(0)}${sideBox(1)}</div>
      <h4>領の行方</h4><ul class="small">${li(fate)}</ul>
      ${whereNow.length ? `<h4>自分の武将</h4><ul class="small">${li(whereNow)}</ul>` : ''}
      ${wounded.length ? `<h4>深手</h4><ul class="small">${li(wounded)}</ul>` : ''}
      ${taken.length ? `<h4>捕らえた将</h4><ul class="small">${li(taken)}</ul>` : ''}
      ${caught.length ? `<h4>捕まえた兵</h4><ul class="small">${li(caught)}</ul>` : ''}
      ${fell.length ? `<h4>滅んだ家</h4><ul class="small">${li(fell)}</ul>` : ''}
      <p class="cbtns"><button class="primary" data-a="ok">確かめた</button></p>`;
    this.frame().appendChild(box);
    this.flash = p.id;
    this.view.focusOn(pb.from, p.id);
    this.draw();
    play(iWon ? 'win' : 'lose');
    box.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => { box.remove(); this.flash = null; done(); };
  }

  /** 攻められた戦いを順に決着させ、すべて終わったら月を締める */
  private nextQueued(): void {
    const pb = this.queue.shift();
    if (pb) { this.mount(); this.fight(pb, 1, () => this.nextQueued()); return; }
    // 月を締めるのは重い（出来事・史実・セーブ・描き直し）ので、先に「締めています」を出す（0.2秒の約束）
    void busy('月を締めています…', () => {
      finishMonth(this.c);
      this.c.log.push({ key: 'month', vars: { date: this.date() } });
      this.autosave();
      this.mount();
      // ほかの勢力どうしの戦いを見せてから、今月の知らせを出す
      const reel = this.c.reel ?? [];
      this.c.reel = [];
      if (reel.length && reelOn()) this.playReel(reel, () => this.showNews(this.logMark));
      else this.showNews(this.logMark);
    });
  }

  /**
   * 勝って領を取ったときの、祝いの演出と報告の窓（P38）。金箔が舞い、勝鬨の文字と、戦いの結果（討ち取った敵将・レベルの上がった兵・失った兵）、
   * 手に入れたもの（領のようす・予備兵・捕まえた兵・新しく雇える兵種・滅ぼした家）を発表する。地図ではその領を光らせる
   */
  private celebrate(pb: PendingBattle, sum: BattleSummary, mark: number, prevOwner: number): void {
    const c = this.c, gs = c.gs, p = gs.provinces[pb.prov], me = gs.factions[c.player];
    if (!me) return;
    const logs = c.log.slice(mark);
    const prevName = (logs.find((l) => l.key === 'capture')?.vars.from as string | undefined) || (gs.factions[prevOwner]?.name.ja ?? '在地の兵');
    const beaten = sum.beaten.filter((_n, i) => sum.beatenSides[i] === 1);
    const ups = sum.levelUps.filter((u) => u.side === 0);
    const lost = sum.lost.filter((l) => l.side === 0);
    const fresh = Object.keys(provinceRecruit(c, p.id)).filter((u) => D.byUnit[u] && !isNativeUnit(me, u));
    const fell = logs.filter((l) => l.key === 'fall').map((l) => String(l.vars.faction));
    const reserve = logs.filter((l) => l.key === 'reserveTaken').reduce((s, l) => s + Number(l.vars.n ?? 0), 0);
    const taken = logs.filter((l) => l.key === 'captured').map((l) => `${l.vars.by}が${l.vars.from}の${l.vars.name}${l.vars.lord ?? ''}を捕らえた`);
    const caught = logs.filter((l) => l.key === 'caught').map((l) => `${l.vars.from}の${l.vars.unit}`);
    // 一気に取った領（P48）
    const chain = logs.filter((l) => l.key === 'chainCapture').flatMap((l) => String(l.vars.ids).split(',')).map((n) => gs.provinces[Number(n)]).filter((q) => q && q.owner === c.player);
    const li = (xs: string[]): string => xs.map((x) => `<li>${x}</li>`).join('');
    const sec = (title: string, xs: string[]): string => (xs.length ? `<h4>${title}</h4><ul>${li(xs)}</ul>` : '');
    const leaf = Array.from({ length: 28 }, (_v, i) => `<span class="leaf" style="left:${(i * 37) % 100}%;animation-delay:${((i * 0.23) % 2.4).toFixed(2)}s;animation-duration:${(2.6 + (i % 5) * 0.4).toFixed(1)}s"></span>`).join('');
    const box = document.createElement('div');
    box.className = 'result victory-box';
    box.innerHTML = `<div class="leaves">${leaf}</div>${bannerHtml(sceneUrl('victory', gs.variant))}
      <div class="kachidoki">勝利！</div>
      <h2>${esc(p.name.ja)}を攻め取った！</h2>
      <p class="vsub">${esc(this.date())}　${factionBadge(me.name.ja, me.color)} が ${esc(prevName)} から奪う</p>
      <div class="vgrid">
        <div>${sec('戦果', [
          ...beaten.map((n) => `敵将 <b>${esc(n)}</b> を討ち取った`),
          ...fell.map((f) => `<b>${esc(f)}</b> を滅ぼした`),
          ...caught.map((x) => `${esc(x)}を捕まえた`),
        ]) || '<h4>戦果</h4><ul><li>敵を退けた</li></ul>'}
        ${sec('手柄を立てた兵', ups.map((u) => `${esc(u.name)} Lv${u.from}→<b>${u.to}</b>`))}
        ${sec('失った兵', lost.map((l) => `${esc(l.general)}の${esc(l.unit)}`))}</div>
        <div>${sec('手に入れた領', [
          `人口${Math.round(p.pop)}・収入${Math.round(p.income)}・城${Math.round(p.fort * 100)}%${p.buildings.length ? `・${p.buildings.map((b) => esc(BM.buildings[b]?.name ?? b)).join('・')}` : ''}`,
          `入った武将：${pb.atk.map((id) => esc(gs.generals[id]?.name.ja ?? '')).filter(Boolean).join('・')}`,
          ...(reserve ? [`予備兵 ${reserve}隊を手に入れた`] : []),
        ])}
        ${sec('勢いに乗って一気に取った領', chain.map((q) => `<b>${esc(q.name.ja)}</b>（人口${Math.round(q.pop)}・収入${Math.round(q.income)}）`))}
        ${sec('新しく雇える兵種（兵糧2倍）', fresh.map((u) => esc(L(D.byUnit[u].name))))}</div>
      </div>
      <p class="cbtns"><button class="primary" data-a="ok">勝鬨をあげる</button></p>`;
    this.frame().appendChild(box);
    this.flash = p.id;
    this.view.focusOn(pb.from, p.id);
    this.draw();
    play('win');
    box.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => { box.remove(); this.flash = null; this.selected = p.id; this.refresh(); };
  }

  /**
   * 月送りの演出（P31）：ほかの勢力どうしの戦いを1つずつ見せる。地図はいったん月の初めの持ち主に戻し、
   * 戦いごとに、攻めた領から守る領へ矢印・攻め手と守り手・小さな戦場の図・結果を出し、領が移ったらその領の色を変えて光らせる。
   * 「この戦いを飛ばす」で次へ、「この月をすべて飛ばす」で終わる。終わると、地図は月の終わりの持ち主に戻る
   */
  private playReel(list: ReelBattle[], done: () => void): void {
    const c = this.c, gs = c.gs, frame = this.frame();
    // 月の終わりの持ち主を覚えておき、移った領を月の初めの持ち主に戻す（あとの戦いから順に。滅んだ家には戻さない）
    const finalOf = new Map<number, [number, number]>();
    for (const b of list) if (b.captured) finalOf.set(b.prov, [gs.provinces[b.prov].owner, gs.provinces[b.prov].controller]);
    const setOwner = (prov: number, owner: number, controller = owner): void => { gs.provinces[prov].owner = owner; gs.provinces[prov].controller = controller; };
    for (const b of [...list].reverse()) if (b.captured && gs.factions[b.defender]) setOwner(b.prov, b.defender);
    const cover = document.createElement('div');
    cover.className = 'reel-cover';
    const box = document.createElement('div');
    box.className = 'result low reel';
    frame.append(cover, box);
    let i = 0, timer = 0, stopped = false;
    const finish = (): void => {
      if (stopped) return;
      stopped = true; clearTimeout(timer);
      for (const [p, [o, ctl]] of finalOf) setOwner(p, o, ctl);
      this.alarm = null; this.flash = null;
      box.remove(); cover.remove();
      this.refresh();
      done();
    };
    const facName = (id: number): string => gs.factions[id]?.name.ja ?? (id ? '滅んだ家' : '在地の兵');
    const badge = (id: number): string => (gs.factions[id] ? factionBadge(gs.factions[id].name.ja, gs.factions[id].color) : `<span class="dim">${esc(facName(id))}</span>`);
    const people = (xs: ReelBattle['atk']): string => xs.map((x) => `${esc(x.name)}<span class="dim">（Lv${x.lv}・兵${x.troops}）</span>`).join('、') || '<span class="dim">なし</span>';
    const result = (b: ReelBattle, quick: boolean): void => {
      clearTimeout(timer);
      if (stopped) return;
      if (b.captured) setOwner(b.prov, b.attacker);
      this.flash = b.captured ? b.prov : null;
      this.draw();
      const winner = b.winner === 0 ? b.attacker : b.defender;
      const out = box.querySelector('.reel-result');
      out?.classList.remove('dim');
      if (out) out.innerHTML = `<b>${esc(facName(winner))}の勝ち</b>${b.captured ? `　${esc(gs.provinces[b.prov].name.ja)}は${esc(facName(b.attacker))}のものになった` : '　領は守られた'}`;
      // 様子の分かる領の戦いは、結果の詳細も報告する（P43）
      if (out && b.detail) {
        const fell = (side: 0 | 1): string => (b.beaten ?? []).filter((x) => x.side === side).map((x) => esc(x.name)).join('・');
        out.innerHTML += `<div class="reel-detail small">${b.rounds ?? '?'}巡で決着。失った兵：攻め手${b.lost?.[0] ?? 0}隊・守り手${b.lost?.[1] ?? 0}隊${fell(1) ? `<br>倒された守り手の武将：${fell(1)}` : ''}${fell(0) ? `<br>倒された攻め手の武将：${fell(0)}` : ''}</div>`;
      } else if (out) out.innerHTML += '<div class="reel-detail small dim">（様子の分からない領なので、くわしいことは分からない）</div>';
      timer = window.setTimeout(() => { this.flash = null; i++; show(); }, quick ? 0 : 1500);
    };
    const show = (): void => {
      if (stopped) return;
      if (i >= list.length) { finish(); return; }
      const b = list[i], p = gs.provinces[b.prov], from = gs.provinces[b.from];
      this.alarm = { from: b.from, to: b.prov };
      this.view.focusOn(b.from, b.prov);
      this.draw();
      let map = '';
      try { map = mapPreviewUrl(provinceMap(c, b.prov, b.from)); } catch { map = ''; }
      box.innerHTML = `<div class="reel-head"><span class="dim small">ほかの国の戦い ${i + 1}／${list.length}</span></div>
        <h2>${esc(facName(b.attacker))}が${esc(p.name.ja)}へ攻め込んだ</h2>
        <p class="where"><span class="from">${esc(from?.name.ja ?? '')}</span> から <span class="to">${esc(p.name.ja)}</span> へ${bySea(gs, b.from, b.prov) ? '<b>（海路）</b>' : ''}</p>
        <p class="reel-result dim">戦っています…</p>
        <div class="reel-body">${map ? `<div class="reel-mapbox"><img class="reel-map" src="${map}" alt="この戦いの戦場" draggable="false"><div class="reel-round small dim"></div></div>` : ''}
          <div class="reel-sides"><p>${badge(b.attacker)} 攻め手：${people(b.atk)}</p><p>${badge(b.defender)} 守り手：${people(b.def)}</p>
</div></div>
        <p class="cbtns"><button data-r="one">この戦いを飛ばす</button> <button data-r="all">この月をすべて飛ばす</button></p>`;
      box.querySelector<HTMLButtonElement>('[data-r="one"]')!.onclick = () => result(b, true);
      box.querySelector<HTMLButtonElement>('[data-r="all"]')!.onclick = finish;
      // 3巡ごとの駒の並びを、順に描き直して見せる（P43）。並びが無ければ、少し待って結果へ
      const frames = b.frames ?? [];
      const img = box.querySelector<HTMLImageElement>('.reel-map'), lab = box.querySelector<HTMLElement>('.reel-round');
      let f = 0;
      const step = (): void => {
        if (stopped || f >= frames.length || !b.map) { result(b, false); return; }
        try { if (img) img.src = mapPreviewUrl(b.map, 10, frames[f].units); } catch { /* 描けなくても続ける */ }
        if (lab) lab.textContent = f === frames.length - 1 ? `決着（${frames[f].round}巡目）` : `${frames[f].round}巡目`;
        f++;
        timer = window.setTimeout(step, f === 1 ? 900 : 650);
      };
      if (frames.length && b.map) step(); else timer = window.setTimeout(() => result(b, false), 1800);
    };
    show();
  }

  private advance(): void {
    const c = this.c;
    this.order = 'none'; this.picked.clear();
    if (!c.player) { autoMonth(c); c.log.push({ key: 'month', vars: { date: this.date() } }); if (!this.running) this.autosave(); this.refresh(); return; }
    this.logMark = c.log.length;
    c.reel = [];
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
      // 偵察度が低い領の武将の数は、地図に出さない
      if (c.player && g.faction !== c.player) { const tier = scoutTier(c, g.prov); if (tier === 'rough' || tier === 'none') continue; }
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
      flash: this.flash ?? undefined,
    };
    this.view.draw();
  }

  private generalHtml(g: GGeneral, own: boolean): string {
    const c = this.c, cls = D.byClass[g.classId];
    // 兵の名前の横に、小さな兵の絵を添える（絵の無い兵種は名前だけ）
    const icon = (unitId: string): string => { const url = artUrl(`unit/${c.gs.variant}/${unitId}`); return url ? `<img class="uicon" src="${url}" alt="" draggable="false">` : ''; };
    // 自分の武将の兵は、つまんで別の武将の欄へ運ぶと渡せる。武将の欄の外へ落とすと、手放すかを聞く。
    // （指で触る画面ではつまんで運べないので、押すと渡す・手放すの欄が開く動きも残してある）
    // 兵種を進める（P52）：進められる兵は、兵の札のすぐ隣に「▲進む先」のボタン
    const upBtn = (t: GTroop, i: number): string => troopUpgrades(g, i, c.items).filter((p) => p.ok).map((p) =>
      `<button class="upbtn" data-up-ask="${g.id}" data-i="${i}" data-to="${p.to}" data-tip="${esc(`${L(D.byUnit[t.unitId].name)} → ${L(D.byUnit[p.to].name)} に進めると：\n${changeText(troopChange(t, p.to))}\n\n押すと、確かめる窓が出ます（進めたら戻れません）`)}">▲${esc(L(D.byUnit[p.to].name))}</button>`).join('');
    const troops = g.troops.map((t, i) => own
      ? this.chipHtml(g.id, t, i) + upBtn(t, i)
      : `<span class="tname" data-tip="${esc(unitTip(t.unitId, t.level))}">${icon(t.unitId)}<span class="nm">${esc(t.name ?? L(D.byUnit[t.unitId].name))}</span><span class="dim">${t.level}</span></span>`).join(own ? '' : '、') || '<span class="dim">兵なし</span>';
    const moved = c.moved.has(g.id);
    const check = own ? `<input type="checkbox" data-pick="${g.id}" ${this.picked.has(g.id) ? 'checked' : ''} ${moved ? 'disabled' : ''}>` : '';
    let rec = '';
    if (own) {
      const f = c.gs.factions[g.faction];
      // 武将のいる領で雇える兵種から（P37）。初めから雇えた兵種でなければ、兵糧が2倍
      const can = Object.keys(provinceRecruit(c, g.prov)).filter((u) => !recruitProblem(c, g, u))
        .sort((a, b) => Number(isNativeUnit(f, b)) - Number(isNativeUnit(f, a)) || a.localeCompare(b));
      // 前に選んだ兵種を選んだままにする（同じ兵種を続けて雇いやすいように。武将ごと、なければ最後に選んだ兵種。P81）
      const pick = [this.lastUnit[g.id], this.lastUnitAny].find((u) => u && can.includes(u)) ?? can[0];
      const opts = can.map((u) => `<option value="${u}" ${u === pick ? 'selected' : ''}>${L(D.byUnit[u].name)}（采配${D.byUnit[u].cost}・兵糧${recruitCostFor(c, g, u)}${isNativeUnit(f, u) ? '' : '・新しい兵種で2倍'}）</option>`).join('');
      // 選ぶ前から、いま選ばれている兵種の采配と兵糧、雇ったあとの残りの采配を出す（P51）
      // おまかせ登用（P81）：采配の範囲で、前衛・飛び道具・騎馬・支えがつり合うように雇う
      rec = opts ? `<span class="rec"><select data-unit="${g.id}">${opts}</select><button data-recruit="${g.id}">徴兵</button><button data-autorec="${g.id}" data-tip="${esc('采配の範囲で、この領で雇える兵から、前衛・飛び道具・騎馬・支えがつり合うように雇います（城攻め・水の上の兵は雇いません）')}">おまかせ登用</button><span class="recinfo" data-recinfo="${g.id}">${pick ? this.recruitInfo(g, pick) : ''}</span></span>` : '';
      // 昇進：武将の役職は役職名の隣、兵の兵種は兵の札の隣にボタンを出す（P52）
      const ups: string[] = [];
      if (!g.isLord && !(g.id in c.away)) ups.push(`<button data-lower="${g.id}" title="武将ではなくなり、この領の予備兵1隊になります。兵糧が${lowerRefund(g.level)}戻ります">兵にする</button>`);
      // 訓練：1か月訓練（行動済みになる）と、ずっと訓練（切り替え。その月ほかの命令で動いたときは訓練しない）
      const tp = trainProblem(c, g), always = c.training?.[g.id] === 'always', tm = trainMult(c, g);
      const multText = tm.mult > 1 ? `経験値×${Math.round(tm.mult * 100) / 100}（${tm.why.join('・')}）` : '経験値×1';
      ups.push(`<button data-train="${g.id}" ${tp ? `disabled title="${esc(tp)}"` : `title="${esc(`この月は訓練して行動済みになります。月の終わりに、${g.name.ja}と配下の兵に経験値が入ります。${multText}`)}"`}>1か月訓練</button>`);
      ups.push(`<button data-train-always="${g.id}" class="${always ? 'on' : ''}" title="${esc(`毎月の終わりに訓練します（その月に移動・攻めるなどで動かしたときは訓練しません）。${multText}`)}">ずっと訓練：${always ? '入' : '切'}</button>`);
      // 相国（偵察度を毎月上げる役。1人だけ）
      const chan = c.offices?.chancellor === g.id;
      if (!g.isLord) ups.push(`<button data-chancellor="${g.id}" class="${chan ? 'on' : ''}" title="${esc(chan ? `相国を解きます` : `相国は家の政を預かります（内政・外交・家中・訓練・偵察。1人だけ、毎月替えられる）。相国になると、攻め・訓練・直伝ができなくなります。押すと、効き目の見込みと説明が出ます`)}">${chan ? '相国を解く' : '相国に任じる'}</button>`);
      // 直伝（P68）：教えられるものと相手がいて、今月教え始められる将に
      if (!teacherProblem(c, g) && learnersOf(c, g).length && teachableArts(g).some((x) => !x.why)) ups.push(`<button data-teach="${g.id}" title="${esc('ほかの将や配下の兵に、技・軍略を教えます。押すと、教わる相手と技・軍略を選ぶ窓が出ます')}">直伝（技・軍略）</button>`);
      // 当主を譲る（P71）：譲れる人だけ（前に譲ってから間が無いあいだは出さない。遊び方に書く）
      if (!abdicateProblem(c, g)) ups.push(`<button data-abdicate="${g.id}" title="${esc(`${g.name.ja}に当主を譲ります。押すと、どう変わるかの説明と確かめる窓が出ます（一度譲ると${S.abdicate.cooldown}か月は譲れません）`)}">当主を譲る</button>`);
      if (!questProblem(c, g)) ups.push(`<button data-quest="${g.id}" title="2か月のあいだ戦えないが、浪人や昇進の品を得ることがある">諸国巡りに出す</button>`);
      if (ups.length) rec += `<div class="ups">${ups.join('')}</div>`;
    }
    const pers = personalityOf(g.traits, g.ab), plabel = personalityLabel(pers);
    const fig = this.figure(g);
    return `<div class="gen" ${own ? `data-gen="${g.id}"` : ''}>${check}${fig}<span><b class="wrap gname" data-profile="${g.id}" title="押すと、能力と列伝を読めます">${esc(g.name.ja)}</b>${own ? `<button class="pen" data-rename="${g.id}" title="名前を変える">✎</button>` : ''}${g.isLord ? ' <span class="tag">当主</span>' : ''}${g.imarpg ? ` <span class="tag ima" title="ima-rpg から来た人">${{ hero: '主人公', companion: '仲間', rival: 'ライバル' }[g.imarpg]}</span>` : ''}
      <span class="trait" data-tip="${esc(classTip(g.classId))}">${L(cls.name)}</span>${own ? generalPromotions(g).filter((p) => p.ok).map((p) => `<button class="upbtn" data-promo-ask="${g.id}" data-to="${p.to.id}" data-tip="${esc(`${L(cls.name)} → ${L(p.to.name)} に昇進すると：\n${changeText(generalChange(g, p.to.id))}\n\n押すと、確かめる窓が出ます（昇進したら戻れません）`)}">▲${esc(L(p.to.name))}</button>`).join('') : ''} Lv${g.level}<span class="dim"><span class="trait" data-tip="${esc(strengthTip(strengthOf(g), this.allStrength()))}">強さ${Math.round(strengthOf(g))}（${strengthRank(strengthOf(g), this.allStrength()).word}）</span>${moved ? ' ・行動済' : ''}${own && (c.trainedThisMonth ?? []).includes(g.id) ? ' ・今月は訓練' : own && c.training?.[g.id] === 'always' ? ' ・ずっと訓練' : ''}${own && c.offices?.chancellor === g.id ? ' ・相国' : ''}${own && isResting(c, g.id) ? ' ・休養中（退却。守りには出られる）' : ''}${own && (c.scoutMissions ?? []).some((m) => m.gid === g.id) ? ' ・偵察中' : ''}${this.lessonText(g)}
      ${g.traits.length ? ` ・${g.traits.map((t) => `<span class="trait" data-tip="${esc(traitTip(t))}">${TRAIT_NAME[t] ?? t}</span>`).join('・')}` : ''}
      ・<span class="trait" data-tip="${esc(personalityTip(pers, plabel))}">性格：${plabel}</span></span><br>
      ${this.commandBar(g)}<span class="troops">${troops}</span> ${own ? this.troopMenuHtml(g.id) : ''}${rec}</span></div>`;
  }

  /** 直伝の最中なら「・直伝中：…」（教える側・教わる将・教わる兵の将の欄に出す。P68） */
  private lessonText(g: GGeneral): string {
    const c = this.c;
    const xs = (c.lessons ?? []).filter((x) => x.teacher === g.id || x.learner === g.id);
    return xs.map((x) => {
      const t = c.gs.generals[x.teacher], l = lessonLearner(c, x);
      const who = x.teacher === g.id ? `${l ? learnerName(l) : ''}に教える` : `${t?.name.ja ?? ''}から教わる`;
      return ` ・<span class="trait" data-tip="${esc(`直伝：${t?.name.ja ?? ''} → ${l ? learnerName(l) : ''}「${artName(x.art, x.kind)}」。${x.months}か月のうち${x.progress}か月。教えているあいだは行動済み（守りには出られる）。療養に入るとやり直し、討たれる・寝返る・領を失うと取りやめ`)}">直伝中：${esc(who)}「${esc(artName(x.art, x.kind))}」${x.progress}/${x.months}か月</span>`;
    }).join('');
  }

  /** 直伝の窓（P68）：教わる相手と技・軍略を選ぶ。教えられないものは灰色で理由つき */
  private async teachWindow(teacher: GGeneral): Promise<void> {
    const c = this.c, learners = learnersOf(c, teacher), arts = teachableArts(teacher);
    if (!learners.length) return;
    let li = 0, pick = -1, forgot = false;
    const body = `<div class="teach">
      <p class="small dim">教えるのに、当主から将へは${S.teach.months.lord}か月、将から将へは${S.teach.months.general}か月、将から配下の兵へは${S.teach.months.troop}か月かかります（必ず成功）。そのあいだ教える側と教わる将は行動済み（守りには出られます）。1つの領で同時に1つまで。教わったものは「借り物」で気力が${Math.round((S.teach.borrowedMpMult - 1) * 100)}%多くかかり、戦いで${S.teach.masterUses}回使うと身につきます（直伝済）。</p>
      <label>教わる相手：<select id="tLearner">${learners.map((l, i) => `<option value="${i}">${esc(learnerName(l))}（枠 ${slotsOfLearner(l) - slotsLeft(l)}/${slotsOfLearner(l)}）</option>`).join('')}</select></label>
      <div id="tArts" class="tarts"></div><div id="tInfo" class="small"></div><div id="tForget" class="small"></div></div>`;
    const wait = confirmBox(this.frame(), { title: `${esc(teacher.name.ja)}の直伝（技・軍略）`, body, ok: '教え始める', cancel: 'やめる' });
    const box = this.frame().querySelector<HTMLElement>('.result.ask')!;
    const okBtn = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
    const render = (): void => {
      const l = learners[li];
      const rows = arts.map((x, i) => {
        const why = teachProblem(c, teacher, l, x.art);
        return `<label class="tart ${why ? 'off' : ''}"><input type="radio" name="tArt" value="${i}" ${why ? 'disabled' : ''} ${pick === i ? 'checked' : ''}> ${x.art.kind === 'skill' ? '技' : '軍略'}「${esc(artName(x.art.id, x.art.kind))}」<span class="dim">気力${artMp(x.art.id, x.art.kind)}</span>${why ? `<span class="why">${esc(why)}</span>` : ''}</label>`;
      });
      box.querySelector('#tArts')!.innerHTML = rows.join('');
      const sel = pick >= 0 ? arts[pick] : null, problem = sel ? teachProblem(c, teacher, l, sel.art) : 'えらんでいない';
      okBtn.disabled = !!problem;
      const info = box.querySelector('#tInfo')!;
      if (sel && !problem) {
        const need = artMp(sel.art.id, sel.art.kind, true), max = maxMpOf(l);
        info.innerHTML = `${esc(learnerName(l))}に「${esc(artName(sel.art.id, sel.art.kind))}」を<b>${lessonMonths(teacher, l)}か月</b>で教えます。枠は教わったあと残り${slotsLeft(l) - 1}。借り物のあいだの気力は${need}。${need > max ? `<div class="error">${esc(learnerName(l))}の気力の最大（${max}）では1回ぶんに足りず、戦いでは使えない見込みです。</div>` : ''}`;
      } else info.innerHTML = '';
      // 枠がいっぱいなら、教わったものを忘れて枠を空けられる
      const holder = l.troop ?? l.g;
      box.querySelector('#tForget')!.innerHTML = slotsLeft(l) <= 0 && holder.taught?.length
        ? `枠がいっぱいです。忘れて枠を空ける：${holder.taught.map((x, i) => `<button data-forget="${i}">「${esc(artName(x.id, x.kind))}」を忘れる</button>`).join(' ')}` : '';
      box.querySelectorAll<HTMLInputElement>('input[name="tArt"]').forEach((r) => { r.onchange = () => { pick = Number(r.value); render(); }; });
      box.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach((b) => {
        b.onclick = () => { const x = holder.taught![Number(b.dataset.forget)]; if (x && forgetArt(holder, x.id, x.kind)) { toast(`「${artName(x.id, x.kind)}」を忘れました`); forgot = true; render(); } };
      });
    };
    box.querySelector<HTMLSelectElement>('#tLearner')!.onchange = (e) => { li = Number((e.target as HTMLSelectElement).value); pick = -1; render(); };
    render();
    const ok = await wait;
    if (forgot) this.refresh();
    const sel = pick >= 0 ? arts[pick] : null;
    if (ok && sel && startLesson(c, teacher, learners[li], sel.art)) {
      toast(`${teacher.name.ja}が${learnerName(learners[li])}に「${artName(sel.art.id, sel.art.kind)}」を教え始めました（${lessonMonths(teacher, learners[li])}か月）`);
      this.picked.delete(teacher.id); this.picked.delete(learners[li].g.id);
      this.refresh();
    }
  }

  /** 捕らえて、まだ決めていない将を順に決める（P73）。全部決めたら next。当主は必ず決める */
  private captiveWindows(next: () => void): void {
    const c = this.c;
    const id = (c.captivePending ?? []).find((x) => captiveOf(c, x));
    if (!id) { next(); return; }
    this.captiveWindow(id, true, () => this.captiveWindows(next));
  }

  /** 捕虜を決める窓（P73）：顔・能力・縁・登用の見込み。当主は「解き放つ／処断する」だけ */
  private captiveWindow(id: string, fromBattle: boolean, done: () => void): void {
    const c = this.c, gs = c.gs, cap = captiveOf(c, id);
    if (!cap) { done(); return; }
    const g = cap.g, from = gs.factions[cap.from], cls = D.byClass[g.classId];
    const ties = g.ties.filter((t) => gs.generals[t.with]?.faction === c.player).map((t) => `${gs.generals[t.with].name.ja}（${TIE_NAME[t.kind] ?? t.kind}）`);
    const chance = recruitChance(c, cap), months = Math.max(0, gs.tick - cap.since);
    const box = document.createElement('div');
    box.className = 'result ask captive';
    box.innerHTML = `<h2 class="wrap">${cap.lord ? '敵の当主を捕らえた' : '捕虜をどうするか'}</h2>
      <div class="pf-head">${this.figure(g)}<div>
        <div class="pf-name">${esc(g.name.ja)}${cap.lord ? ' <span class="tag">当主</span>' : ''}</div>
        <div class="dim">${esc(from?.name.ja ?? '滅んだ家')}・${esc(L(cls.name))} Lv${g.level}・${g.age}歳${months ? `・捕らえて${months}か月` : ''}</div>
        <div class="small">${g.traits.length ? `特性：${g.traits.map((t) => esc(TRAIT_NAME[t] ?? t)).join('・')}` : ''}${ties.length ? `　こちらとの縁：${ties.map(esc).join('・')}` : ''}</div>
      </div></div>
      ${cap.lord
        ? `<p>当主は家臣にはできません。解き放つか、処断するかを、いま決めます。</p>`
        : `<p>登用の見込み：<b>${Math.round(chance * 100)}%</b><span class="dim small">（もとの家への忠誠・特性・こちらとの縁・当主の魅力${cap.tries ? `・断られた${cap.tries}回` : ''}で決まる）</span></p>`}
      <ul class="small">
        ${cap.lord ? '' : `<li><b>登用する</b>：家臣にする（成功すると忠誠が低めで仕える。断られると捕虜のまま、次の見込みが下がる）</li>`}
        <li><b>解き放つ</b>：${esc(from?.name.ja ?? 'もとの家')}へ帰す。名声と相手の心証が上がり、恩が残る（のちに登用しやすい）</li>
        <li><b>処断する</b>：世を去らせる。${esc(from?.name.ja ?? '相手')}と戦になり、縁のある者に仇とされ、こちらの公正・優しい武将の忠誠が下がる${cap.lord ? '。相手の家は代替わりする' : ''}</li>
        ${cap.lord ? '' : '<li><b>保留</b>：捕虜のまま置く（上の「捕虜」から、あとで決められる）</li>'}
      </ul>
      <p class="cbtns">${cap.lord ? '' : '<button class="primary" data-a="recruit">登用する</button> '}<button data-a="release">解き放つ</button> <button data-a="execute">処断する</button>${cap.lord ? '' : ' <button data-a="hold">保留</button>'}</p>`;
    this.frame().querySelector('.result.ask')?.remove();
    this.frame().appendChild(box);
    const finish = (msg: string): void => { box.remove(); if (msg) toast(msg); this.refresh(); done(); };
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = async () => {
        const a = b.dataset.a;
        if (a === 'recruit') finish(recruitCaptive(c, id) ? `${g.name.ja}が家臣になりました` : `${g.name.ja}は仕えることを断りました（捕虜のまま）`);
        else if (a === 'release') finish(releaseCaptive(c, id) ? `${g.name.ja}を解き放ちました` : '');
        else if (a === 'execute') {
          box.style.display = 'none';
          const sure = await confirmBox(this.frame(), { title: `${esc(g.name.ja)}を処断する`, body: `<p>${esc(g.name.ja)}は世を去ります。戻せません。</p>`, ok: '処断する', cancel: 'やめる', danger: true });
          if (sure && executeCaptive(c, id)) finish(`${g.name.ja}を処断しました`);
          else { box.style.display = ''; this.frame().appendChild(box); }
        } else { c.captivePending = (c.captivePending ?? []).filter((x) => x !== id); finish(fromBattle ? `${g.name.ja}を捕虜のまま置きます` : ''); }
      };
    });
  }

  /** 捕虜の一覧（P73）：自分が捕らえている将（決める）と、よその家に捕まっている自分の将（身代金） */
  private captiveList(): void {
    const c = this.c, gs = c.gs, me = gs.factions[c.player];
    const mine = myCaptives(c), lost = myCaptured(c);
    const row1 = (x: ReturnType<typeof myCaptives>[number]): string => `<li>${this.figure(x.g)}<span><b>${esc(x.g.name.ja)}</b> <span class="dim">${esc(gs.factions[x.from]?.name.ja ?? '滅んだ家')}・Lv${x.g.level}・${Math.max(0, gs.tick - x.since)}か月・登用の見込み${Math.round(recruitChance(c, x) * 100)}%</span></span> <button data-cap="${x.g.id}">決める</button></li>`;
    const row2 = (x: ReturnType<typeof myCaptives>[number]): string => { const cost = ransomCost(x); return `<li>${this.figure(x.g)}<span><b>${esc(x.g.name.ja)}</b> <span class="dim">${esc(gs.factions[x.by]?.name.ja ?? '')}に捕まっている・${esc(gs.provinces[x.prov]?.name.ja ?? '')}・${Math.max(0, gs.tick - x.since)}か月</span></span> <button data-ransom="${x.g.id}" ${me && me.supply >= cost ? '' : 'disabled'}>身代金 兵糧${cost}</button></li>`; };
    const box = document.createElement('div');
    box.className = 'result ask captives';
    box.innerHTML = `<h2>捕虜</h2>
      <h4>捕らえている将（${mine.length}人）</h4>${mine.length ? `<ul class="caplist">${mine.map(row1).join('')}</ul>` : '<p class="dim small">いません</p>'}
      <h4>捕まっている自分の将（${lost.length}人）</h4>${lost.length ? `<ul class="caplist">${lost.map(row2).join('')}</ul><p class="dim small">その領を攻め取れば解き放たれます。毎月まれに自分で逃げ帰ります。</p>` : '<p class="dim small">いません</p>'}
      <p class="cbtns"><button class="primary" data-a="ok">閉じる</button></p>`;
    this.frame().querySelector('.result.ask')?.remove();
    this.frame().appendChild(box);
    box.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => box.remove();
    box.querySelectorAll<HTMLButtonElement>('[data-cap]').forEach((b) => { b.onclick = () => { box.remove(); this.captiveWindow(b.dataset.cap!, false, () => this.captiveList()); }; });
    box.querySelectorAll<HTMLButtonElement>('[data-ransom]').forEach((b) => {
      b.onclick = () => { const x = captiveOf(c, b.dataset.ransom!); if (x && ransomCaptive(c, x.g.id)) { toast(`${x.g.name.ja}を取り戻しました`); box.remove(); this.refresh(); if (myCaptives(c).length || myCaptured(c).length) this.captiveList(); } };
    });
  }

  /** 采配バー（P45）：右端が最大の采配。兵ごとの区切りに、その兵が使う采配。横に「采配 使用／最大（残り）」 */
  private commandBar(g: GGeneral): string {
    const max = Math.max(1, g.command), used = troopLoad(g);
    const segs = g.troops.map((t, i) => {
      const cost = D.byUnit[t.unitId].cost, name = t.name ?? L(D.byUnit[t.unitId].name);
      const w = Math.min(100, (cost / max) * 100);
      // 細い区切りには数を書かない（兵の札に「采◯」を添えている）
      return `<span class="seg s${i % 2}" style="width:${w.toFixed(2)}%" title="${esc(`${name}：采配${cost}`)}">${w >= 9 ? cost : ''}</span>`;
    }).join('');
    return `<div class="cbar" data-tip="${esc(commandTip(used, g.command, g.commandRange))}"><div class="cbar-track">${segs}</div><span class="cbar-num">采配 ${used}／${g.command}<span class="dim">（残り${Math.max(0, g.command - used)}）</span></span></div>`;
  }

  /** 徴兵の選択の横：必要な采配と兵糧、雇ったあとの残りの采配（P51） */
  private recruitInfo(g: GGeneral, unitId: string): string {
    const c = this.c, f = c.gs.factions[g.faction], u = D.byUnit[unitId];
    if (!u || !f) return '';
    const left = g.command - troopLoad(g);
    return `<span data-tip="${esc(unitTip(unitId))}">必要な采配<b>${u.cost}</b>（残り${left}→${left - u.cost}）・兵糧<b>${recruitCostFor(c, g, unitId)}</b>${recruitTraitMult(c, g) < 1 ? '<span class="okc">（改革者で半分）</span>' : ''}</span>`;
  }

  /** 大陸全土の武将の強さ（強さの10段階の評価に使う。描くたびに1度だけ数える） */
  private strengthCache: { tick: number; at: number; list: number[] } | null = null;
  private allStrength(): number[] {
    const now = performance.now();
    if (this.strengthCache && this.strengthCache.tick === this.c.gs.tick && now - this.strengthCache.at < 500) return this.strengthCache.list;
    const list = Object.values(this.c.gs.generals).filter((x) => x.faction).map(strengthOf);
    this.strengthCache = { tick: this.c.gs.tick, at: now, list };
    return list;
  }

  /** 領の人口などの行：偵察度で見える量が変わる */
  private provStats(prov: number, tier: ScoutTier): string {
    const p = this.c.gs.provinces[prov], sea = p.coastal ? ' 海沿い' : '';
    if (tier === 'full') return `人口${Math.round(p.pop)} 収入${Math.round(p.income)} 城${Math.round(p.fort * 100)}% 不穏${Math.round(p.unrest * 100)}%${sea}`;
    if (tier === 'names') return `人口${approx(p.pop)} 収入${approx(p.income)} 城${Math.round(p.fort * 10) * 10}%前後${sea}`;
    if (tier === 'rough') return `城は${p.fort >= 0.6 ? '固い' : p.fort >= 0.3 ? 'ふつう' : '弱い'}らしい${sea}`;
    return `様子が分からない${sea}`;
  }

  /** 領で雇える兵種（P37）：自分の領は雇える兵種（新しい兵種は2倍）、よく分かっている他国の領は、奪えば新しく雇える兵種 */
  private recruitLine(prov: number, own: boolean, tier: ScoutTier): string {
    const c = this.c, me = c.gs.factions[c.player];
    if (!me) return '';
    const ids = Object.keys(provinceRecruit(c, prov)).filter((u) => D.byUnit[u]);
    const name = (u: string): string => esc(L(D.byUnit[u].name));
    if (own) {
      const fresh = ids.filter((u) => !isNativeUnit(me, u));
      return `<div class="small">この領で雇える兵種：${ids.filter((u) => isNativeUnit(me, u)).map(name).join('・') || 'なし'}${fresh.length ? `　<span class="okc">新しい兵種（兵糧2倍）：${fresh.map(name).join('・')}</span>` : ''}</div>`;
    }
    if (tier !== 'full') return '';
    const gain = ids.filter((u) => !isNativeUnit(me, u) && !Object.values(c.gs.provinces).some((q) => q.owner === me.id && u in provinceRecruit(c, q.id)));
    return gain.length ? `<div class="small"><span class="okc">奪えば雇える新しい兵種：${gain.map(name).join('・')}</span></div>` : '';
  }

  /** 偵察度の欄：いまの偵察度と、偵察させるボタン（武将を選ぶ） */
  private scoutHtml(prov: number): string {
    const c = this.c, v = Math.round(scoutOf(c, prov)), tier = scoutTier(c, prov);
    const TIER = { full: 'すべて分かる', names: '武将の名と兵の数まで', rough: 'おおまかにだけ', none: 'ほとんど分からない' } as const;
    const sent = (c.scoutMissions ?? []).find((m) => m.prov === prov);
    const cands = Object.values(c.gs.generals).filter((g) => g.faction === c.player && !scoutProblem(c, g, prov))
      .sort((a, b) => missionGain(b) - missionGain(a) || a.id.localeCompare(b.id));
    const opts = cands.map((g) => `<option value="${g.id}">${esc(g.name.ja)}（+${missionGain(g)}）</option>`).join('');
    return `<div class="card scout"><div><b>偵察度 ${v}</b> <span class="dim small">${TIER[tier]}</span></div>
      <div class="dim small">隣の領は毎月上がり、離れた領は少しずつ薄れます。偵察させた武将は、その月は行動済みになります。相国を任じると、まわりの領が毎月上がります。</div>
      ${sent ? `<div class="small">今月は${esc(c.gs.generals[sent.gid]?.name.ja ?? '')}が偵察に出ています（月の終わりに上がる）</div>`
        : opts ? `<div class="rec"><select id="scoutWho">${opts}</select><button id="scoutGo">偵察させる</button></div>` : '<div class="dim small">偵察に出せる武将がいません</div>'}</div>`;
  }

  /** 偵察度が低いときの、武将の欄 */
  private hiddenGensHtml(gens: GGeneral[], tier: ScoutTier): string {
    if (tier === 'names') {
      return gens.map((g) => `<div class="gen hidden"><span><b>${esc(g.name.ja)}</b> Lv${g.level} <span class="dim">兵${g.troops.length}隊（兵種とレベルは分からない）</span></span></div>`).join('')
        || '<div class="dim">武将はいないらしい。守備兵が守る</div>';
    }
    if (tier === 'rough') return `<div class="dim">武将：${roughCount(gens.length)}　兵：${roughCount(gens.reduce((s, g) => s + g.troops.length, 0))}（偵察すると分かる）</div>`;
    return '<div class="dim">武将や兵のようすは分からない（偵察すると分かる）</div>';
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
    // 同盟・停戦・加勢・親善は、使者と土産を選ぶ窓を開く（受けてもらえるかの見込みは窓の中で出す）
    const envoy = (kind: DipKind, label: string, enemy?: number) => `<button data-envoy="${kind}" data-to="${other}" ${enemy !== undefined ? `data-enemy="${enemy}"` : ''}>${label}</button>`;
    let buttons = '';
    if (rel === 'neutral') buttons = envoy('ally', '同盟を申し込む') + btn('war', '戦を仕掛ける', null);
    else if (rel === 'war') buttons = envoy('truce', '停戦を申し込む');
    else if (rel === 'ally') {
      // 味方には、今戦っている相手への加勢を頼める
      for (const e of playerEnemies(c)) {
        if (e === other || callProblem(c, other, e) === 'すでに戦っています') continue;
        buttons += envoy('call', `${esc(c.gs.factions[e].name.ja)}への加勢を頼む`, e);
      }
      if (c.gs.alliances.some(([x, y]) => (x === me && y === other) || (x === other && y === me))) buttons += btn('break', '同盟を破る', null);
    }
    buttons += envoy('goodwill', '親善の使者を送る');
    return `<div class="dip"><span class="dim">外交（相手の心証 ${opinion}）</span>${buttons}</div>`;
  }

  /**
   * 外交の窓（P34）：相手のようす（関係・心証・力の比べ）、使者（外交の能力で心証に上乗せ）と土産（兵糧）を選び、
   * 選ぶたびに見込み（申し込めるか・受けてもらえるか・心証がいくつになるか）を書き換える。申し込むと使者はその月行動済み
   */
  private async openEnvoy(kind: DipKind, other: number, enemy?: number): Promise<void> {
    const c = this.c, gs = c.gs, me = gs.factions[c.player], f = gs.factions[other];
    if (!me || !f) return;
    const TEXT: Record<DipKind, [string, string]> = {
      ally: ['同盟を申し込む', '結べば互いに攻め合えなくなり、加勢を頼み合えます。受けてもらえるかは、相手の心証しだいです。'],
      truce: ['停戦を申し込む', `結べば${S.diplomacy.truceMonths}か月のあいだ互いに攻め合えなくなります。相手が大きく優勢だと受けませんが、使者と土産で基準がゆるみます。`],
      call: ['加勢を頼む', `${enemy !== undefined ? esc(gs.factions[enemy]?.name.ja ?? '') : ''}との戦に、この味方を引き入れます。受けてもらえるかは、相手の心証しだいです。`],
      goodwill: ['親善の使者を送る', '申し込みはせず、使者と土産で相手の心証を上げます。'],
    };
    const gens = Object.values(gs.generals).filter((g) => g.faction === c.player && !envoyProblem(c, g))
      .sort((a, b) => envoyBonus(b) - envoyBonus(a) || a.id.localeCompare(b.id));
    const rel = REL_NAME[relation(c, c.player, other)];
    const mine = Math.round(factionStrength(c, c.player)), theirs = Math.round(factionStrength(c, other));
    const body = `<div class="envoy">
      <table class="pf-stats"><tr><th>相手</th><td>${factionBadge(f.name.ja, f.color)}（${rel}）</td></tr>
        <tr><th>心証</th><td>${Math.round(f.opinions[c.player] ?? 0)}</td></tr>
        <tr><th>力の比べ</th><td>こちら${mine}／相手${theirs}</td></tr></table>
      <p>${TEXT[kind][1]}</p>
      ${gens.length ? `<label>使者 <select id="envWho">${gens.map((g) => `<option value="${g.id}">${esc(g.name.ja)}（外交${g.ab[2]}・心証${envoyBonus(g) >= 0 ? '+' : ''}${envoyBonus(g)}）</option>`).join('')}</select></label>` : '<p class="dim">使者に出せる武将がいません（今月まだ動いていない武将が要ります）</p>'}
      <label>土産 <select id="envGift">${S.envoy.gifts.map((n) => `<option value="${n}" ${n > me.supply ? 'disabled' : ''}>${n ? `兵糧${n}（心証+${giftBonus(n)}）` : 'なし'}</option>`).join('')}</select></label>
      <div id="envPlan" class="small"></div>
      <p class="dim small">使者はその月は行動済みになります。申し込むと、受けてもらえなくても、使者と土産は使い、上がった心証は残ります。</p></div>`;
    const pending = confirmBox(this.frame(), { title: `${esc(f.name.ja)}へ：${TEXT[kind][0]}`, banner: sceneUrl('envoy', gs.variant), body, ok: kind === 'goodwill' ? '使者を送る' : '申し込む' });
    const box = this.frame().querySelector<HTMLElement>('.confirm')!;
    const who = box.querySelector<HTMLSelectElement>('#envWho'), gift = box.querySelector<HTMLSelectElement>('#envGift')!;
    const okBtn = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
    const update = (): void => {
      const plan = envoyPlan(c, kind, other, who?.value ?? '', Number(gift.value), enemy);
      okBtn.disabled = !!plan.blocked;
      box.querySelector('#envPlan')!.innerHTML = plan.blocked ? `<b class="ng">申し込めません：${esc(plan.blocked)}</b>`
        : `心証 ${plan.opinionNow} → <b>${plan.opinionAfter}</b>（+${plan.bonus}）<br>${kind === 'goodwill' ? '心証が上がります' : plan.refused ? `<b class="ng">断られる見込み：${esc(plan.refused)}</b>` : '<b class="okc">受けてもらえる見込み</b>'}`;
    };
    who?.addEventListener('change', update); gift.addEventListener('change', update);
    update();
    if (!(await pending)) return;
    const r = sendEnvoy(c, kind, other, who?.value ?? '', Number(gift.value), enemy);
    if (r.sent) toast(kind === 'goodwill' ? '使者を送りました' : r.accepted ? '受けてもらえました' : '断られました');
    this.refresh();
  }

  /** 史実の目標（P76）：史実では自分の家が攻め込む頃。期限までに相手の領を1つ取れば、ほうび（取らなくても罰は無い） */
  private goalsHtml(): string {
    const c = this.c;
    return (c.history.goals ?? []).map((g) => `<div class="card status histgoal">
        <div><b>史実の目標：</b>${esc(g.name)}　<span class="small">${esc(g.targetName)}の領を1つ取る（あと${Math.max(0, g.until - c.gs.tick)}か月）</span></div>
        <div class="small dim">史実では、この頃${esc(g.targetName)}へ攻め込む。果たせば名声+${S.histGoal.prestige}・兵糧+${S.histGoal.supply}（果たさなくても罰は無い）</div>
      </div>`).join('');
  }
  /** 史実の合戦（P75）：自分の家が出る合戦。戦うか、見送るか（選ばずに月が過ぎると見送る） */
  private histBattlesHtml(): string {
    const c = this.c, gs = c.gs;
    return (c.history.battles ?? []).map((hb) => {
      const foe = gs.factions[hb.foe], s = histBattleSetup(c, hb);
      const names = (ids: string[]) => ids.map((id) => gs.generals[id]?.name.ja).filter(Boolean).join('・');
      const mine = s ? (s.mySide === 0 ? s.atk : s.def) : [], theirs = s ? (s.mySide === 0 ? s.def : s.atk) : [];
      return `<div class="card status histbattle">
        <div><b>史実の合戦：</b>${esc(hb.name)}（${esc(foe?.name.ja ?? '')}・${esc(gs.provinces[hb.prov]?.name.ja ?? '')}）<span class="dim small">　今月のうちに選ぶ（選ばないと見送る）</span></div>
        ${s ? `<div class="small">自分：${esc(names(mine))}　相手：${esc(names(theirs))}（${s.mySide === 0 ? '攻め手' : '守り手'}）</div>` : '<div class="small dim">いま戦える将がいません</div>'}
        <div class="dip"><button data-hbattle="${esc(hb.ev)}" data-c="fight" ${s ? '' : 'disabled'}>戦う</button><button data-hbattle="${esc(hb.ev)}" data-c="skip">見送る</button></div>
      </div>`;
    }).join('');
  }
  /** 兆し（P74）：自分の家の人が、史実で非業の死を遂げる出来事の前触れ。備える（兵糧・その月は行動済み）か、史実のままにする */
  private omensHtml(): string {
    const c = this.c, now = c.gs.year * 12 + c.gs.month, me = c.gs.factions[c.player];
    return (c.history.omens ?? []).filter((o) => c.gs.generals[o.gid]).map((o) => {
      const g = c.gs.generals[o.gid], left = Math.max(0, o.due - now);
      const chosen = o.choice === 'guard' ? `<b>備えている</b>（${Math.round(S.omen.avert * 100)}%で難を逃れる）` : o.choice === 'accept' ? '<b>史実のままにする</b>' : '';
      return `<div class="card status omen">
        ${this.figure(g)}<div><b>兆し：</b>${esc(o.name)}に${esc(OMEN_SIGN[o.cause] ?? '不穏な兆しがある')}。<span class="dim small">史実では、あと${left}か月ほどで${esc(CAUSE_NAME[o.cause] ?? o.cause)}により世を去る。</span>
        ${chosen ? `<div class="small">${chosen}</div>` : `<div class="dip"><button data-omen="${esc(o.ev)}" data-gid="${esc(o.gid)}" data-c="guard" ${me && me.supply >= S.omen.cost ? '' : 'disabled title="兵糧が足りません"'}>備える（兵糧${S.omen.cost}）</button><button data-omen="${esc(o.ev)}" data-gid="${esc(o.gid)}" data-c="accept">史実のままにする</button></div>
        <div class="dim small">選ばずに月が過ぎると、備えたことにして（兵糧なし）${Math.round(S.omen.avert * 100)}%で難を逃れる。</div>`}</div>
      </div>`;
    }).join('');
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
    return this.goalsHtml() + this.histBattlesHtml() + this.omensHtml() + this.choicesHtml() + c.offers.filter((o) => c.gs.factions[o.from]).map((o) => `<div class="card status">
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
      ${t.level >= S.officer.minTroopLevel ? `<button data-raise="1" ${raise ? `disabled title="${esc(raise)}"` : ''}>武将にする（兵糧${raiseCost(t.level)}）</button>${why(raise)}` : ''}
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

  /** 本拠と相国の膝元の説明（P77）：その領にかかる効き目 */
  private seatHtml(prov: number): string {
    const c = this.c, gs = c.gs, p = gs.provinces[prov], owner = gs.factions[p.owner];
    const out: string[] = [];
    if (owner && owner.capital === prov) out.push(`本拠：この領の収入+${Math.round(S.capitalBonus.incomeBonus * 100)}%・守備兵が強い（Lv+${S.garrison.levelCapital}）・ここで雇う兵はLv+${S.capitalBonus.recruitLevel}`);
    const ch = chancellorOf(c), fx = officeFx(c);
    if (ch && fx && p.owner === c.player && nearChancellor(c, prov)) out.push(`相国（${ch.name.ja}）の膝元：この領の収入がさらに+${Math.round(fx.localIncome * 100)}%、ここで訓練する将の経験値がさらに+${Math.round(fx.localTrain * 100)}%`);
    return out.map((t) => `<div class="small seatfx">${esc(t)}</div>`).join('');
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
    // 滅亡の窓（P60）：ほかの窓が閉じてから、滅んだ家を1つずつ（ずっとオートの間は出さない）
    const busyWin = (): boolean => !!this.frame().querySelector('.result, .confirm, .reel-cover');
    if (c.player && c.fallen?.length && !this.autoOn && !busyWin()) {
      const fid = c.fallen.shift()!;
      window.setTimeout(() => { if (!busyWin()) this.fallWindow(fid); else (c.fallen ??= []).unshift(fid); }, 250);
    }
    // 天下統一（P57）：ほかの窓（祝い・結果・知らせ）が閉じてから、1度だけ年表の窓を出す
    else if (c.over === 'win' && c.player && !c.unified && !busyWin()) {
      c.unified = true;
      this.stopAuto();
      window.setTimeout(() => this.unifyWindow(), 300);
    }
    const me = c.player ? gs.factions[c.player] : null;
    const p = this.selected >= 0 ? gs.provinces[this.selected] : null;
    let body = '<div class="card dim">領をクリックすると情報が出ます。</div>';
    if (p) {
      const owner = gs.factions[p.owner];
      const own = !!me && p.owner === me.id;
      const gens = owner ? generalsAt(c, p.id, owner.id) : [];
      const rel = me && owner && !own ? `（${REL_NAME[relation(c, me.id, owner.id)]}）` : '';
      const picked = this.pickedHere().length;
      // 攻めるときは、ほかの領で選んだ武将も数える（複数の領から1つの領を攻める）
      const allPickedGens = this.pickedAll(), allPicked = allPickedGens.length;
      const pickedElsewhere = allPickedGens.filter((g) => g.prov !== p.id);
      // 偵察度（P33）：ほかの勢力の領は、分かっているぶんだけ見せる
      const tier: ScoutTier = own || !owner ? 'full' : scoutTier(c, p.id);
      const town = this.view.townImage(p.id);
      // 町の絵がまだ読めていなければ、少し待って描き直す（地図の絵は、あとから読み込まれる）
      if (!town && !this.townRetry) this.townRetry = window.setTimeout(() => { this.townRetry = 0; if (this.host.root.contains(this.view.canvas)) this.refresh(); }, 400);
      body = `<div class="card">
          ${town ? `<img class="town" src="${town}" alt="" draggable="false">` : ''}
          <div><b>${esc(p.name.ja)}</b> ${owner ? factionBadge(owner.name.ja, owner.color) : '<span class="dim">持ち主なし</span>'}<span class="dim">${rel}${owner?.capital === p.id ? '・本拠' : ''}</span></div>
          <div class="dim">${this.provStats(p.id, tier)}</div>
          ${this.seatHtml(p.id)}
          ${this.recruitLine(p.id, own, tier)}
          ${owner && isExclave(c, p.id) ? this.exclaveHtml(p.id) : ''}
          ${this.previewHtml(p.id)}
        </div>
        ${this.siegeHtml(p.id)}${me && owner && !own ? this.diplomacyHtml(me.id, owner.id) : ''}${me && owner && !own ? this.scoutHtml(p.id) : ''}
        ${own ? `<div class="actions row">
          <button id="move" ${picked ? '' : 'disabled'} class="${this.order === 'move' ? 'on' : ''}" title="自分の領づたいに行ける所まで">移動（${S.move.range}つ先まで）</button>
          <button id="attack" ${allPicked && allPicked <= MAX_GENERALS ? '' : 'disabled'} class="${this.order === 'attack' ? 'on' : ''}" title="ほかの領で選んだ武将も、攻める領に隣り合っていれば一緒に攻められます">攻める（${MAX_GENERALS}人まで）</button>
        </div>${pickedElsewhere.length ? `<div class="small">ほかの領で選んだ武将：${pickedElsewhere.map((g) => `${esc(g.name.ja)}<span class="dim">（${esc(gs.provinces[g.prov]?.name.ja ?? '')}）</span>`).join('、')}${allPicked > MAX_GENERALS ? `<span class="ng">　${MAX_GENERALS}人までです</span>` : ''}</div>` : ''}
        <div class="dim">${this.order === 'move' ? '青い領をクリックで移動（自分の領づたいに行ける所）' : this.order === 'attack' ? '赤い領をクリックで侵攻（選んだ武将のいる領のどれにも隣り合う領）' : '武将にチェックを入れて、移動か攻めるを選びます（攻めるときは、ほかの領の武将も選んでおけば一緒に攻められます）'}</div>` : ''}
        ${own && gens.some((g) => !c.moved.has(g.id)) ? `<div class="sel"><span class="dim">まとめて選ぶ</span>
          <button id="selAll">全員</button><button id="selTop">レベルの高い${MAX_GENERALS}人</button><button id="selNone" ${picked ? '' : 'disabled'}>外す</button></div>` : ''}
        <div class="gens2">${tier === 'full' ? gens.map((g) => this.generalHtml(g, own)).join('') || `<div class="dim">武将はいません。守備兵が守ります（Lv${garrisonOf(c, p.id).level}・${garrisonOf(c, p.id).troops}隊）</div>` : this.hiddenGensHtml(gens, tier)}</div>
        ${own ? this.reserveHtml(p.id) : ''}${own ? this.buildHtml(p.id) : ''}${own ? this.capitalHtml(p.id) : ''}
        ${!own && tier === 'full' && reserveOf(c, p.id).length ? `<div class="card status">予備兵 ${reserveOf(c, p.id).length}隊（${reserveOf(c, p.id).map((t) => `<span class="nm">${esc(t.name ?? L(D.byUnit[t.unitId].name))}</span>Lv${t.level}`).join('、')}）<span class="dim small">この領を奪えば手に入ります</span></div>` : ''}
        ${owner && tier === 'full' ? woundedAt(c, p.id, owner.id).map((g) => `<div class="dim">${esc(g.name.ja)} Lv${g.level}：深手（あと${c.wounded[g.id] - gs.tick}か月は戦えない）</div>`).join('') : ''}
        ${own && me ? awayAt(c, p.id, me.id).map((g) => `<div class="dim">${esc(g.name.ja)}：諸国巡り中（あと${c.away[g.id] - gs.tick}か月）</div>`).join('') : ''}
        `;
    }
    const over = c.over ? `<div class="card status over">${bannerHtml(sceneUrl(c.over === 'win' ? 'victory' : 'defeat', gs.variant))}${c.over === 'win' ? '天下を取りました' : '自分の勢力は滅びました'}${c.chronicle?.length ? ' <button id="chronBtn">年表を見る</button>' : ''}</div>` : '';
    this.host.root.querySelector('#panel')!.innerHTML = `
      <div class="turn" style="background:${seasonBand(me ? me.color : null, gs.month)}">${this.date()} <small>${me ? `${esc(me.name.ja)}　兵糧${me.supply}／${supplyCap(me)}（+${me.income}／月）　領${provincesOf(c, me.id).length}` : '観戦'}</small></div>
      <div class="foot">
        <button id="next" class="primary" ${c.over || this.autoOn ? 'disabled' : ''}>月を進める</button>
        ${c.player ? `<span class="autogrp"><button id="autoMonth" class="${this.autoOn ? 'on autoing' : ''}" ${c.over ? 'disabled' : ''} data-tip="押すと、自分の家もおまかせで動かして月を進めます（兵を雇う・兵糧に余りがあれば普請・弱い隣を攻める・将を前線へ移す・残りは訓練）。オート中は、どこかを押すと手動に戻ります。">${this.autoOn ? `オート中…${this.autoLeft > 0 ? `あと${this.autoLeft}か月` : ''}（押すと手動）` : 'オート'}</button><select id="autoLen" title="オートで進める長さ" ${this.autoOn ? 'disabled' : ''}>${[[1, '1か月'], [2, '2か月'], [3, '3か月'], [0, 'ずっと']].map(([v, n]) => `<option value="${v}" ${this.autoLen === v ? 'selected' : ''}>${n}</option>`).join('')}</select></span>` : ''}
        ${c.player ? '' : '<button id="run">12か月進める</button>'}
        <span class="dim">勢力${Object.keys(gs.factions).length}・${c.months}か月・<span class="${c.difficulty === 'oni' ? 'oni' : ''}" title="難しさ">${S.difficulty[c.difficulty].name}</span></span>
        ${c.player && (myCaptives(c).length || myCaptured(c).length) ? `<button id="captiveBtn" data-tip="捕らえている敵の将と、捕まっている自分の将。押すと一覧（登用・解き放つ・処断・身代金）">捕虜 ${myCaptives(c).length}人${myCaptured(c).length ? `・捕まった将 ${myCaptured(c).length}人` : ''}</button>` : ''}
        ${c.player ? `<button id="planBtn" data-tip="味方をおまかせで戦わせるとき（おまかせ・観戦・1か月オート）の動き方。押すと切り替えられます">方針：${esc(planLabel(getPlan()))}</button>` : ''}
        ${c.player ? `<button id="reelBtn" title="月を進めたあと、ほかの国どうしの戦いを1つずつ見せるか">他国の戦い：${reelOn() ? '見る' : '見ない'}</button>` : ''}
        <button id="saves">セーブ</button>
        <button id="bgmBtn" title="曲の音量（押すたびに切・小・中・大）">曲：${BGM_LEVEL_NAME[bgmLevel()]}</button>
        <button id="exit">やめる</button>
      </div>
      ${me ? `<div class="dim small">特色：${traitsOf(me).map((t) => `${t.name}（${t.text}）`).join('、')}${this.itemsText()}</div>` : ''}
      ${this.offersHtml()}${over}${body}`;
    const root = this.host.root;
    // 欄を送って項目を見せるとき（scrollIntoView）、上に貼りつくボタンの列の下に隠れないように
    const panel = root.querySelector<HTMLElement>('#panel')!, foot = panel.querySelector<HTMLElement>('.foot');
    if (foot) panel.style.scrollPaddingTop = `${foot.offsetHeight}px`;
    root.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((cb) => {
      cb.onchange = () => { if (cb.checked) this.picked.add(cb.dataset.pick!); else this.picked.delete(cb.dataset.pick!); this.refresh(); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-recruit]').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        const sel = root.querySelector<HTMLSelectElement>(`[data-unit="${b.dataset.recruit}"]`);
        if (!sel) return;
        this.lastUnit[b.dataset.recruit!] = this.lastUnitAny = sel.value;
        if (recruit(c, b.dataset.recruit!, sel.value)) this.refresh();
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-autorec]').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        const got = autoRecruit(c, b.dataset.autorec!);
        if (!got.length) { toast('雇える兵がいません（采配・兵糧・兵の数を確かめてください）'); return; }
        const n = new Map<string, number>();
        for (const u of got) n.set(u, (n.get(u) ?? 0) + 1);
        toast(`${gs.generals[b.dataset.autorec!].name.ja}が雇った：${[...n].map(([u, k]) => `${L(D.byUnit[u].name)}${k > 1 ? `×${k}` : ''}（${ROLE_NAME[unitRole(u)]}）`).join('、')}`);
        this.refresh();
      };
    });
    // 徴兵の選択を変えたら、必要な采配と兵糧を書き換える（P51）。選んだ兵種は覚えておく
    root.querySelectorAll<HTMLSelectElement>('select[data-unit]').forEach((sel) => {
      sel.onchange = () => {
        this.lastUnit[sel.dataset.unit!] = this.lastUnitAny = sel.value;
        const g = gs.generals[sel.dataset.unit!], box = root.querySelector<HTMLElement>(`[data-recinfo="${sel.dataset.unit}"]`);
        if (g && box) box.innerHTML = this.recruitInfo(g, sel.value);
      };
    });
    // 役職・兵種を進める（P52）：比べ表と「戻れない」の警告を出して確かめ、進めたら大げさに祝う
    root.querySelectorAll<HTMLButtonElement>('[data-promo-ask]').forEach((b) => {
      b.onclick = async () => {
        const g = gs.generals[b.dataset.promoAsk!], to = b.dataset.to!;
        if (!g) return;
        const from = L(D.byClass[g.classId].name), next = L(D.byClass[to].name), rows = generalChange(g, to);
        // 新しく覚える技・軍略の説明と気力のバー（P85）。祝いの窓では「覚えた」と言い換える
        const arts = generalArtsHtml(g, to), learnt = generalArtsHtml(g, to, '新しく覚えた技・軍略');
        const ok = await confirmBox(this.frame(), {
          title: `${esc(g.name.ja)}を ${esc(next)} に昇進させる`, banner: sceneUrl('setup', gs.variant),
          body: `<p><b>${esc(from)}</b> → <b>${esc(next)}</b></p><p class="warn">⚠ 昇進すると、元の役職には戻れません。</p>${changeTable(rows)}${arts}<p class="small">${esc(classTip(to)).replace(/\n/g, '<br>')}</p>`,
          ok: '昇進させる', cancel: 'やめる', btnTop: true,
        });
        if (!ok || !promoteGeneral(g, to)) return;
        this.refresh();
        this.celebrateChange(`${g.name.ja}、${next}に昇進！`, `${from} → ${next}`, rows, null, learnt);
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-up-ask]').forEach((b) => {
      b.onclick = async () => {
        const g = gs.generals[b.dataset.upAsk!], i = Number(b.dataset.i), to = b.dataset.to!, t = g?.troops[i];
        if (!g || !t) return;
        const from = L(D.byUnit[t.unitId].name), next = L(D.byUnit[to].name), rows = troopChange(t, to), name = t.name ?? from;
        const arts = troopArtsHtml(t, to), learnt = troopArtsHtml(t, to, '新しく覚えた技・軍略');
        const rule = D.byUnit[t.unitId].promote.find((p) => p.to === to);
        const useItem = rule?.item ? `昇進の品「${esc(D.items[rule.item]?.jp ?? rule.item)}」を1つ使います。` : rule?.lv && t.level < rule.lv ? '昇進の品を1つ使います（レベルが足りないため）。' : '';
        const ok = await confirmBox(this.frame(), {
          title: `${esc(name)}を ${esc(next)} に進める`, banner: sceneUrl('setup', gs.variant),
          body: `<p>${this.icon(t.unitId)}<b>${esc(from)}</b> → ${this.icon(to)}<b>${esc(next)}</b>（${esc(g.name.ja)}の兵・Lv${t.level}）</p><p class="warn">⚠ 進めると、元の兵種には戻れません。${useItem}</p>${changeTable(rows)}${arts}<p class="small">${esc(unitTip(to)).replace(/\n/g, '<br>')}</p>`,
          ok: '進める', cancel: 'やめる', btnTop: true,
        });
        if (!ok || !upgradeTroop(c, g.id, i, to)) return;
        this.refresh();
        this.celebrateChange(`${name}、${next}に昇格！`, `${from} → ${next}（${g.name.ja}の兵）`, rows, artUrl(`unit/${gs.variant}/${to}`) ?? null, learnt);
      };
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
    root.querySelectorAll<HTMLButtonElement>('[data-teach]').forEach((b) => {
      b.onclick = () => { const g = gs.generals[b.dataset.teach!]; if (g) void this.teachWindow(g); };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-abdicate]').forEach((b) => {
      b.onclick = async () => {
        const g = gs.generals[b.dataset.abdicate!], me = gs.factions[c.player], old = me ? gs.generals[me.lordId] : undefined;
        if (!g || !me) return;
        const loss = abdicateLoyaltyLoss(c, g);
        const ok = await confirmBox(this.frame(), {
          title: `${esc(g.name.ja)}に当主を譲る`,
          body: `<p>${old ? `当主の<b>${esc(old.name.ja)}</b>は隠居して、武将として残ります（当主の役職は、能力に合った並の役職に戻ります）。` : ''}<b>${esc(g.name.ja)}</b>が新しい当主になり、国に合った当主の役職と、采配の当主の上乗せを受け継ぎます。</p>
            <ul class="small">
              <li>この月は、国じゅうの武将が行動済みになります（守りには出られます）。</li>
              <li>${loss.length ? `${esc(g.name.ja)}より名声の高い武将の忠誠が下がります：${loss.map((x) => `${esc(x.g.name.ja)} −${x.drop}`).join('、')}${g.role === 'heir' ? '（跡継ぎに譲るので、下がり方は半分）' : ''}` : '忠誠が下がる武将はいません。'}</li>
              <li>一度譲ると、${S.abdicate.cooldown}か月は譲れません。戻せません。</li>
            </ul>`,
          ok: '当主を譲る', danger: true,
        });
        if (ok && abdicate(c, g.id)) { toast(`${g.name.ja}が当主になりました（${L(D.byClass[g.classId].name)}）`); this.picked.clear(); this.refresh(); }
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-chancellor]').forEach((b) => {
      b.onclick = async () => {
        const g = gs.generals[b.dataset.chancellor!];
        if (!g) return;
        // 解くのはすぐ。任じる前に、効き目とできなくなることを見せる（P77）
        if (c.offices?.chancellor !== g.id) {
          const prev = c.offices?.chancellor ? gs.generals[c.offices.chancellor] : undefined;
          const ok = await confirmBox(this.frame(), {
            title: `${esc(g.name.ja)}を相国に任じる`,
            body: `<p>相国は家の政を預かります（1人だけ。毎月替えられます）。どの領にいても効きます。</p>
              <ul class="small">${officeLines(c, g).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
              <p><b>相国になると、できなくなること</b></p>
              <ul class="small"><li>攻めに出られない（守り・移動はできる）</li><li>訓練できない（ずっと訓練も外れる）</li><li>直伝で教えられない</li></ul>
              ${prev ? `<p class="small dim">いまの相国の${esc(prev.name.ja)}は、相国を外れます。</p>` : ''}`,
            ok: '相国に任じる',
          });
          if (!ok) return;
        }
        const on = appointChancellor(c, g.id);
        if (!on && c.offices?.chancellor !== g.id && (c.lessons ?? []).some((x) => x.teacher === g.id)) { toast('直伝で教えている最中なので、相国には任じられません'); return; }
        toast(on ? `${g.name.ja}を相国に任じました` : '相国を解きました'); this.refresh();
      };
    });
    const scoutGo = root.querySelector<HTMLButtonElement>('#scoutGo');
    if (scoutGo && p) scoutGo.onclick = () => {
      const who = root.querySelector<HTMLSelectElement>('#scoutWho')?.value;
      if (who && sendScout(c, who, p.id)) { this.picked.delete(who); toast(`${gs.generals[who].name.ja}を${p.name.ja}の偵察に出しました（月の終わりに上がります）`); this.refresh(); }
    };
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
        this.askName('兵を武将にする', t.name ?? '', `新しい武将の名前を決めてください。兵糧を${raiseCost(t.level)}使います。この隊は無くなり、同じ領にLv${t.level}の武将が加わります（兵は連れていません）。兵のときの技・特技・軍略はすべてそのまま使え（弓の兵なら弓で戦う将に）、得意地形も兵種のまま、役職は兵種に近い系統になります。将としての特性を1つ得ます。`, (n) => {
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
    root.querySelectorAll<HTMLButtonElement>('[data-hbattle]').forEach((b) => {
      b.onclick = async () => {
        const hb = (c.history.battles ?? []).find((x) => x.ev === b.dataset.hbattle);
        if (!hb) return;
        const fight = b.dataset.c === 'fight';
        const s = fight ? histBattleSetup(c, hb) : null;
        const names = (ids: string[]) => ids.map((id) => gs.generals[id]?.name.ja).filter(Boolean).map(esc).join('・');
        const ok = await confirmBox(this.frame(), {
          title: `${esc(hb.name)}を${fight ? '戦う' : '見送る'}`, banner: sceneUrl('setup', gs.variant),
          body: fight && s
            ? `${hb.deploy ? `<p class="small">${esc(hb.deploy)}</p>` : ''}<p>${esc(gs.provinces[hb.prov]?.name.ja ?? '')}の戦場で、${s.mySide === 0 ? '攻め手' : '守り手'}として戦います。</p><p class="small">自分：${names(s.mySide === 0 ? s.atk : s.def)}<br>相手：${names(s.mySide === 0 ? s.def : s.atk)}</p><p class="small dim">勝てば名声+${S.histBattle.prestige}、相手の軍が減ります。負ければ名声−${S.histBattle.prestigeLoss}。史実と逆の勝ち負けなら、出来事の残りは起きず、史実と違う道になります。</p>`
            : `<p>史実どおり出来事が起きます（自分の家の損耗は起きません）。</p>`,
          ok: fight ? '戦う' : '見送る',
        });
        if (!ok) return;
        if (!fight) { skipHistoricBattle(c, hb.ev); toast(`${hb.name}を見送りました`); this.refresh(); return; }
        const made = historicBattle(c, hb.ev);
        if (!made) { toast('いま戦える将がいません'); return; }
        void busy('戦場を用意しています…', () => this.host.openBattle(made.st, new Set([made.mySide]), (st) => endHistoricBattle(c, hb.ev, st, made.mySide), { label: '戦略マップへ', fn: () => this.mount() }, false, made.mySide));
      };
    });    root.querySelectorAll<HTMLButtonElement>('[data-omen]').forEach((b) => {
      b.onclick = async () => {
        const o = (c.history.omens ?? []).find((x) => x.ev === b.dataset.omen && x.gid === b.dataset.gid);
        if (!o) return;
        const guard = b.dataset.c === 'guard';
        const ok = await confirmBox(this.frame(), {
          title: guard ? `${esc(o.name)}の身に備える` : `${esc(o.name)}の運命を史実に任せる`, banner: sceneUrl('envoy', gs.variant),
          body: `<p class="small">${esc(o.text)}</p><p>${guard
            ? `兵糧${S.omen.cost}を払い、${esc(o.name)}はこの月は行動済みになります。${Math.round(S.omen.avert * 100)}%で難を逃れ、史実と違う道になります（年表に「異」）。`
            : `史実どおり、${esc(o.name)}は${esc(CAUSE_NAME[o.cause] ?? o.cause)}で世を去ります。`}</p>`,
          ok: guard ? '備える' : '史実のままにする', danger: !guard,
        });
        if (ok && chooseOmen(c, o.ev, o.gid, guard ? 'guard' : 'accept')) { toast(guard ? `${o.name}の身に備えました` : '史実のままにします'); this.picked.delete(o.gid); this.refresh(); }
      };
    });    root.querySelectorAll<HTMLButtonElement>('[data-hchoice]').forEach((b) => {
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
    root.querySelectorAll<HTMLButtonElement>('[data-envoy]').forEach((b) => {
      b.onclick = () => { void this.openEnvoy(b.dataset.envoy as DipKind, Number(b.dataset.to), b.dataset.enemy !== undefined ? Number(b.dataset.enemy) : undefined); };
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
    on('#reelBtn', () => { setReel(!reelOn()); this.refresh(); });
    on('#planBtn', () => this.openPlan());
    on('#captiveBtn', () => this.captiveList());
    on('#chronBtn', () => { if (c.over === 'win') this.unifyWindow(); });
    on('#saves', () => { void openSaveMenu(root.querySelector<HTMLElement>('.battle')!, { current: () => snapshot(this.c), onLoad: (s) => { clearTimeout(this.watchTimer); this.runToken++; void busy('読み込んでいます…', () => this.host.loadHexSave(s)); } }); });
    on('#exit', async () => {
      const ok = await confirmBox(this.frame(), { title: '戦略をやめる', body: '<p>題の画面に戻ります。</p><p class="dim small">月が変わるたびに自動の枠へ保存しているので、「つづきから」で今月の初めから続けられます。今月に動かした分は残りません。残したいときは、先に「セーブ」で保存してください。</p>', ok: 'やめる', cancel: '続ける', danger: true });
      if (!ok) return;
      this.stopAuto(); clearTimeout(this.watchTimer); this.runToken++; void busy('戻っています…', () => this.exit());
    });
    const autoBtn = root.querySelector<HTMLButtonElement>('#autoMonth');
    if (autoBtn) autoBtn.onclick = () => {
      if (this.autoOn) { this.stopAuto(); return; }
      // 1か月なら、その月の知らせまで出す。2か月以上・ずっとは、どこかを押すまで続ける
      if (this.autoLen === 1) { autoBtn.classList.add('on'); void busy('おまかせで1か月進めています…', () => this.autoOne(true)); return; }
      this.startAuto(this.autoLen);
    };
    const autoLen = root.querySelector<HTMLSelectElement>('#autoLen');
    if (autoLen) autoLen.onchange = () => { this.autoLen = Number(autoLen.value); };
    const logEl = root.querySelector<HTMLElement>('#log')!;
    logEl.innerHTML = c.log.slice(-80).map((e) => `<div class="${e.key === 'month' ? 'sep' : ''}">${esc(logLine(e))}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}
