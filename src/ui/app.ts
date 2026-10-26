// 画面：セーブの読み込み → 編成 → 戦闘 → 結果。

import { autoBattle, nextAiActions, planUnit, stanceOf } from '../ai/ai';
import { AI, personalityLabel, personalityOf, planLabel, type AutoPlan } from '../ai/personality';
import { getPlan, planPickerHtml, wirePlanPicker } from './autoPlan';
import { apply, canAct, canMove, canWithdraw, holder, moveCells, withdraw } from '../battle/engine';
import { mapFromProvince, seatName } from '../battle/map';
import { applyBattleResult, type BattleSummary } from '../battle/result';
import { newCampaign, note, S, traitsOf, type Difficulty } from '../strategy/campaign';
import { DIFFICULTIES } from '../strategy/config';
import { startChronicle } from '../strategy/chronicle';
import { CampaignScreen } from './campaignUi';
import { restore, type HexSave } from '../persist/save';
import { anySlot, openSaveMenu, readHexSaveFile } from './saveMenu';
import { WORLDS_LEAD, worldsHtml } from './worlds';
import { createBattle, MAX_GENERALS, setAiLevel } from '../battle/setup';
import type { Action, BUnit, BattleState, Side } from '../battle/types';
import { normalizeSave, readSaveFile, SaveError, type HSave } from '../bridge/histsim';
import { applyIma, imaRealm, imaVariant, readImaFile, type ImaFile } from '../bridge/imarpg';
import { convert, generalsOf, variantOf } from '../convert/convert';
import type { GGeneral, GameStart } from '../convert/model';
import { D, L, setVariant } from '../data/db';
import type { SkillDef, TacticDef, TerrainKind, Variant } from '../data/types';
import { BAD_STATUS, BattleView, generalIndex, genColor, GOOD_STATUS, SIDE_COLOR, TERRAIN_NAME } from '../render/battleView';
import type { CrestSpec } from '../render/crest';
import { css, tint } from '../render/ink';
import { artUrl } from '../art/art';
import { bannerHtml, sceneUrl, setScene } from './scene';
import { confirmBox } from './confirm';
import { classTip, skillTip, statusEffect, tacticTip, traitTip } from './describe';
import { initTips } from './tip';
import { busy } from './busy';
import { prewarm } from '../render/strategyView';
import { NationMap } from '../render/nationMap';

import {
  canUseSkill, canUseTactic, forecastSkill, needsReload, skillCost, tacticCost, healAmount, skillTargetCells, skillVictims, tacticDamage, tacticSide,
  tacticSuccess, tacticTargetCells, tacticVictims, breachParts, breachTargets,
} from '../rules/combat';
import { reach, stepCost, unitAt } from '../rules/move';
import { statRows } from '../rules/statNotes';
import { classMod } from '../rules/growth';
import { affinityOf, agility, attackPower, basicSkill, defense, disabled, FIELD, has, intellect, moveOf, outOfCommand, skillOf, skillRange, supplyMultOf, terrainMod } from '../rules/stats';
import { AFFINITY_NAME, kindName, STATUS_NAME, T, TRAIT_NAME } from './text';
import { BattleLogView, loadLogLevel, LOG_LEVEL_NAME, saveLogLevel } from './battleLog';
import { SEASON_NAME, seasonOf, skyEffects, skyLabel } from '../battle/weather';
import { before, cues, notePath } from './battleFx';
import { initSound, play, setVolume, volume, VOLUME_NAME } from './sound';
import { BGM_LEVEL_NAME, bgm, bgmLevel, initBgm, jingle, setBgmLevel } from './bgm';

const SAMPLES: [string, string][] = [
  ['sengoku_fid5_1575', '日本の戦国 1575年'],
  ['shunju_fid5_259bc', '春秋戦国 前259年'],
  ['sangoku_fid5_212', '三国志 212年'],
  ['rome_fid3_212bc', 'ローマ 前212年'],
  ['invented_archipelago_y30', '架空の多島海 30年目'],
];
/** 難しさを選ぶ欄の中身（鬼は朱色） */
function difficultyOptions(cur: Difficulty, label: string): string {
  return DIFFICULTIES.map((d) => `<option value="${d}" ${cur === d ? 'selected' : ''} ${d === 'oni' ? 'class="oni"' : ''}>${label}：${S.difficulty[d].name}</option>`).join('');
}
/** 難しさの注意の中身（P64）。local：単独の戦い（戦略の数は効かない） */
function difficultyWarn(d: Difficulty, local: boolean): string {
  const s = S.difficulty[d], m = AI.levels[d]?.statMult ?? 1;
  const pc = (v: number): string => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  const battle = `戦闘：相手の考え方は「むずかしい」と同じ${m !== 1 ? `。相手の駒の体力・武力・知略が${pc(m)}（駒の「能力の変化」に出ます）` : ''}`;
  if (local) return `<p>${battle}。</p>`;
  return `<p>${s.warn ?? ''}</p><ul class="small">
    <li>自分の収入 ${pc(s.playerIncome)}・相手の収入 ${pc(s.aiIncome ?? 1)}</li>
    <li>自分の領の守備兵 ${pc(s.playerSiege)}・相手が自分を狙う度合い ×${s.aiVsPlayer}</li>
    <li>相手の武将のレベル +${s.aiGeneralLevel ?? 0}・相手が雇う兵のレベル +${s.aiTroopLevel}</li>
    ${s.aiGangUp ? `<li>自分が最も大きい国になると、相手どうしが組んで自分を攻める（${s.aiGangUp >= 1 ? '強く' : '少し'}）</li>` : ''}
    <li>${battle}</li></ul>`;
}
/** 難しさの欄を結ぶ。注意のある段（非常に難しい・鬼）を選ぶと確かめる窓を出し、やめたら元に戻す */
function bindDifficulty(root: HTMLElement, sel: HTMLSelectElement, local: boolean, set: (d: Difficulty) => void): void {
  let prev = sel.value as Difficulty;
  sel.onchange = async () => {
    const d = sel.value as Difficulty;
    sel.classList.toggle('oni', d === 'oni');
    if (S.difficulty[d].warn) {
      const ok = await confirmBox(root.firstElementChild as HTMLElement ?? root, { title: `難しさ：${S.difficulty[d].name}`, body: difficultyWarn(d, local), ok: 'この難しさにする', cancel: 'やめる', danger: d === 'oni' });
      if (!ok) { sel.value = prev; sel.classList.toggle('oni', prev === 'oni'); return; }
    }
    prev = d;
    set(d);
  };
}type Mode = { type: 'idle' } | { type: 'skill'; id: string } | { type: 'tactic'; id: string } | { type: 'breach'; id: '' };
type Control = 'attack' | 'defend' | 'both' | 'watch';
/** おまかせの陣営が1手ごとに空ける間（ミリ秒）。速さ1〜5 */
const AI_DELAY = [900, 500, 260, 110, 0];
/** 技・軍略のボタン：この数までは全部並べる。超えたら、使えるものをこの数だけ出し、残りは畳む */
const ARTS_FLAT = 8, ARTS_SHOW = 6;
/** おまかせの陣営の演出の長さの倍率。速さ5では演出をしない（待たない） */
const FX_SCALE = [1, 0.8, 0.55, 0.3, 0];
function loadSpeed(): number {
  try {
    const raw = localStorage.getItem('hexsim.aiSpeed'), v = Number(raw);
    return raw !== null && Number.isInteger(v) && v >= 0 && v < AI_DELAY.length ? v : 2;
  } catch { return 2; }
}
/** 画面の下に、短い知らせを数秒出す（ブラウザの確認窓の代わり） */
function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3200);
}
function saveSpeed(v: number): void { try { localStorage.setItem('hexsim.aiSpeed', String(v)); } catch { /* 保存できなくても動く */ } }
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class App {
  private save: HSave | null = null;
  private gs: GameStart | null = null;
  private st: BattleState | null = null;
  private view: BattleView | null = null;
  private selected: number | null = null;
  private inspect: number | null = null;
  private mode: Mode = { type: 'idle' };
  /** 戦いの始めの、配置を直している段階 */
  private deploying = false;
  private human = new Set<Side>([0]);
  private undo: { unit: number; pos: number; moveSpent: number } | null = null;
  /** 全員の行動が終わったときに、自動で番を終えるか */
  private autoEndTimer = 0;
  /** 移動の直後：使える行動のボタンを一瞬光らせる */
  private flashActions = false;
  private aiTimer = 0;
  /** 手動のときに操作する陣営（観戦に切り替えても覚えておく） */
  private manual = new Set<Side>([0]);
  /** 一部だけおまかせ（P44）：自分の陣営のうち、コンピューターが動かす駒 */
  private autoUnits = new Set<number>();
  private autoTimer = 0;
  private watching = false;
  /** おまかせの陣営が動く速さ（0〜4）。1手ごとの間は AI_DELAY */
  private aiSpeed = loadSpeed();
  /** 読み込んだ ima-rpg のセーブと、選んでいる仕える国・王にするか（P62） */
  private ima: ImaFile | null = null;
  private imaOpts: { faction: number; king: boolean } = { faction: 0, king: false };
  /** おまかせの方針の欄を開いているか（P50） */
  private planOpen = false;
  /** 畳んだ技・軍略の欄を開いているか（ほかの技・軍略、使えない技・軍略） */
  private artsFold = { more: false, off: false };
  /** 記録の細かさ（0 簡易・1 通常・2 詳細）。速さとは別に選ぶ。記録の元データは1つで、表示だけが変わる */
  private logLevel = loadLogLevel();
  private logView = new BattleLogView();
  private logHtml = '';
  private hoverCell = -1;
  private variant: Variant = 'jp';
  /** 戦略の難しさ（編成画面で選ぶ） */
  private difficulty: Difficulty = 'normal';
  private setup = { attacker: 0, defender: 0, picks: [[], []] as [string[], string[]], control: 'attack' as Control };
  /** 国モードで選んでいる国 */
  private nation = 0;
  /** 局地戦の、相手の強さ（思考の賢さ） */
  private localLevel: Difficulty = 'normal';
  private battleDone: ((st: BattleState) => BattleSummary | null) | null = null;
  private battleBack: { label: string; fn: () => void } = { label: '戻る', fn: () => this.setupScreen() };
  private allowQuit = true;
  private finished = false;
  /** 自分の周りに使う技・軍略で、1回目に押したもの（2回目で実行する） */
  private armed: string | null = null;

  constructor(readonly root: HTMLElement) {
    // 開発時の動作確認（tools/smoke.mjs）から状態を見られるようにする
    if (import.meta.env.DEV) (window as unknown as { __app?: App }).__app = this;
    this.titleScreen();
    // hist-sim の「この状態で hex で遊ぶ」から、セーブを直接受け取る（別のタブ・別のオリジンでも渡せる）。
    // hist-sim 側は、このページを開いて 'hex-sim:ready' を待ち、{type:'hex-sim:save', snapshot} を postMessage する。
    window.addEventListener('message', (e) => {
      const d = e.data as { type?: string; snapshot?: HSave } | null;
      // このページを開いた窓（hist-sim）から来たものだけを受け取る
      if (!window.opener || e.source !== window.opener) return;
      if (d?.type !== 'hex-sim:save' || !d.snapshot) return;
      void busy('受け取った世界を読み込んでいます…', () => {
        try {
          this.save = normalizeSave(d.snapshot!).save;
          this.variant = variantOf(this.save);
          this.rebuild();
        } catch (err) { this.titleScreen(err instanceof Error ? err.message : String(err)); }
      });
    });
    (window.opener as Window | null)?.postMessage({ type: 'hex-sim:ready' }, '*');
  }

  // ------------------------------------------------------------ 読み込み

  private titleScreen(error = ''): void {
    // タイトルだけ背景画を敷く（絵が無ければ地の色のまま）
    const bg = artUrl('bg/title');
    setScene(null);
    initBgm(); bgm('title');
    document.body.classList.add('title');
    document.body.style.setProperty('--title-bg', bg ? `url("${bg}")` : 'none');
    this.root.innerHTML = `
      <div class="center">
        <h1>hex-sim</h1>
        <p>hist-sim のセーブ（.histsim）を読み込んで、その状態からヘックスの戦いを始めます。ima-rpg のセーブ（.imarpg）なら、主人公と仲間・率いる兵を連れてきます。</p>
        <p><label class="btn">セーブファイルを選ぶ<input type="file" accept=".histsim,.json,.hexsim,.imarpg" hidden></label> <button id="continue" hidden>つづきから</button></p>
        <p class="dim">または、サンプルから始める</p>
        <p>${SAMPLES.map(([id, name]) => `<button data-sample="${id}">${name}</button>`).join(' ')}</p>
        <p><button data-help="intro">遊び方</button></p>
        <p class="error">${esc(error)}</p>
        <p class="worlds-lead">${WORLDS_LEAD}</p>
        ${worldsHtml()}
        <p class="dim" style="font-size:12px">地図の記号、地形、兵の駒、背景の絵は AI で生成したものです。見本の世界の地形：Terrain Tiles（Mapzen ほか）、川：Natural Earth。</p>
      </div>`;
    const file = this.root.querySelector<HTMLInputElement>('input[type=file]')!;
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      // .hexsim は hex-sim 自身のセーブ（戦略パートの続き）
      await busy('読み込んでいます…', async () => {
        if (f.name.endsWith('.hexsim')) {
          try { this.loadHexSave(await readHexSaveFile(f)); } catch (e) { this.titleScreen(e instanceof Error ? e.message : String(e)); }
          return;
        }
        // .imarpg は ima-rpg のセーブ（P62）：世界と、主人公・仲間・兵
        if (f.name.endsWith('.imarpg')) { await this.loadIma(f); return; }
        await this.load(f, f.name.endsWith('.json'));
      });
    };
    const cont = this.root.querySelector<HTMLButtonElement>('#continue')!;
    cont.onclick = () => { void openSaveMenu(this.root.querySelector<HTMLElement>('.center')!, { onLoad: (s) => { void busy('読み込んでいます…', () => this.loadHexSave(s)); } }); };
    void anySlot().then((has) => { cont.hidden = !has; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((b) => {
      b.onclick = () => busy('世界を読み込んでいます…', async () => {
        try {
          const res = await fetch(`samples/${b.dataset.sample}.histsim`);
          if (!res.ok) throw new SaveError('サンプルを読み込めませんでした');
          await this.load(await res.blob(), false);
        } catch (e) { this.titleScreen(e instanceof Error ? e.message : String(e)); }
      });
    });
  }

  private async load(data: Blob, plain: boolean): Promise<void> {
    try {
      const { save } = await readSaveFile(data, plain);
      this.save = save;
      this.ima = null;
      this.variant = variantOf(save);
      this.rebuild();
    } catch (e) {
      this.titleScreen(e instanceof SaveError ? e.message : `読み込みに失敗しました：${e}`);
    }
  }

  /** 読み込んだ世界から作り直して、画面を出す（next：出す画面。名前の版を変えたときは、今の画面のまま） */
  private rebuild(next: 'mode' | 'nation' | 'local' | 'ima' = 'mode'): void {
    setVariant(this.variant);
    this.gs = convert(this.save!, { variant: this.variant });
    const facs = this.factionsBySize();
    this.setup.attacker = facs[0].id;
    this.setup.defender = (facs[1] ?? facs[0]).id;
    this.autoPick();
    if (!this.gs.factions[this.nation]) this.nation = facs[0].id;
    if (next === 'nation') this.nationScreen(); else if (next === 'local') this.setupScreen(); else if (next === 'ima' && this.ima) this.imaScreen(); else this.modeScreen();
    // モードや国を選んでいる間に、戦略マップの下ごしらえを進めておく（戦略を始めたときに、すぐ地図が出る）
    prewarm(this.save!.world);
  }

  private factionsBySize() {
    const gs = this.gs!;
    return Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length || a.id - b.id);
  }

  private candidates(faction: number): GGeneral[] {
    return generalsOf(this.gs!, faction).sort((a, b) => Number(b.isLord) - Number(a.isLord) || b.level - a.level || a.id.localeCompare(b.id));
  }

  private autoPick(): void {
    const top = (f: number) => this.candidates(f).sort((a, b) => b.level - a.level).slice(0, MAX_GENERALS).map((g) => g.id);
    this.setup.picks = [top(this.setup.attacker), top(this.setup.defender)];
  }

  // ------------------------------------------------------------ 編成

  private generalRow(g: GGeneral, side: Side): string {
    const c = D.byClass[g.classId];
    const checked = this.setup.picks[side].includes(g.id) ? 'checked' : '';
    const troops = g.troops.map((t) => `${L(D.byUnit[t.unitId].name)}<span class="dim">Lv${t.level}</span>`).join('、') || '<span class="dim">兵なし</span>';
    const traits = g.traits.map((t) => TRAIT_NAME[t] ?? t).join('・');
    return `<label class="gen"><input type="checkbox" data-side="${side}" data-gen="${g.id}" ${checked}>
      <span><b>${esc(g.name.ja)}</b>${g.isLord ? ' <span class="tag">当主</span>' : ''} <span class="dim">${g.age}歳</span>
      <span class="trait" data-tip="${esc(classTip(g.classId))}">${L(c.name)}</span> Lv${g.level}
      <span class="dim">${T.str()}${g.stats.str + classMod(c).str} ${T.int()}${g.stats.int + classMod(c).int} ${T.agi()}${g.stats.agi + classMod(c).agi}
      ${T.hp()}${g.stats.hp + classMod(c).hp} 采配${g.command}／${g.commandRange}${traits ? ` ・${traits}` : ''} ／ 性格：${personalityLabel(personalityOf(g.traits, g.ab))}</span><br>
      <span class="troops">${troops}</span></span></label>`;
  }

  /** モード選択・国選び・局地戦の編成に共通の、画面の上の帯 */
  private headerHtml(back: 'save' | 'modes'): string {
    const gs = this.gs!, facs = this.factionsBySize();
    return `<header>
          <b>${esc(gs.worldName.ja)}</b> ${gs.year < 0 ? `前${-gs.year + 1}` : gs.year}年${gs.month}月
          <span class="dim">勢力${facs.length}・武将${Object.values(gs.generals).filter((g) => g.faction).length}・浪人${generalsOf(gs, 0).length}</span>
          <span class="spacer"></span>
          名前の版 <select id="variant"><option value="jp" ${this.variant === 'jp' ? 'selected' : ''}>日本版</option><option value="cn" ${this.variant === 'cn' ? 'selected' : ''}>中国版</option></select>
          <button id="bgmBtn" title="曲の音量（押すたびに切・小・中・大）">曲：${BGM_LEVEL_NAME[bgmLevel()]}</button>
          ${back === 'save' ? '<button id="back">別のセーブ</button>' : '<button id="toModes">モードを選ぶ</button>'}
        </header>`;
  }

  /** 上の帯のボタン（名前の版・曲・戻る）。screen：名前の版を変えたあとに出し直す画面 */
  private bindHeader(screen: 'mode' | 'nation' | 'local'): void {
    const q = <E extends HTMLElement>(s: string) => this.root.querySelector<E>(s);
    q<HTMLSelectElement>('#variant')!.onchange = (e) => { this.variant = (e.target as HTMLSelectElement).value as Variant; this.rebuild(screen); };   // 0.1秒ほどで終わるので、表示は出さない
    q<HTMLButtonElement>('#bgmBtn')!.onclick = (e) => { setBgmLevel((bgmLevel() + 1) % BGM_LEVEL_NAME.length); (e.currentTarget as HTMLButtonElement).textContent = `曲：${BGM_LEVEL_NAME[bgmLevel()]}`; };
    const back = q<HTMLButtonElement>('#back');
    if (back) back.onclick = async () => {
      if (await confirmBox(this.root.querySelector('.setup')!, { title: '別のセーブを選ぶ', body: '<p>題の画面に戻って、別のセーブを読み込みます。</p>', ok: '題の画面へ', cancel: 'やめる', danger: true })) this.titleScreen();
    };
    const toModes = q<HTMLButtonElement>('#toModes');
    if (toModes) toModes.onclick = () => this.modeScreen();
  }

  private enterSetupLike(): void {
    document.body.classList.remove('title');
    // 編成の画面には、陣営の絵を暗く敷く（日本版は陣幕、中国版は戦車の陣）
    setScene(sceneUrl('setup', this.variant));
    bgm('title');
    cancelAnimationFrame(this.aiTimer); clearTimeout(this.aiTimer);
  }

  // ------------------------------------------------------------ モードを選ぶ

  /** 世界を読み込んだあとの最初の画面：国モードか局地戦モードかを選ぶ */
  private modeScreen(): void {
    this.enterSetupLike();
    const gs = this.gs!;
    this.root.innerHTML = `
      <div class="setup modes">
        ${this.headerHtml('save')}
        <h2 class="modes-title">遊び方を選ぶ</h2>
        <div class="mode-cards">
          <button class="mode-card" id="modeNation">
            <span class="mode-kind">国モード</span>
            <b>国を選ぶ</b>
            <span class="mode-text">一つの国の主になって、領を取り合い、天下を目指します。月ごとに武将を動かし、兵を集め、普請や外交をして、攻め込み・攻められれば戦います。</span>
          </button>
          <button class="mode-card" id="modeLocal">
            <span class="mode-kind">局地戦モード</span>
            <b>局地戦を1戦だけ遊ぶ</b>
            <span class="mode-text">攻め手と守り手の勢力と武将を選んで、1戦だけ戦います。戦いの結果は、ほかに持ち越しません。</span>
          </button>
        </div>
        ${gs.log.length ? `<details class="dim"><summary>変換の記録（${gs.log.length}件）</summary>${gs.log.map(esc).join('<br>')}</details>` : ''}
      </div>`;
    this.bindHeader('mode');
    this.root.querySelector<HTMLButtonElement>('#modeNation')!.onclick = () => this.nationScreen();
    this.root.querySelector<HTMLButtonElement>('#modeLocal')!.onclick = () => this.setupScreen();
  }

  // ------------------------------------------------------------ 国を選ぶ（国モード）

  private nationScreen(): void {
    this.enterSetupLike();
    const gs = this.gs!, facs = this.factionsBySize();
    if (!gs.factions[this.nation]) this.nation = facs[0].id;
    const row = (f: (typeof facs)[number]): string => {
      const lord = gs.generals[f.lordId], provs = gs.provinces.filter((p) => p.owner === f.id).length;
      const cap = gs.provinces[f.capital]?.name.ja ?? '';
      const traits = traitsOf(f).map((t) => t.name).join('・');
      return `<label class="nation ${f.id === this.nation ? 'on' : ''}"><input type="radio" name="nation" value="${f.id}" ${f.id === this.nation ? 'checked' : ''}>
        <span class="swatch" style="background:rgb(${f.color.join(',')})"></span>
        <span><b>${esc(f.name.ja)}</b> <span class="dim">本拠 ${esc(cap)}</span><br>
        <span class="dim">領${provs}・武将${generalsOf(gs, f.id).length}・兵糧${Math.round(f.supply)}${lord ? `・当主 ${esc(lord.name.ja)} Lv${lord.level}` : ''}${traits ? `・特色 ${esc(traits)}` : ''}</span></span></label>`;
    };
    this.root.innerHTML = `
      <div class="setup nations">
        ${this.headerHtml('modes')}
        <h2 class="modes-title">国を選ぶ <span class="dim small">（国モード）</span></h2>
        <p class="dim">主になる国を選んでください（一覧か地図を押す）。大きな国ほど楽に、小さな国ほど難しくなります。</p>
        <div class="nation-body">
          <div class="nation-list">${facs.map(row).join('')}</div>
          <div class="nation-map"><div class="dim small">広域地図（明るいのが選んでいる国、白い点が本拠）</div></div>
        </div>
        <footer>
          <select id="difficulty" class="${this.difficulty === 'oni' ? 'oni' : ''}" title="戦略の難しさ：自分の収入と領の落ちにくさ、相手の攻めやすさが変わる">${difficultyOptions(this.difficulty, '難しさ')}</select>
          <button id="nationRandom" title="国をくじで選ぶ">ランダム</button>
          <span class="spacer"></span>
          <button id="campaignWatch" title="どの国も選ばず、国どうしの取り合いを見る">国を選ばず観戦する</button>
          <button id="campaign" class="primary">${esc(gs.factions[this.nation].name.ja)}で始める</button>
        </footer>
      </div>`;
    this.bindHeader('nation');
    // 広域地図：一覧の横（スマホでは下）。幅が決まってから描く
    const holder = this.root.querySelector<HTMLElement>('.nation-map')!;
    const nm = new NationMap(this.save!.world, gs);
    holder.appendChild(nm.canvas);
    // 広い画面では枠の高さにも収める（縦長の世界でもはみ出さない）。狭い画面では幅いっぱい
    const drawMap = () => {
      const wd = Math.max(160, holder.clientWidth - 16);
      const narrow = window.innerWidth <= 720, hAvail = holder.clientHeight - 40;
      nm.draw(Math.floor(narrow || hAvail <= 0 ? wd : Math.min(wd, hAvail / nm.aspect)), this.nation);
    };
    const pick = (id: number, scroll: boolean) => {
      if (!gs.factions[id]) return;
      this.nation = id;
      this.root.querySelectorAll<HTMLLabelElement>('.nation').forEach((el) => {
        const r = el.querySelector<HTMLInputElement>('input')!, on = Number(r.value) === id;
        r.checked = on; el.classList.toggle('on', on);
        if (on && scroll) el.scrollIntoView({ block: 'nearest' });
      });
      this.root.querySelector<HTMLButtonElement>('#campaign')!.textContent = `${gs.factions[id].name.ja}で始める`;
      drawMap();
    };
    requestAnimationFrame(drawMap);
    const onResize = () => { if (this.root.contains(holder)) drawMap(); else window.removeEventListener('resize', onResize); };
    window.addEventListener('resize', onResize);
    nm.canvas.onclick = (e) => { const r = nm.canvas.getBoundingClientRect(); pick(nm.factionAt(e.clientX - r.left, e.clientY - r.top), true); };
    this.root.querySelectorAll<HTMLInputElement>('input[name="nation"]').forEach((r) => { r.onchange = () => pick(Number(r.value), false); });
    this.root.querySelector<HTMLButtonElement>('#nationRandom')!.onclick = () => {
      const others = facs.filter((f) => f.id !== this.nation);
      if (others.length) pick(others[Math.floor(Math.random() * others.length)].id, true);
    };
    bindDifficulty(this.root, this.root.querySelector<HTMLSelectElement>('#difficulty')!, false, (d) => { this.difficulty = d; });
    this.root.querySelector<HTMLButtonElement>('#campaign')!.onclick = () => busy('戦略を始めています…', () => this.startCampaign(this.nation));
    this.root.querySelector<HTMLButtonElement>('#campaignWatch')!.onclick = () => busy('戦略を始めています…', () => this.startCampaign(0));
  }

  // ------------------------------------------------------------ 局地戦の編成（局地戦モード）

  private setupScreen(): void {
    this.enterSetupLike();
    const gs = this.gs!;
    const facs = this.factionsBySize();
    const opts = (sel: number) => facs.map((f) => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name.ja)}（武将${generalsOf(gs, f.id).length}）</option>`).join('');
    const def = gs.factions[this.setup.defender];
    const place = gs.provinces[def.capital]?.name.ja ?? '';
    this.root.innerHTML = `
      <div class="setup">
        ${this.headerHtml('modes')}
        <div class="cols">
          ${([0, 1] as Side[]).map((s) => `
            <section>
              <h2 style="color:${SIDE_COLOR[s]}">${s === 0 ? '攻め手' : '守り手'}</h2>
              <select data-fac="${s}">${opts(s === 0 ? this.setup.attacker : this.setup.defender)}</select>
              <p class="dim">出陣する武将を${MAX_GENERALS}人まで選ぶ</p>
              <div class="gens">${this.candidates(s === 0 ? this.setup.attacker : this.setup.defender).map((g) => this.generalRow(g, s)).join('')}</div>
            </section>`).join('')}
        </div>
        <footer>
          戦場：<b>${esc(place)}</b>（守り手の本拠）
          <span class="spacer"></span>
          操作：<select id="control">
            ${[['attack', '攻め手を操作'], ['defend', '守り手を操作'], ['both', '両方を操作'], ['watch', '観戦（両方おまかせ）']].map(([v, n]) => `<option value="${v}" ${this.setup.control === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <select id="localLevel" title="相手の強さ：相手の考え方の賢さが変わる（やさしいは、あまり考えずに動き、守り手は打って出やすい）。非常に難しい・鬼は、相手の駒の体力・武力・知略も上がる">${difficultyOptions(this.localLevel, '相手')}</select>
          <button id="start" class="primary">戦闘開始</button>
        </footer>
      </div>`;
    const q = <E extends HTMLElement>(s: string) => this.root.querySelector<E>(s)!;
    this.bindHeader('local');
    q<HTMLSelectElement>('#control').onchange = (e) => { this.setup.control = (e.target as HTMLSelectElement).value as Control; };
    this.root.querySelectorAll<HTMLSelectElement>('[data-fac]').forEach((sel) => {
      sel.onchange = () => {
        if (sel.dataset.fac === '0') this.setup.attacker = Number(sel.value); else this.setup.defender = Number(sel.value);
        this.autoPick();
        this.setupScreen();
      };
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-gen]').forEach((cb) => {
      cb.onchange = () => {
        const side = Number(cb.dataset.side) as Side, id = cb.dataset.gen!;
        const list = this.setup.picks[side].filter((x) => x !== id);
        if (cb.checked) {
          if (list.length >= MAX_GENERALS) { cb.checked = false; return; }
          list.push(id);
        }
        this.setup.picks[side] = list;
      };
    });
    bindDifficulty(this.root, q<HTMLSelectElement>('#localLevel'), true, (d) => { this.localLevel = d; });
    q<HTMLButtonElement>('#start').onclick = () => {
      if (this.setup.attacker === this.setup.defender) { toast('攻め手と守り手に同じ勢力は選べません'); return; }
      if (!this.setup.picks[0].length || !this.setup.picks[1].length) { toast('武将を1人以上選んでください'); return; }
      void busy('戦場を用意しています…', () => this.startBattle());
    };
  }

  // ------------------------------------------------------------ ima-rpg から（P62）

  private async loadIma(f: Blob): Promise<void> {
    try {
      const file = await readImaFile(f);
      this.ima = file;
      this.save = file.save;
      this.variant = imaVariant(file.game) ?? variantOf(file.save);
      const realm = imaRealm(file.game);
      this.imaOpts = { faction: realm, king: !!file.game.player.throne };
      this.rebuild('ima');
    } catch (e) {
      this.titleScreen(e instanceof SaveError ? e.message : `読み込みに失敗しました：${e}`);
    }
  }

  /**
   * ima-rpg から来た人々の画面：主人公・仲間・ライバル・率いる兵の顔ぶれ（hex-sim の武将と兵にしたときの姿）と、
   * 仕える国（浪人なら選ぶ）・主人公を王にするかしないか・難しさを選んで、国モードを始める
   */
  private imaScreen(): void {
    this.enterSetupLike();
    const file = this.ima!, game = file.game, p = game.player, gs = this.gs!;
    const facs = this.factionsBySize();
    const throne = p.throne && gs.factions[p.throne.realm] ? p.throne.realm : 0;
    if (throne) this.imaOpts = { faction: throne, king: true };
    if (!gs.factions[this.imaOpts.faction]) this.imaOpts.faction = 0;
    const opt = this.imaOpts;
    // 武将と兵にしたときの姿（変換し直した世界に、試しに加えて見る）
    const pre = convert(this.save!, { variant: this.variant });
    const res = applyIma(pre, game, this.variant, { faction: opt.faction || facs[0].id, king: opt.king });
    const genLine = (id: string | null, role: string): string => {
      const g = id ? pre.generals[id] : null;
      if (!g) return '';
      const c = D.byClass[g.classId];
      return `<div class="ima-gen"><b>${esc(g.name.ja)}</b> <span class="tag">${role}</span> <span class="trait" data-tip="${esc(classTip(g.classId))}">${L(c.name)}</span> Lv${g.level}
        <span class="dim">${T.str()}${g.stats.str + classMod(c).str} ${T.int()}${g.stats.int + classMod(c).int} ${T.agi()}${g.stats.agi + classMod(c).agi} ${T.hp()}${g.stats.hp + classMod(c).hp} 采配${g.command}</span><br>
        <span class="small">${g.traits.length ? `特性：${g.traits.map((t) => `<span class="trait" data-tip="${esc(traitTip(t))}">${TRAIT_NAME[t] ?? t}</span>`).join('・')}　` : ''}${g.skills?.length ? `技：${g.skills.map((s) => `<span class="trait" data-tip="${esc(skillTip(D.bySkill[s]))}">${esc(L(D.bySkill[s].name))}</span>`).join('・')}　` : ''}${g.learned.length ? `軍略：${g.learned.map((x) => `<span class="trait" data-tip="${esc(tacticTip(D.byTactic[x]))}">${esc(L(D.byTactic[x].name))}</span>`).join('・')}　` : ''}${g.troops.length ? `兵：${g.troops.map((t) => `${esc(t.name ?? L(D.byUnit[t.unitId].name))}Lv${t.level}`).join('・')}` : ''}</span></div>`;
    };
    const patron = gs.factions[imaRealm(game)];
    const facOpts = `${!imaRealm(game) ? `<option value="0" ${opt.faction ? '' : 'selected'}>（仕える国を選ぶ）</option>` : ''}${facs.map((f) => `<option value="${f.id}" ${f.id === opt.faction ? 'selected' : ''}>${esc(f.name.ja)}（領${gs.provinces.filter((q) => q.owner === f.id).length}・武将${generalsOf(gs, f.id).length}）${f.id === imaRealm(game) ? '　← 仕えている国' : ''}</option>`).join('')}`;
    const lordName = opt.faction && gs.factions[opt.faction] ? gs.generals[gs.factions[opt.faction].lordId]?.name.ja ?? '' : '';
    this.root.innerHTML = `
      <div class="setup ima">
        ${this.headerHtml('save')}
        <h2 class="modes-title">ima-rpg から来た人々</h2>
        <p class="dim">${esc(p.name)}の旅の世界（${esc(gs.worldName.ja)}・${gs.year < 0 ? `前${-gs.year + 1}` : gs.year}年${gs.month}月）から、主人公と仲間、率いる兵を武将と兵として連れてきます。能力は技能から、技・軍略はそのまま、特性は記録の人物はその人のもの、ほかは生まれ・技能・極めた道から決めます。戦いの結果は ima-rpg へは戻りません。</p>
        ${file.warnings.length ? `<p class="error">${file.warnings.map(esc).join('<br>')}</p>` : ''}
        <div class="card ima-cast">
          ${genLine(res.heroId, '主人公')}
          ${res.companionIds.map((id) => genLine(id, '仲間')).join('')}
          ${res.rivalIds.map((id) => genLine(id, 'ライバル')).join('')}
          ${res.reserve.length ? `<div class="small dim">入りきらない兵${res.reserve.length}隊は、始まりの領の予備兵になります</div>` : ''}
          ${res.jailMonths ? `<div class="small error">主人公は獄にいるので、はじめの${res.jailMonths}か月は戦えません（深手と同じ扱い）</div>` : ''}
          ${p.dead ? '<div class="small error">主人公はすでに討たれているので、仲間と兵だけが来ます</div>' : ''}
        </div>
        <div class="card ima-choose">
          <label>仕える国：<select id="imaFac" ${throne ? 'disabled' : ''}>${facOpts}</select></label>
          ${throne ? `<p class="small">主人公は${esc(gs.factions[throne].name.ja)}の王位にある（${esc(p.throne!.how)}）ので、王として迎えます。</p>`
            : `<p class="small">${patron ? `${esc(patron.name.ja)}に仕えています（位${p.rank ?? 0}）。` : '浪人です。仕える国を選んでください。'}</p>
          <label class="ima-radio"><input type="radio" name="imaKing" value="1" ${opt.king ? 'checked' : ''}> 主人公を王にする <span class="dim small">（${lordName ? `本来の王の${esc(lordName)}は武将に降格` : '本来の王は武将に降格'}）</span></label>
          <label class="ima-radio"><input type="radio" name="imaKing" value="0" ${opt.king ? '' : 'checked'}> 王にしない <span class="dim small">（${lordName ? `${esc(lordName)}が王のまま。` : ''}主人公は武将として仕える。国はあなたが動かす）</span></label>`}
        </div>
        <footer>
          <select id="difficulty" class="${this.difficulty === 'oni' ? 'oni' : ''}">${difficultyOptions(this.difficulty, '難しさ')}</select>
          <span class="spacer"></span>
          <button id="imaStart" class="primary" ${opt.faction ? '' : 'disabled'}>${opt.faction ? `${esc(gs.factions[opt.faction].name.ja)}で国モードを始める` : '仕える国を選んでください'}</button>
        </footer>
      </div>`;
    this.bindHeader('mode');
    // 名前の版を変えたら、この画面に戻る
    this.root.querySelector<HTMLSelectElement>('#variant')!.onchange = (e) => { this.variant = (e.target as HTMLSelectElement).value as Variant; this.rebuild('ima'); };
    const facSel = this.root.querySelector<HTMLSelectElement>('#imaFac')!;
    facSel.onchange = () => { opt.faction = Number(facSel.value); this.imaScreen(); };
    this.root.querySelectorAll<HTMLInputElement>('input[name="imaKing"]').forEach((r) => { r.onchange = () => { opt.king = r.value === '1'; this.imaScreen(); }; });
    bindDifficulty(this.root, this.root.querySelector<HTMLSelectElement>('#difficulty')!, false, (d) => { this.difficulty = d; });
    this.root.querySelector<HTMLButtonElement>('#imaStart')!.onclick = () => { if (opt.faction) void busy('戦略を始めています…', () => this.startIma()); };
  }

  /** ima-rpg の人々を加えた世界で、国モードを始める */
  private startIma(): void {
    const file = this.ima!, opt = this.imaOpts;
    this.gs = convert(this.save!, { variant: this.variant });
    const res = applyIma(this.gs, file.game, this.variant, opt);
    const c = newCampaign(this.gs, this.save!.world, opt.faction, this.difficulty);
    if (res.heroId && res.jailMonths) c.wounded[res.heroId] = c.gs.tick + res.jailMonths;
    if (res.reserve.length && res.prov >= 0) c.reserve[res.prov] = [...(c.reserve[res.prov] ?? []), ...res.reserve].slice(0, S.reserve.max);
    // 年表を起こしてから、来た人々のことを書く（年表にも残る）
    startChronicle(c);
    for (const n of res.notes) note(c, 'imaArrive', { text: n });
    new CampaignScreen(this, c, () => this.rebuild());
  }

  // ------------------------------------------------------------ 戦略

  /** 戦略パートを始める。セーブを変換し直して、まっさらな状態から始める */
  private startCampaign(player: number): void {
    this.gs = convert(this.save!, { variant: this.variant });
    new CampaignScreen(this, newCampaign(this.gs, this.save!.world, player, this.difficulty), () => this.rebuild());
  }

  /** hex-sim のセーブから、戦略パートの続きを始める */
  loadHexSave(s: HexSave): void {
    try {
      const c = restore(s);
      this.save = { format: 'hist-sim', version: 1, savedAt: s.savedAt, summary: { seed: c.gs.seed, year: c.gs.year, nations: Object.keys(c.gs.factions).length }, world: c.world };
      this.variant = c.gs.variant;
      setVariant(this.variant);
      this.gs = c.gs;
      new CampaignScreen(this, c, () => this.rebuild());
    } catch (e) { this.titleScreen(e instanceof Error ? e.message : String(e)); }
  }

  // ------------------------------------------------------------ 戦闘

  private startBattle(): void {
    const gs = this.gs!, w = this.save!.world;
    const def = gs.factions[this.setup.defender], atk = gs.factions[this.setup.attacker];
    const prov = gs.provinces[def.capital];
    // 攻め手の本拠から攻めてくる向きで、戦場の左右が決まる
    const map = mapFromProvince(w, def.capital, prov ? { capital: true, fort: prov.fort, buildings: prov.buildings, pop: prov.pop, income: prov.income, unrest: prov.unrest, coastal: prov.coastal, river: prov.river, from: atk.capital } : { capital: true, from: atk.capital });
    const st = createBattle(gs, map, this.setup.picks, `ui:${Date.now()}`, [atk.name.ja, def.name.ja]);
    // 相手の強さ：自分が片方だけを動かすとき、相手の陣営の思考の賢さを変える
    if (this.setup.control === 'attack' || this.setup.control === 'defend') setAiLevel(st, this.setup.control === 'attack' ? 1 : 0, this.localLevel);
    const human = new Set<Side>(this.setup.control === 'attack' ? [0] : this.setup.control === 'defend' ? [1] : this.setup.control === 'both' ? [0, 1] : []);
    this.openBattle(st, human, (s) => applyBattleResult(gs, s), { label: '編成に戻る', fn: () => { this.autoPick(); this.setupScreen(); } }, true);
  }

  /**
   * 戦闘画面を開く。
   * done：決着がついたときに結果を反映する。back：結果を見たあとの戻り先。
   * allowQuit が false のときは途中でやめられず、代わりに「おまかせで決着」ができる。
   */
  openBattle(st: BattleState, human: Set<Side>, done: (st: BattleState) => BattleSummary | null, back: { label: string; fn: () => void }, allowQuit: boolean, manualSide: Side = 0): void {
    document.body.classList.remove('title');
    setScene(null, sceneUrl('setup', this.variant));
    bgm(`battle_${this.variant}`);
    this.st = st; this.human = human;
    // 味方のおまかせの方針（P50）：自分で動かす陣営は、おまかせのとき方針で動く（国モードの戦いは、戦略の側で付けてある）
    if (!st.autoPlan && human.size) st.autoPlan = [human.has(0) ? getPlan() : null, human.has(1) ? getPlan() : null];
    this.autoUnits = new Set(); clearTimeout(this.autoTimer);
    // 観戦で始めたときに手動へ切り替えると、manualSide の陣営（ふつうは攻め手）を操作する
    this.watching = human.size === 0;
    this.manual = human.size ? new Set(human) : new Set<Side>([manualSide]);
    this.battleDone = done; this.battleBack = back; this.allowQuit = allowQuit; this.finished = false;
    this.selected = null; this.inspect = null; this.mode = { type: 'idle' }; this.undo = null;
    this.lastSky = '';
    this.root.innerHTML = `
      <div class="battle">
        <canvas></canvas>
        ${this.compassHtml(st)}
        <aside><div id="panel"></div><div id="ctl" class="speed"></div><div id="log"></div></aside>
      </div>`;
    this.renderCtl();
    initSound();
    initTips();
    const canvas = this.root.querySelector('canvas')!;
    this.view = new BattleView(canvas);
    this.view.setState(this.st);
    // 武将の駒に付ける紋（勢力の名前から引く）
    this.view.crests = st.sideNames.map((name) => {
      const f = Object.values(this.gs?.factions ?? {}).find((x) => x.name.ja === name);
      return f ? { id: f.id, name: f.name.ja, color: tint(f.color) } : null;
    }) as [CrestSpec | null, CrestSpec | null];
    this.view.cam.attachInput((sx, sy) => this.onHover(sx, sy), (sx, sy, touch) => this.onClick(sx, sy, touch));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cancel(); });
    window.onkeydown = (e) => { if (e.key === 'Escape') this.cancel(); };
    this.pushTurnLog();
    // 自分で動かす陣営があれば、始める前に配置を少し直せる（観戦のときは、すぐ始める）
    this.deploying = human.size > 0 && st.round === 1 && st.winner === null && !st.log.some((l) => l.key === 'act');
    this.refresh();
    if (this.deploying) return;
    this.startFighting();
  }

  /** 配置を終えて戦いを始める：開戦の帯を出し、おまかせの陣営の番なら動かす */
  private startFighting(): void {
    this.deploying = false;
    this.selected = null;
    this.refresh();
    this.splash('開戦');
    this.maybeAi();
  }

  /** 配置の段階で、その駒を置けるマス：自分の陣営の配置場所の、入れるマス（自分の駒がいるマスは入れ替え） */
  private deployCells(u: BUnit): number[] {
    const st = this.st!;
    return st.map.spawn[u.side].filter((i) => i !== u.pos && stepCost(st, u, i) !== null && st.map.terrain[i] !== 'water' && st.map.terrain[i] !== 'wall'
      && (!unitAt(st, i) || (unitAt(st, i)!.side === u.side && stepCost(st, unitAt(st, i)!, u.pos) !== null)));
  }

  /** 方位の印：戦場は北が上。攻め手は攻めてきた方角の辺から入る */
  private compassHtml(st: BattleState): string {
    const [nx, ny] = st.map.north ?? [0, -1];
    const deg = Math.round(Math.atan2(nx, -ny) * 180 / Math.PI);
    const tip = st.map.edgeName
      ? `戦場は北が上で、本当の地形のままです。攻め手（${esc(st.sideNames[0])}）は攻めてきた${st.map.edgeName}の端から、守り手（${esc(st.sideNames[1])}）はその反対の端から始まります。どの方角から攻めるかで、地形の有利・不利が変わります。`
      : '矢印の先が北です。';
    return `<div class="compass" data-tip="${tip}">
      <span class="needle" style="transform:rotate(${deg}deg)"><i></i><b>北</b></span></div>`;
  }

  private pushTurnLog(): void {
    const st = this.st!;
    st.log.push({ key: 'turn', vars: { side: st.sideNames[st.turn], round: st.round } });
  }

  /** 指で触る画面か（見込みの欄に「もう1度押すと実行」を添える） */
  private coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** 天気の欄：最後に出した天気と、光らせておく時刻 */
  private lastSky = '';
  private skyFlashUntil = 0;
  /** 技・軍略を選んだら、その説明と見込みの表が見えるところまで情報欄を送る（スマホでは欄の下に隠れるため） */
  private showInfo(): void {
    const el = this.root.querySelector<HTMLElement>('table.expect') ?? this.root.querySelector<HTMLElement>('.minfo');
    const panel = this.root.querySelector<HTMLElement>('#panel');
    if (!el || !panel) return;
    const r = el.getBoundingClientRect(), p = panel.getBoundingClientRect(), t = this.root.querySelector('table.expect')?.getBoundingClientRect();
    const bottom = Math.max(r.bottom, t?.bottom ?? 0), foot = this.root.querySelector('#panel .foot')?.getBoundingClientRect().height ?? 0;
    if (bottom > p.bottom - foot) panel.scrollTop += Math.min(bottom - (p.bottom - foot) + 8, r.top - p.top - 8);
  }

  /** 流している演出が終わる時刻（決着の窓は、駒の動きが止まってから出す） */
  private fxEnd = 0;
  private isHumanTurn(): boolean { return !!this.st && this.st.winner === null && this.human.has(this.st.turn); }
  private sel(): BUnit | null { return this.selected === null ? null : this.st!.units[this.selected]; }

  private cancel(): void {
    if (this.mode.type !== 'idle') this.mode = { type: 'idle' };
    else this.selected = null;
    this.refresh();
  }

  private onHover(sx: number, sy: number): void {
    const cell = this.view!.pick(sx, sy);
    if (cell === this.hoverCell) return;
    this.hoverCell = cell;
    this.refresh(false);
  }

  private onClick(sx: number, sy: number, touch = false): void {
    const st = this.st!;
    const cell = this.view!.pick(sx, sy);
    if (cell < 0 || st.winner !== null) return;
    if (this.deploying) {
      // 配置：自分の駒を選び、配置場所のマスを押すと動く（自分の駒がいれば入れ替える）
      const t = unitAt(st, cell), u0 = this.sel();
      if (u0 && this.deployCells(u0).includes(cell)) {
        if (t) t.pos = u0.pos;
        u0.pos = cell;
      } else if (t && this.human.has(t.side)) this.selected = t.id;
      else { this.inspect = t ? t.id : null; this.selected = null; }
      this.refresh();
      return;
    }
    const u = this.sel();
    // 指で触る画面には「重ねる」が無いので、触ったマスを「重ねたマス」として扱う（地形や見込みが出る）
    const armed = touch && this.hoverCell === cell;
    if (touch) this.hoverCell = cell;
    if (u && this.isHumanTurn() && this.mode.type !== 'idle') {
      const targets = this.modeTargets(u);
      // 指のときは、1度目で見込みを出し、同じマスをもう1度押すと実行する
      if (touch && !armed && targets.includes(cell)) { this.refresh(); return; }
      if (targets.includes(cell)) {
        this.act(this.modeAction(u, cell)!);
      } else this.mode = { type: 'idle' };
      this.refresh();
      return;
    }
    const t = unitAt(st, cell);
    if (t) {
      this.inspect = t.id;
      if (this.isHumanTurn() && t.side === st.turn) { this.selected = t.id; this.mode = { type: 'idle' }; }
      else if (!u) this.selected = null;
    } else if (u && this.isHumanTurn() && moveCells(st, u).includes(cell)) {
      if (!u.acted) this.undo = { unit: u.id, pos: u.pos, moveSpent: u.moveSpent };
      this.perform([{ type: 'move', unit: u.id, to: cell }]);
      // 移動の直後は、使える行動のボタンを一瞬光らせる
      this.flashActions = true;
      window.setTimeout(() => { this.flashActions = false; this.root.querySelectorAll('.actions .flash').forEach((b) => b.classList.remove('flash')); }, 1200);
    } else { this.selected = null; this.inspect = null; }
    this.refresh();
    this.checkAutoEnd();
  }

  /**
   * 行動を実行して、演出（駒の動き・数字・音）を流す。状態はここで確定し、演出は描画だけ。
   * scale は演出の長さの倍率（0 なら演出なし）。戻り値：実行できたか、演出の長さ（ミリ秒）
   */
  /** 自分で動かしたときの演出の長さ：「速さ」に合わせて短くする（速さ5でも、何が起きたかは見えるように少し残す） */
  private ownFx(): number { return Math.max(0.3, FX_SCALE[this.aiSpeed]); }

  private perform(acts: Action[], scale = this.ownFx()): { ok: boolean; dur: number } {
    const st = this.st!, view = this.view;
    const b = scale > 0 && view ? before(st) : null;
    const logLen = st.log.length;
    let ok = false;
    for (const a of acts) {
      if (b) notePath(st, b, a);
      ok = apply(st, a) || ok;
    }
    if (!ok) return { ok, dur: 0 };
    if (!b || !view) {
      // 演出なし（いちばん速い設定）：倒れた音だけ鳴らす
      if (st.log.slice(logLen).some((e) => e.key === 'defeat')) play('defeat');
      return { ok, dur: 0 };
    }
    const c = cues(st, b, scale, performance.now());
    view.play(c.fx);
    this.fxEnd = Math.max(this.fxEnd, performance.now() + c.dur);
    for (const s of c.sounds) play(s.id, s.at);
    return { ok, dur: c.dur };
  }

  /** 行動を実行し、終わったユニットの選択を外す */
  private act(a: Action): void {
    const st = this.st!;
    if (!this.perform([a]).ok) return;
    this.undo = null;
    this.mode = { type: 'idle' };
    const u = this.sel();
    if (u && (!u.alive || (!canAct(st, u) && !canMove(st, u)))) this.selected = null;
    if (st.winner !== null) { this.finish(); return; }
    this.checkAutoEnd();
  }

  /** 使える行動（技・軍略・造りを壊す）があるか（待機は数えない） */
  private hasAction(u: BUnit): boolean {
    const st = this.st!;
    if (!canAct(st, u)) return false;
    if (u.skills.some((id) => { const s = skillOf(id); return canUseSkill(st, u, s) && skillTargetCells(st, u, s).length > 0; })) return true;
    if (u.tactics.some((id) => { const t = D.byTactic[id]; return canUseTactic(u, t) && tacticTargetCells(st, u, t).length > 0; })) return true;
    return breachTargets(st, u).length > 0;
  }

  /** 行動済みとして扱うか：行動した、動けない、または移動したあとで使える行動が無い */
  private unitDone(u: BUnit): boolean {
    const st = this.st!;
    if (!u.alive) return true;
    if (u.acted || (!canAct(st, u) && !canMove(st, u))) return true;
    return u.moved && !this.hasAction(u);
  }

  /**
   * 一部だけおまかせ（P44）：おまかせにした自分の駒を、コンピューターの考え方で1つずつ動かす（演出つき）。
   * 自分の番の初めと、ほかの駒を動かしたあとに呼ぶ。動かせる駒が無くなったら、全員が終わっていれば番を終える
   */
  private runAutoUnits(): void {
    const st = this.st;
    clearTimeout(this.autoTimer);
    if (!st || st.winner !== null || this.deploying || !this.isHumanTurn() || !this.autoUnits.size) return;
    for (const id of [...this.autoUnits]) if (!st.units[id]?.alive || st.units[id].side !== st.turn) this.autoUnits.delete(id);
    const u = st.units.find((x) => this.autoUnits.has(x.id) && x.alive && x.side === st.turn && (canAct(st, x) || canMove(st, x)));
    if (!u) { this.refresh(); this.checkAutoEnd(); return; }
    let acts = planUnit(st, u);
    if (!acts.length) acts = canAct(st, u) ? [{ type: 'wait', unit: u.id }] : [];
    const done = acts.length ? this.perform(acts, FX_SCALE[this.aiSpeed]) : { ok: false, dur: 0 };
    // 動けなかった駒は待機にして、次へ（止まらないように）
    if (!done.ok && canAct(st, u)) apply(st, { type: 'wait', unit: u.id });
    if (!done.ok && !canAct(st, u)) u.moved = true;
    this.inspect = u.id;
    this.refresh();
    if (st.winner !== null) { this.finish(); return; }
    this.autoTimer = window.setTimeout(() => this.runAutoUnits(), Math.max(AI_DELAY[this.aiSpeed], done.dur));
  }

  /** おまかせにする駒を足す（その場で動かし始める） */
  private addAuto(ids: number[]): void {
    for (const id of ids) this.autoUnits.add(id);
    this.selected = null; this.mode = { type: 'idle' };
    toast(`${ids.length}隊をおまかせにしました（「おまかせを外す」で全員手動に戻ります）`);
    this.runAutoUnits();
  }

  /** 自分の陣営の全員が行動済みになったら、少し置いて自動で番を終える */
  private checkAutoEnd(): void {
    const st = this.st;
    if (!st || st.winner !== null || this.deploying || !this.isHumanTurn()) return;
    const mine = st.units.filter((x) => x.alive && x.side === st.turn);
    if (!mine.length || !mine.every((x) => this.unitDone(x))) return;
    clearTimeout(this.autoEndTimer);
    const turn = st.turn, round = st.round;
    toast('全員の行動が終わったので、番を終えます');
    this.autoEndTimer = window.setTimeout(() => {
      if (this.st === st && st.turn === turn && st.round === round && st.winner === null) this.endTurn();
    }, Math.max(this.undo ? 1600 : 700, this.fxEnd - performance.now() + 200));
  }

  private endTurn(): void {
    const st = this.st!;
    clearTimeout(this.autoEndTimer);
    this.selected = null; this.mode = { type: 'idle' }; this.undo = null;
    // 番の始まりの毒なども演出に出す。おまかせどうしが速く進むときは省く
    this.perform([{ type: 'endTurn' }], this.human.size ? this.ownFx() : FX_SCALE[this.aiSpeed]);
    if (st.winner !== null) { this.finish(); return; }
    if (this.human.size || FX_SCALE[this.aiSpeed] > 0) play('turn');
    this.pushTurnLog();
    this.refresh();
    // 「開戦」は戦いの始めの1回だけ。番が替わったときは、だれの番かを小さく出す（おまかせどうしを速く進めているときは出さない）
    if (this.human.size || FX_SCALE[this.aiSpeed] > 0) this.splash(`${st.sideNames[st.turn]}の番`, true);
    this.maybeAi();
  }

  /** おまかせの陣営の番なら、少しずつ間を空けて動かす */
  private maybeAi(): void {
    const st = this.st!;
    clearTimeout(this.aiTimer);
    // 自分の番：おまかせにした駒だけを動かす（P44）
    if (st.winner === null && this.human.has(st.turn)) { this.runAutoUnits(); return; }
    if (st.winner !== null) return;
    const step = () => {
      if (!this.st || this.st !== st || st.winner !== null) return;
      const t0 = performance.now();
      let dur = 0;
      for (;;) {
        const acts = nextAiActions(st);
        if (acts[0]?.type === 'endTurn') { this.endTurn(); return; }
        const done = this.perform(acts, FX_SCALE[this.aiSpeed]);
        if (!done.ok) {
          const stuck = st.units.find((u) => u.alive && u.side === st.turn && canAct(st, u));
          if (stuck) apply(st, { type: 'wait', unit: stuck.id }); else { this.endTurn(); return; }
        }
        const moved = acts.find((a) => a.type !== 'endTurn') as { unit?: number } | undefined;
        this.inspect = moved?.unit ?? this.inspect;
        dur = done.dur;
        // 速さ5は演出が無いので、画面の1コマぶんの時間に入るだけ、まとめて手を進める（1手ごとに画面を書き換えて待つと、待ち時間ばかりになる）
        if (st.winner !== null || FX_SCALE[this.aiSpeed] !== 0 || performance.now() - t0 > 8) break;
      }
      this.refresh();
      if (st.winner !== null) { this.finish(); return; }
      // 演出が終わってから次の手に進む
      this.aiTimer = window.setTimeout(step, Math.max(AI_DELAY[this.aiSpeed], dur));
    };
    this.aiTimer = window.setTimeout(step, Math.min(400, AI_DELAY[this.aiSpeed] * 1.5));
  }

  /**
   * 観戦と手動の切り替え、速さのボタン。
   * 速いときは画面を1秒に何十回も書き換えるので、押している間に消えないよう、ほかの表示とは別に置いて必要なときだけ書き換える。
   */
  private renderCtl(): void {
    const box = this.root.querySelector<HTMLElement>('#ctl');
    if (!box) return;
    if (!this.st || this.st.winner !== null) { box.innerHTML = ''; return; }
    box.innerHTML = `
      ${this.st.autoPlan?.some(Boolean) ? `<details class="planfold" ${this.planOpen ? 'open' : ''}><summary data-tip="味方をおまかせで動かすときの動き方。押すと開いて切り替えられます">おまかせの方針：<b>${esc(planLabel(getPlan()))}</b></summary>${planPickerHtml(getPlan())}</details>` : ''}
      <button id="watch">${this.watching ? '手動にする' : '観戦にする'}</button>
      <span class="dim">速さ</span>${AI_DELAY.map((_d, i) => `<button data-speed="${i}" class="${i === this.aiSpeed ? 'on' : ''}">${i + 1}</button>`).join('')}
      <span class="vol"><span class="dim">音</span>${VOLUME_NAME.map((name, i) => `<button data-vol="${i}" class="${i === volume() ? 'on' : ''}">${name}</button>`).join('')}</span>
      <span class="vol"><span class="dim">曲</span>${BGM_LEVEL_NAME.map((name, i) => `<button data-bgm="${i}" class="${i === bgmLevel() ? 'on' : ''}">${name}</button>`).join('')}</span>
      <span class="lvl"><span class="dim">記録</span>${LOG_LEVEL_NAME.map((name, i) => `<button data-log="${i}" class="${i === this.logLevel ? 'on' : ''}" title="${['1件を1行で', 'だれがだれに、ダメージと体力', '計算式と途中の値まで'][i]}">${name}</button>`).join('')}</span>`;
    box.querySelectorAll<HTMLButtonElement>('[data-log]').forEach((b) => {
      // 切り替えたら、すでに出ている記録も、その細かさで出し直す
      b.onclick = () => { this.logLevel = Number(b.dataset.log); saveLogLevel(this.logLevel); this.renderCtl(); this.renderLog(); };
    });
    box.querySelectorAll<HTMLButtonElement>('[data-bgm]').forEach((b) => { b.onclick = () => { setBgmLevel(Number(b.dataset.bgm)); this.renderCtl(); }; });
    box.querySelectorAll<HTMLButtonElement>('[data-vol]').forEach((b) => {
      // 押したらすぐ1音鳴らして、大きさが分かるようにする
      b.onclick = () => { setVolume(Number(b.dataset.vol)); this.renderCtl(); play('turn'); };
    });
    box.querySelector<HTMLButtonElement>('#watch')!.onclick = () => this.setWatching(!this.watching);
    // おまかせの方針（P50）：味方の陣営に、すぐ当てる。狭い画面で場所を取らないよう、ふだんは畳んでおく
    const fold = box.querySelector<HTMLDetailsElement>('.planfold');
    if (fold) fold.ontoggle = () => { this.planOpen = fold.open; };
    wirePlanPicker(box, (p) => {
      const st = this.st;
      if (st?.autoPlan) st.autoPlan = st.autoPlan.map((x) => (x ? p : null)) as [AutoPlan | null, AutoPlan | null];
      toast(`おまかせの方針：${planLabel(p)}`);
      this.renderCtl(); this.refresh();
    });
    box.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.onclick = () => { this.aiSpeed = Number(b.dataset.speed); saveSpeed(this.aiSpeed); this.renderCtl(); };
    });
  }

  /** 観戦（両方おまかせ）と手動を切り替える。戦闘の途中でも切り替えられる */
  private setWatching(on: boolean): void {
    this.watching = on;
    this.renderCtl();
    // おまかせを外すと、全員がいったん手動になる（P44）
    this.autoUnits.clear(); clearTimeout(this.autoTimer);
    this.human = on ? new Set() : new Set(this.manual);
    this.selected = null; this.mode = { type: 'idle' }; this.undo = null;
    // 配置の途中で観戦にしたら、配置を終えて戦いを始める（配置の段階のまま相手が動き出し、手動に戻したときに配置の画面が出てしまわないように。P53）
    if (this.deploying) { this.startFighting(); return; }
    this.refresh();
    this.maybeAi();
  }

  private finish(): void {
    const st = this.st!;
    clearTimeout(this.aiTimer);
    if (this.finished) return;
    this.finished = true;
    this.renderCtl();
    const winner = st.winner!;
    // 自分が操作していた陣営が負けたときだけ、負けの音にする（観戦は勝ちの音）
    // 勝ち負けの短い曲。曲を切っているときは、効果音の短い音にする
    const won = this.watching || this.manual.has(winner);
    if (!jingle(`${won ? 'win' : 'lose'}_${this.variant}`)) play(won ? 'win' : 'lose', 350);
    const sum = this.battleDone?.(st) ?? null;
    this.refresh();
    // 最後の一手の演出（駒の移動など）が終わってから窓を出す（窓が出たあとに駒が動いて見えないように）
    const wait = Math.max(0, this.fxEnd - performance.now());
    const show = (): void => {
    if (this.st !== st) return;
    this.root.querySelector('.splash')?.remove();
    this.view?.clearFx();
    this.view?.draw();
    const box = document.createElement('div');
    box.className = 'result';
    // 自分が動かしていた陣営が負けたときだけ、負けの絵にする（観戦は勝った側の絵）
    const lost = !this.watching && !this.manual.has(winner);
    box.innerHTML = `
      ${bannerHtml(sceneUrl(lost ? 'defeat' : 'victory', this.variant))}
      <h2 class="brushed ${lost ? 'lost' : ''}">${esc(st.sideNames[winner])}の勝ち</h2>
      <p>${st.round > st.maxRounds ? `${st.maxRounds}巡を守り切った（時間切れ）` : `${st.round}巡で決着`}</p>
      ${sum ? `<div class="sides">${([0, 1] as const).map((s) => this.sideResult(sum, s)).join('')}</div>` : ''}
      <button class="primary">${esc(this.battleBack.label)}</button>`;
    this.root.querySelector('.battle')!.appendChild(box);
    box.querySelector('button')!.onclick = () => busy(`${this.battleBack.label}…`, () => { window.onkeydown = null; this.st = null; this.battleBack.fn(); });
    };
    if (wait > 0) window.setTimeout(show, wait + 80); else show();
  }

  /** 画面の真ん中に、筆の帯と大きな文字を一瞬だけ出す（開戦は大きく、番の交代は小さく短く） */
  private splash(text: string, turn = false): void {
    const frame = this.root.querySelector('.battle');
    if (!frame) return;
    frame.querySelector('.splash')?.remove();
    const el = document.createElement('div');
    el.className = turn ? 'splash turn' : 'splash';
    el.innerHTML = `<span>${esc(text)}</span>`;
    frame.appendChild(el);
    window.setTimeout(() => el.remove(), turn ? 1100 : 1700);
  }

  /** 戦いの結果を、陣営ごとにまとめる：倒された武将、失われた兵（だれの何の兵か）、レベルアップ */
  private sideResult(sum: BattleSummary, s: Side): string {
    const st = this.st!;
    const beaten = sum.beaten.filter((_n, i) => sum.beatenSides[i] === s);
    const lost = sum.lost.filter((l) => l.side === s);
    const ups = sum.levelUps.filter((l) => l.side === s);
    // 失われた兵は、率いていた武将ごとにまとめる（「織田信長：雑兵、弓足軽」）
    const byGeneral = new Map<string, string[]>();
    for (const l of lost) byGeneral.set(l.general, [...(byGeneral.get(l.general) ?? []), l.unit]);
    const lostText = [...byGeneral].map(([g, us]) => `${esc(g)}：${us.map(esc).join('、')}`).join('<br>');
    return `<div class="side" style="border-color:${SIDE_COLOR[s]}">
      <h3 style="color:${SIDE_COLOR[s]}">${s === 0 ? '攻め手' : '守り手'}　${esc(st.sideNames[s])}${sum.winner === s ? '（勝ち）' : ''}</h3>
      <p><span class="dim">倒された武将</span>　${beaten.length ? beaten.map(esc).join('、') : 'なし'}</p>
      <p><span class="dim">失われた兵</span>　${lost.length ? `${lost.length}隊<br>${lostText}` : 'なし'}</p>
      ${ups.length ? `<p><span class="dim">レベルアップ</span><br>${ups.map((l) => `${esc(l.name)} Lv${l.from} → Lv${l.to}`).join('<br>')}</p>` : ''}
    </div>`;
  }

  // ------------------------------------------------------------ 表示

  /**
   * 調べている敵の駒（選んだ・乗せた）が、次の番に動ける所と攻撃の届く所（P49）。
   * 自分の駒を選んでいるときは出さない（動かす操作の邪魔になるため）
   */
  private enemyReach(): { move: Set<number>; hit: Set<number> } | undefined {
    const st = this.st;
    if (!st || this.deploying || this.sel()) return undefined;
    const id = this.inspect ?? unitAt(st, this.hoverCell)?.id;
    const e = id !== undefined && id !== null ? st.units[id] : null;
    if (!e || !e.alive || this.human.has(e.side) || disabled(e)) return undefined;
    const g = st.map.grid;
    const move = new Set(reach(st, e, moveOf(e)).cells);
    move.add(e.pos);
    const hit = new Set<number>();
    for (const sid of e.skills) {
      const s = skillOf(sid);
      if (s.noDamage) continue;
      const [min, max] = skillRange(st, e, s);
      const from = s.afterMove ? move : new Set([e.pos]);
      for (const c of from) for (const t of g.range(c, max, min)) if (!move.has(t) && st.map.terrain[t] !== 'void') hit.add(t);
    }
    move.delete(e.pos);
    return { move, hit };
  }

  /** 状態の名前と効き目（小窓用） */
  private statusChip(id: string, turns: number): string {
    const good = GOOD_STATUS.has(id), name = `${STATUS_NAME[id as keyof typeof STATUS_NAME] ?? id}${turns > 0 ? `(${turns})` : ''}`;
    return `<span class="st ${good ? 'good' : BAD_STATUS.has(id) ? 'bad' : ''}" data-tip="${esc(`${good ? '▲よい状態' : '▼悪い状態'}：${name}\n${statusEffect(id)}`)}">${good ? '▲' : '▼'}${esc(name)}</span>`;
  }

  private unitCard(u: BUnit): string {
    const st = this.st!;
    const bar = (v: number, max: number, cls: string) => `<div class="bar ${cls}"><i style="width:${max ? Math.round(100 * v / max) : 0}%"></i><span>${v}/${max}</span></div>`;
    const statuses = u.statuses.map((s) => this.statusChip(s.id, s.turns));
    // 采配範囲外（P49）：その影響を書く
    if (outOfCommand(st, u)) {
      const oc = D.status.outOfCommand;
      statuses.push(`<span class="st bad" data-tip="${esc(`率いる武将の采配範囲の外にいます。武将の近くへ戻ると元に戻ります。`)}">▼采配範囲外（攻撃・防御${oc.atkDefPct}%、軍略で受けるダメージ+${oc.tacticDamagePct}%）</span>`);
    }
    const sm = supplyMultOf(st, u);
    if (sm !== 1) statuses.push(`<span class="st bad">▼飛び地（攻撃・防御${Math.round((sm - 1) * 100)}%）</span>`);
    const g = u.kind === 'general' ? this.gs!.generals[u.generalId] : null;
    const leaderId = u.kind === 'general' ? u.id : u.leader;
    const leader = st.units[leaderId];
    const gi = generalIndex(st).get(leaderId);
    const dot = gi !== undefined ? `<span class="gdot" style="background:${css(genColor(gi))}">${gi + 1}</span>` : '';
    // 配下（将なら率いる兵の一覧、兵なら率いる将）
    const men = u.kind === 'general' ? st.units.filter((t) => t.kind === 'troop' && t.leader === u.id) : [];
    const menLine = u.kind === 'general'
      ? `<div class="men">${dot}配下 ${men.filter((t) => t.alive).length}／${men.length}隊：${men.map((t) => `<span class="${t.alive ? '' : 'gone'}${t.alive && outOfCommand(st, t) ? ' out' : ''}">${esc(t.name)}${t.alive ? '' : '（倒れた）'}${t.alive && outOfCommand(st, t) ? '（範囲外）' : ''}</span>`).join('、') || 'なし'}</div>`
      : `<div class="men">${dot}${esc(leader?.name ?? '')}の配下${leader && !leader.alive ? '（将は倒れた）' : ''}</div>`;
    // 技・軍略（名前に乗せると説明）
    const skills = u.skills.map(skillOf).map((s) => {
      const [a, b] = skillRange(st, u, s);
      const mp = skillCost(u, s);
      return `<span class="sk" data-tip="${esc(skillTip(s))}">${this.taughtMark(s.id, u)}${esc(L(s.name))}<small>${s.power ? `威${s.power}` : ''}${a === b ? ` 射${b}` : ` 射${a}-${b}`}${mp ? ` 気${mp}` : ''}</small></span>`;
    });
    const tactics = u.tactics.map((id) => D.byTactic[id]).filter(Boolean).map((t) => `<span class="sk tac" data-tip="${esc(tacticTip(t))}">${this.taughtMark(t.id, u)}${esc(L(t.name))}<small>気${tacticCost(u, t)}</small></span>`);
    const enemy = !this.human.has(u.side) && this.human.size > 0;
    return `<div class="card" style="border-color:${SIDE_COLOR[u.side]}">
      <div><b>${esc(u.name)}</b> <span class="dim">${u.kind === 'general' ? kindName(u) : '兵'} Lv${u.level}${enemy ? '　<b class="foe">敵</b>' : ''}</span></div>
      ${menLine}
      ${bar(u.hp, u.maxHp, 'hp')}${u.maxMp ? bar(u.mp, u.maxMp, 'mp') : ''}
      <div class="stats">攻撃${Math.round(attackPower(st, u))} 防御${Math.round(defense(st, u))} ${T.int()}${intellect(u)} ${T.agi()}${agility(u)}
        移動${moveOf(u)} ${AFFINITY_NAME[affinityOf(u)]}${u.kind === 'general' ? ` 采配範囲${u.commandRange}` : ''}${u.acted && u.side === st.turn ? '（行動済み）' : ''}</div>
      ${this.modsHtml(u)}
      ${skills.length + tactics.length > ARTS_FLAT
        ? `<details class="sklfold"><summary>技${skills.length}・軍略${tactics.length}（押すと一覧）</summary><div class="skl">${[...skills, ...tactics].join('')}</div></details>`
        : `<div class="skl">${[...skills, ...tactics].join('')}</div>`}
      <div class="dim">${TERRAIN_NAME[st.map.terrain[u.pos]]}（命中・回避 ${terrainMod(st, u) >= 0 ? '+' : ''}${terrainMod(st, u)}${this.terrainNote(u)}）</div>
      ${g?.traits.length ? `<div class="dim">${g.traits.map((t) => TRAIT_NAME[t] ?? t).join('・')}</div>` : ''}
      ${this.personaLine(u)}
      ${statuses.length ? `<div class="status">${statuses.join(' ')}</div>` : ''}
      ${enemy && st.winner === null ? '<div class="dim small">地図の薄い朱は、この敵が次の番に動ける所、さらに薄い朱は攻撃が届く所</div>' : ''}
    </div>`;
  }

  /**
   * 能力の変化（P58）：いま変わっている能力ごとに、元の値 → いまの値と、原因・変化の値・残りの巡をすべて書く。
   * 戦いの始めに特性で変わったぶん（戦いの終わりまで）も書く
   */
  private modsHtml(u: BUnit): string {
    const st = this.st!;
    const STAT: Record<string, string> = { str: T.str(), int: T.int(), agi: T.agi(), def: '防御', hp: `最大${T.hp()}`, mp: `最大${T.mp()}`, move: '移動', heal: '回復の量', crit: '会心', counter: '反撃の威力', hit: '命中', evade: '回避', resist: '軍略への耐性', status: '状態の軍略の成功率', mpCost: '軍略の気力', supportCost: '味方への補助の気力' };
    const rows = statRows(st, u, (id) => STATUS_NAME[id] ?? id).map((r) => {
      const arrow = r.base !== r.now ? `${r.base} → <b class="${r.now > r.base ? 'up' : 'down'}">${r.now}</b>` : '';
      return `<li><span class="mk">${esc(r.key)}</span>${arrow ? ` ${arrow}` : ''}：${r.causes.map((c) => `${esc(c.why)} <b>${esc(c.value)}</b>${c.turns ? `<span class="dim">（${esc(c.turns)}）</span>` : ''}`).join('、')}</li>`;
    });
    const fx = (u.traitFx ?? []).map((f) => `<li><span class="mk">${esc(STAT[f.stat] ?? f.stat)}</span>${f.from !== undefined ? ` ${f.from} → <b class="${(f.to ?? 0) >= f.from ? 'up' : 'down'}">${f.to}</b>` : ''}：${f.why ? esc(f.why) : `特性（${f.traits.map((t) => esc(TRAIT_NAME[t] ?? t)).join('・') || '率いる将'}）`} <b>${esc(f.value)}</b><span class="dim">（戦いの終わりまで）</span></li>`);
    if (!rows.length && !fx.length) return '';
    return `<details class="mods" open><summary>能力の変化（${rows.length + fx.length}）</summary><ul>${rows.join('')}${fx.join('')}</ul></details>`;
  }

  /** 駒に乗せたとき（何も選んでいないとき）の短い説明（P49） */
  private unitBrief(t: BUnit): string {
    const st = this.st!;
    const enemy = !this.human.has(t.side) && this.human.size > 0;
    const sts = t.statuses.map((s) => `${GOOD_STATUS.has(s.id) ? '▲' : '▼'}${STATUS_NAME[s.id as keyof typeof STATUS_NAME] ?? s.id}`);
    if (outOfCommand(st, t)) sts.push('▼采配範囲外');
    // 能力の変化（P58）：短く、原因と値と残りの巡
    // 難しさで上がった能力（非常に難しい・鬼。P64）
    const lv = (t.traitFx ?? []).find((f) => f.why);
    if (lv) sts.push(`▲${lv.why}：体力・武力・知略${lv.value}（戦いの終わりまで）`);
    for (const r of statRows(st, t, (id) => STATUS_NAME[id] ?? id)) sts.push(`${r.key}${r.base !== r.now ? ` ${r.base}→${r.now}` : ''}（${r.causes.map((c) => `${c.why}${c.value}${c.turns ? `・${c.turns}` : ''}`).join('、')}）`);
    const lead = t.kind === 'troop' ? `${st.units[t.leader]?.name ?? ''}の配下` : kindName(t);
    const basic = basicSkill(t);
    const rng = basic ? skillRange(st, t, basic) : null;
    return `<div class="cellinfo"><b style="color:${SIDE_COLOR[t.side]}">${enemy ? '敵　' : ''}${esc(t.name)}</b> Lv${t.level}・${esc(lead)}<br>体力 ${t.hp}／${t.maxHp}${t.maxMp ? `・気力 ${t.mp}／${t.maxMp}` : ''}・攻撃${Math.round(attackPower(st, t))}・防御${Math.round(defense(st, t))}・移動${moveOf(t)}${rng ? `・射程${rng[0] === rng[1] ? rng[1] : `${rng[0]}〜${rng[1]}`}` : ''}${sts.length ? `<br>${sts.map(esc).join(' ')}` : ''}<br><span class="dim">押すと詳しく出ます</span></div>`;
  }

  /** 性格と、いまの構え（おまかせの陣営がどう動こうとしているか） */
  private personaLine(u: BUnit): string {
    const st = this.st!;
    const leader = st.units[u.leader];
    const plan = st.autoPlan?.[u.side];
    const STANCE = { advance: '前進', engage: '交戦', hold: '守備', retreat: '退却' } as const;
    const stance = st.winner === null && leader?.alive ? ` ／ 構え：${STANCE[stanceOf(st, u)]}` : '';
    if (plan) return `<div class="dim">おまかせの方針：${planLabel(plan)}${stance}<br><span class="small">（味方のおまかせは、性格ではなく方針で動く）</span></div>`;
    if (!leader?.persona) return '';
    return `<div class="dim">性格：${personalityLabel(leader.persona)}${u.kind === 'troop' ? '（率いる武将）' : ''}${stance}</div>`;
  }

  /** 季節と天気、その効果 */
  private skyLine(): string {
    const st = this.st!;
    const sky = { weather: st.weather ?? 'clear', night: !!st.night };
    const month = this.gs?.month;
    const when = month ? `${month}月（${SEASON_NAME[seasonOf(month)]}）　` : '';
    const fx = skyEffects(sky);
    // 天気の帯の絵を敷く。開戦のときと天気が変わったときは、一瞬だけ光らせて目立たせる
    const label = skyLabel(sky), url = artUrl(`bg/weather_${sky.weather}`);
    const flash = label !== this.lastSky;
    if (flash) {
      this.lastSky = label; this.skyFlashUntil = performance.now() + 1600;
      const st0 = this.st;
      window.setTimeout(() => { if (this.st === st0) this.refresh(); }, 1650);
    }
    const lit = performance.now() < this.skyFlashUntil;
    // 飛び地で戦う陣営（兵糧や援軍が届きにくく、攻撃・防御が下がる）
    const cut = ([0, 1] as Side[]).filter((s) => (st.supplyMult?.[s] ?? 1) !== 1)
      .map((s) => `${esc(st.sideNames[s])}は飛び地で戦う（攻撃・防御${Math.round(((st.supplyMult![s]) - 1) * 100)}%）`);
    // 天守の取り合い
    const hd = st.hold;
    const keep = hd ? [`${seatName(st.map.terrain[hd.cell])}：攻め手が${hd.need}巡押さえ続けるか、時間切れのとき押さえていれば攻め手の勝ち（いま${hd.count}／${hd.need}${holder(st) ? `・${esc(holder(st)!.name)}が押さえている` : ''}）`] : [];
    const lines = [...fx, ...cut, ...keep];
    return `<div class="sky ${lit ? 'flash' : ''} ${sky.night ? 'night' : ''}" id="sky" style="${url ? `--sky-bg:url('${url}')` : ''}">${when}天気：<b>${label}</b>${lines.length ? `<small>${lines.join('<br>')}</small>` : ''}</div>`;
  }

  /** いまいる地形の、命中・回避のほかの効果 */
  /** 乗せているマスの説明：自分の駒を選んでいれば、そこで起きること。選んでいなければ、地形と造り */
  private hoverCellHtml(): string {
    const st = this.st!, cell = this.hoverCell;
    if (cell < 0 || st.map.terrain[cell] === 'void') return '';
    const u = this.sel();
    if (u && this.isHumanTurn() && !this.deploying) {
      // 敵の駒に乗せていれば、その敵の短い説明も添える（P49）
      const foe = unitAt(st, cell);
      return this.cellInfo(u, cell) + (foe && foe.alive && foe.side !== u.side ? this.unitBrief(foe) : '');
    }
    const on = unitAt(st, cell);
    if (on && on.alive) return this.unitBrief(on);
    const hs = st.structures?.[cell];
    // 駒を選んでいないとき：地形の効き目（兵の得意地形で違うものは、範囲と内訳）
    const k = st.map.terrain[cell];
    const lines = this.terrainSummary(k);
    if (hs) lines.push(`造り：耐久 ${hs.hp}／${hs.max}${hs.closed ? '・攻め手は壊すまで通れない' : ''}`);
    if (st.hold && cell === st.hold.cell) lines.push(`${seatName(k)}（要のマス）：攻め手が${st.hold.need}巡いれば攻め手の勝ち`);
    return `<div class="cellinfo"><b>${TERRAIN_NAME[k]}</b>　${lines.map(esc).join('<br>')}</div>`;
  }

  /** 地形の効き目のまとめ（駒を選んでいないとき）：命中・回避と移動の手間は、得意地形ごとに違えば範囲と内訳。回復・櫓・攻撃の種類の強まる・弱まる */
  private terrainSummary(k: TerrainKind): string[] {
    const affs = Object.keys(AFFINITY_NAME), hm = D.terrain.hitMod[k] ?? {}, mc = D.terrain.moveCost[k] ?? {};
    const sg = (v: number): string => `${v >= 0 ? '+' : ''}${v}`;
    const out: string[] = [];
    const hits = affs.map((a) => hm[a as keyof typeof hm] ?? 0);
    if (hits.every((v) => v === hits[0])) out.push(`命中・回避 ${sg(hits[0])}（どの兵も同じ）`);
    else out.push(`命中・回避 ${sg(Math.min(...hits))}〜${sg(Math.max(...hits))}（${affs.map((a, i) => `${AFFINITY_NAME[a]}${sg(hits[i])}`).join('・')}。兵の得意地形で違う）`);
    const costs = affs.map((a) => mc[a as keyof typeof mc] ?? null);
    const fmtCost = (v: number | null): string => (v === null ? '入れない' : String(v));
    if (costs.every((v) => v === costs[0])) out.push(`移動の手間 ${fmtCost(costs[0])}（どの兵も同じ）`);
    else {
      const ok = costs.filter((v): v is number => v !== null);
      out.push(`移動の手間 ${ok.length ? `${Math.min(...ok)}〜${Math.max(...ok)}` : '入れない'}（${affs.map((a, i) => `${AFFINITY_NAME[a]}${fmtCost(costs[i])}`).join('・')}）`);
    }
    const regen = D.terrain.regen[k], perch = D.terrain.ranged[k];
    if (regen) out.push(`番の始めに体力${regen}%回復`);
    if (perch) out.push(`射程2以上の技は命中+${perch.hit}・射程+${perch.range}`);
    const fe = FIELD.terrain[k], fmt = (t?: Record<string, number>) => Object.entries(t ?? {}).map(([kk, v]) => `${L(FIELD.kinds[kk])}×${v}`).join('・');
    if (fe?.target) out.push(`ここにいて受ける${fmt(fe.target)}`);
    if (fe?.attacker) out.push(`ここから攻める${fmt(fe.attacker)}${FIELD.native[k] ? `（${AFFINITY_NAME[FIELD.native[k]] ?? ''}が得意な兵は弱まらない）` : ''}`);
    return out;
  }

  /** 駒を選んでいるとき、乗せたマスで起きること：行けるか、地形の命中・回避、回復、射程、攻撃の種類の強まる・弱まる、采配の外、造り */
  private cellInfo(u: BUnit, cell: number): string {
    const st = this.st!, k = st.map.terrain[cell];
    if (k === 'void') return '';
    const lines: string[] = [];
    const occ = unitAt(st, cell);
    const can = moveCells(st, u).includes(cell);
    const step = stepCost(st, u, cell);
    lines.push(cell === u.pos ? 'いまいるマス' : can ? 'ここへ移動できる' : step === null ? 'この兵は入れない地形' : occ ? `${occ.side === u.side ? '味方' : '敵'}（${esc(occ.name)}）がいる` : '移動力が足りず、この番には届かない');
    // ここに立ったとしての値（駒の位置を一時だけ動かして計る）
    const from = u.pos;
    u.pos = cell;
    const tm = terrainMod(st, u), note = this.terrainNote(u), out = u.kind === 'troop' && outOfCommand(st, u);
    u.pos = from;
    lines.push(`命中・回避 ${tm >= 0 ? '+' : ''}${tm}${note}`);
    if (out) lines.push(`采配範囲の外になる（攻撃・防御${D.status.outOfCommand.atkDefPct}%、軍略で受けるダメージ+${D.status.outOfCommand.tacticDamagePct}%）`);
    const hs = st.structures?.[cell];
    if (hs) lines.push(`造り：耐久 ${hs.hp}／${hs.max}${hs.closed ? '・攻め手は壊すまで通れない' : ''}`);
    if (st.hold && cell === st.hold.cell) lines.push(`${seatName(k)}（要のマス）：攻め手が${st.hold.need}巡いれば攻め手の勝ち`);
    return `<div class="cellinfo"><b>${TERRAIN_NAME[k]}</b>　${lines.map(esc).join('<br>')}</div>`;
  }

  private terrainNote(u: BUnit): string {
    const k = this.st!.map.terrain[u.pos];
    const notes: string[] = [];
    const regen = D.terrain.regen[k], perch = D.terrain.ranged[k];
    if (regen) notes.push(`番の始めに体力${regen}%回復`);
    if (perch) notes.push(`射程2以上の技は命中+${perch.hit}・射程+${perch.range}`);
    // 地形の、攻撃の種類ごとの強まる・弱まる（受けるとき・ここから攻めるとき）
    const fe = FIELD.terrain[k], fmt = (t?: Record<string, number>) => Object.entries(t ?? {}).map(([kk, v]) => `${L(FIELD.kinds[kk])}×${v}`).join('・');
    if (fe?.target) notes.push(`受ける${fmt(fe.target)}`);
    if (fe?.attacker) notes.push(`ここから攻める${fmt(fe.attacker)}${FIELD.native[k] === affinityOf(u) ? '（弱まりは得意地形なので無し）' : ''}`);
    return notes.length ? `、${notes.join('、')}` : '';
  }

  private skillLabel(s: SkillDef, u?: BUnit): string {
    const range = s.shape.type === 'around' ? `周囲${s.shape.n}` : s.shape.type === 'line' ? `直線${s.shape.n}` : s.range[0] === s.range[1] ? `射程${s.range[1]}` : `射程${s.range[0]}〜${s.range[1]}`;
    const mp = u ? skillCost(u, s) : s.mp;
    return `${this.taughtMark(s.id, u)}${L(s.name)} <small>威力${s.power || '-'} ${range}${mp ? ` 気${mp}` : ''}</small>`;
  }
  private tacticLabel(t: TacticDef, u?: BUnit): string {
    const range = t.range === null ? '' : t.area ? (t.range ? `射程${t.range}・範囲${t.area}` : `周囲${t.area}`) : `射程${t.range}`;
    return `${this.taughtMark(t.id, u)}${L(t.name)} <small>${t.power ? `威力${t.power} ` : ''}${range} 気${u ? tacticCost(u, t) : t.mp}</small>`;
  }
  /** 直伝の印（P68）：借り物は「借」（気力が多い・使った回数）、身についたものは「伝」 */
  private taughtMark(id: string, u?: BUnit): string {
    if (!u?.taught?.includes(id)) return '';
    const n = u.artUses?.[id] ?? 0;
    return u.borrowed?.includes(id)
      ? `<span class="tmark borrow" title="直伝の借り物：気力が${Math.round(((u.borrowMult ?? 1) - 1) * 100)}%多くかかる（この戦いで${n}回使った。合わせて${S.teach.masterUses}回で身につく）">借</span>`
      : '<span class="tmark" title="直伝済み（教わって身についた技・軍略）">伝</span>';
  }

  /** いま選んでいる技・軍略を、マウスのあるマスに使ったときの予測 */
  private forecast(): { text: string; area: Set<number> } {
    const st = this.st!, u = this.sel();
    const none = { text: '', area: new Set<number>() };
    if (!u || this.mode.type === 'idle' || this.hoverCell < 0) return none;
    if (this.mode.type === 'breach') {
      if (!breachTargets(st, u).includes(this.hoverCell)) return none;
      const s = st.structures![this.hoverCell], d = breachParts(st, u, this.hoverCell).base;
      return { text: `${TERRAIN_NAME[s.kind]}：およそ${d}（耐久 ${s.hp}／${s.max}）${d >= s.hp ? '・壊れる見込み' : `・あと${Math.ceil(s.hp / d)}回ほど`}`, area: new Set([this.hoverCell]) };
    }
    if (this.mode.type === 'skill') {
      const s = skillOf(this.mode.id);
      if (!skillTargetCells(st, u, s).includes(this.hoverCell)) return none;
      const vs = skillVictims(st, u, s, this.hoverCell);
      const lines = vs.map((t) => {
        const f = forecastSkill(st, u, s, t, basicSkill(t));
        const c = f.counter ? ` ／反撃 ${f.counter.damage}（${f.counter.hit}%）` : '';
        return `${esc(t.name)}${t.side === u.side ? '（味方）' : ''}：${s.noDamage ? '効果のみ' : `${f.damage} 命中${f.hit}% 期待値${Math.round((f.damage * f.hit) / 100)}`}${c}`;
      });
      return { text: lines.join('<br>') || '対象なし', area: new Set(vs.map((t) => t.pos)) };
    }
    const tac = D.byTactic[this.mode.id];
    if (!tacticTargetCells(st, u, tac).includes(this.hoverCell)) return none;
    const vs = tacticVictims(st, u, tac, this.hoverCell);
    const lines = vs.map((t) => {
      const who = `${esc(t.name)}${t.side === u.side && tacticSide(tac) !== 'ally' ? '（味方）' : ''}`;
      if (tac.kind === 'damage') return `${who}：${tacticDamage(st, u, tac, t)}`;
      if (tac.kind === 'heal') return `${who}：回復 ${Math.min(healAmount(u, tac.power), t.maxHp - t.hp)}`;
      if ((tac.kind === 'status' && !tac.sure) || tac.kind === 'displace') return `${who}：成功率 ${tacticSuccess(st, u, t)}%`;
      return who;
    });
    const area = tac.area > 0 ? new Set(st.map.grid.range(tac.range ? this.hoverCell : u.pos, tac.area)) : new Set(vs.map((t) => t.pos));
    return { text: lines.join('<br>') || '対象なし', area };
  }

  /**
   * 選んでいる技・軍略の説明と、届く相手ごとの見込み（ダメージ・命中・期待値）。
   * 指で触る画面には「重ねる」が無いので、ボタンを押したときにここで詳しく出す
   */
  private modeInfo(): string {
    const st = this.st!, u = this.sel();
    if (!u || this.mode.type === 'idle') return '';
    const pre = (t: string): string => `<div class="minfo">${esc(t)}</div>`;
    if (this.mode.type === 'breach') {
      const rows = breachTargets(st, u).map((c) => { const s = st.structures![c], d = breachParts(st, u, c).base; return `<tr><td>${TERRAIN_NAME[s.kind]}</td><td>${d}</td><td>${s.hp}／${s.max}</td><td>${d >= s.hp ? '壊れる' : `あと${Math.ceil(s.hp / d)}回`}</td></tr>`; });
      return `<table class="expect"><tr><th>造り</th><th>ダメージ</th><th>耐久</th><th>見込み</th></tr>${rows.join('')}</table>` + pre('通常攻撃で、門・砦の門・柵を打って壊します。ダメージ＝威力 × 攻撃 ÷ 造りの防御（石火矢・大筒の系統は2倍、火の攻撃は1.5倍）。門と砦の門は、壊すまで攻め手は通れません。');
    }
    if (this.mode.type === 'skill') {
      const s = skillOf(this.mode.id);
      const rows = skillTargetCells(st, u, s).map((cell) => unitAt(st, cell)).filter((t): t is BUnit => !!t && t.side !== u.side).map((t) => {
        const f = forecastSkill(st, u, s, t, basicSkill(t));
        return `<tr><td>${esc(t.name)}</td><td>${s.noDamage ? '—' : f.damage}</td><td>${f.hit}%</td><td><b>${s.noDamage ? '—' : Math.round((f.damage * f.hit) / 100)}</b></td><td>${f.counter ? `${f.counter.damage}（${f.counter.hit}%）` : '—'}</td></tr>`;
      });
      // 見込みの表を先に（スマホでは欄が狭いので、大事な方を上に）
      return (rows.length ? `<table class="expect"><tr><th>相手</th><th>ダメージ</th><th>命中</th><th>期待値</th><th>反撃</th></tr>${rows.join('')}</table>` : '') + pre(skillTip(s));
    }
    const tac = D.byTactic[this.mode.id];
    const seen = new Set<number>();
    const rows: string[] = [];
    for (const cell of tacticTargetCells(st, u, tac)) for (const t of tacticVictims(st, u, tac, cell)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const v = tac.kind === 'damage' ? `${tacticDamage(st, u, tac, t)}` : tac.kind === 'heal' ? `回復${Math.min(healAmount(u, tac.power), t.maxHp - t.hp)}` : (tac.kind === 'status' && !tac.sure) || tac.kind === 'displace' ? `成功${tacticSuccess(st, u, t)}%` : '効く';
      rows.push(`<tr><td>${esc(t.name)}${t.side === u.side ? '（味方）' : ''}</td><td>${v}</td></tr>`);
      if (rows.length >= 8) break;
    }
    return (rows.length ? `<table class="expect"><tr><th>相手</th><th>見込み</th></tr>${rows.join('')}</table>` : '') + pre(tacticTip(tac));
  }

  private refresh(panel = true): void {
    const st = this.st, view = this.view;
    if (!st || !view) return;
    const u = this.sel();
    const human = this.isHumanTurn();
    const fc = this.forecast();
    view.hl = {
      selected: this.selected ?? undefined,
      hover: this.hoverCell,
      move: this.deploying ? (u ? new Set(this.deployCells(u)) : undefined) : u && human && this.mode.type === 'idle' ? new Set(moveCells(st, u)) : undefined,
      target: u && human && this.mode.type !== 'idle'
        ? new Set(this.modeTargets(u))
        : undefined,
      area: fc.area.size ? fc.area : undefined,
      commandOf: u ? st.units[u.leader] : this.inspect !== null ? st.units[st.units[this.inspect].leader] : undefined,
      reach: this.enemyReach(),
      auto: this.autoUnits.size ? this.autoUnits : undefined,
      // 行動済みとして扱う駒（行動した・動けない・移動したあとで使える行動が無い）
      done: !this.deploying && st.winner === null ? new Set(st.units.filter((x) => x.alive && x.side === st.turn && this.unitDone(x)).map((x) => x.id)) : undefined,
    };
    view.draw();
    const fcBox = this.root.querySelector<HTMLElement>('#forecast');
    if (!panel && fcBox) {
      fcBox.innerHTML = fc.text;
      // マスに乗せたときの説明も、乗せるたびに書き換える
      const ci = this.root.querySelector<HTMLElement>('#cellinfo');
      if (ci) ci.innerHTML = this.hoverCellHtml();
      return;
    }

    const shown = u ?? (this.inspect !== null ? st.units[this.inspect] : null);
    let actions = '';
    if (this.deploying) {
      this.root.querySelector('#panel')!.innerHTML = `<div class="turn" style="background:${SIDE_COLOR[[...this.human][0] ?? 0]}">配置 <small>始める前に、並びを直せます</small></div>
        ${this.skyLine()}
        <div class="card">自分の駒を押してから、青いマス（自分の配置場所）を押すと動きます。自分の駒がいるマスなら入れ替わります。並べ終えたら「配置完了」を押すと、戦いが始まります。</div>
        ${shown ? this.unitCard(shown) : ''}
        <div class="foot"><button id="deployDone" class="primary">配置完了（戦闘開始）</button></div>`;
      const dd = this.root.querySelector<HTMLButtonElement>('#deployDone');
      if (dd) dd.onclick = () => this.startFighting();
      this.renderLog();
      return;
    }
    if (u && human) {
      const act = canAct(st, u);
      // 使えない行動は灰色にして、理由を添える。移動の直後は、使える行動を一瞬光らせる
      const notAct = !act ? (u.acted ? '行動済み' : '動けない状態') : '';
      const btn = (kind: 'skill' | 'tactic', id: string, label: string, why: string) =>
        `<button data-${kind}="${id}" ${why ? 'disabled' : ''} class="${this.mode.type === kind && this.mode.id === id ? 'on' : ''}${!why && this.flashActions ? ' flash' : ''}" data-tip="${esc(kind === 'skill' ? skillTip(skillOf(id)) : tacticTip(D.byTactic[id]))}${why ? esc(`（使えない：${why}）`) : ''}">${label}${why ? `<small class="why">${esc(why)}</small>` : ''}</button>`;
      // 技・軍略のボタン（数に上限は無い）。多いときは、使えるものを先に数個だけ出し、残りと使えないものは畳んでおく
      const arts = [
        ...u.skills.map((id) => {
          const s = skillOf(id);
          const why = notAct || (s.reload && !has(u, 'loaded') ? '装填していない（待機すると装填）' : u.mp < skillCost(u, s) ? '気力が足りない' : !canUseSkill(st, u, s) ? '今は使えない' : !skillTargetCells(st, u, s).length ? '届く所に相手がいない' : '');
          return { on: this.mode.type === 'skill' && this.mode.id === id, why, html: btn('skill', id, this.skillLabel(s, u), why) };
        }),
        ...u.tactics.map((id) => {
          const t = D.byTactic[id];
          const why = notAct || (u.mp < tacticCost(u, t) ? '気力が足りない' : has(u, 'silence') ? '軍略を封じられている' : !canUseTactic(u, t) ? '今は使えない' : !tacticTargetCells(st, u, t).length ? '届く所に相手がいない' : '');
          return { on: this.mode.type === 'tactic' && this.mode.id === id, why, html: btn('tactic', id, this.tacticLabel(t, u), why) };
        }),
      ];
      if (arts.length <= ARTS_FLAT) actions += `<div class="arts">${arts.map((a) => a.html).join('')}</div>`;
      else {
        const ok = arts.filter((a) => !a.why), off = arts.filter((a) => a.why);
        // 選んでいる技・軍略は、畳んだ中にあっても上に出す
        const first = ok.slice(0, ARTS_SHOW);
        for (const a of ok.slice(ARTS_SHOW)) if (a.on) first.push(a);
        const more = ok.filter((a) => !first.includes(a));
        actions += `<div class="arts">${first.map((a) => a.html).join('')}</div>`;
        if (more.length) actions += `<details class="arts-more" data-fold="more" ${this.artsFold.more ? 'open' : ''}><summary>ほかの技・軍略（${more.length}）</summary><div class="arts">${more.map((a) => a.html).join('')}</div></details>`;
        if (off.length) actions += `<details class="arts-more off" data-fold="off" ${this.artsFold.off ? 'open' : ''}><summary>${notAct ? `${esc(notAct)}：技・軍略（${off.length}）` : `今は使えない技・軍略（${off.length}）`}</summary><div class="arts">${off.map((a) => a.html).join('')}</div></details>`;
      }
      const br = act ? breachTargets(st, u) : [];
      if (br.length) actions += `<button data-breach="1" class="${this.mode.type === 'breach' ? 'on' : ''}" data-tip="届く所の門・砦の門・柵を通常攻撃で打って壊します。門と砦の門は、壊すまで攻め手は通れません。石火矢・大筒の系統は2倍、火の攻撃は1.5倍の力で壊します。壊れた門は道に、柵は平地になります。">壊す（門・柵） <small>${br.length}か所</small></button>`;
      // 部隊ごとの退却：初期配置のマスにいる武将だけ
      // 一部だけおまかせ（P44）
      actions += `<button id="autoUnit" data-tip="この駒を、コンピューターの考え方で動かします（自分の番の初めに自動で動く）">この駒をおまかせ</button>`;
      if (u.kind === 'general') actions += `<button id="autoGen" data-tip="この将と配下の兵を、すべてコンピューターの考え方で動かします">この将の配下をすべておまかせ</button>`;
      if (canWithdraw(st, u)) actions += `<button id="withdraw" data-tip="この武将と配下の兵が、戦場から必ず退きます。兵は失わず、深手にもなりません。武将は翌月いっぱい休養になります（守りの出陣だけできる）。自分の側の武将がみな退くと、この戦いは負けです">退却（この部隊）</button>`;
      // 装填の要る駒は、待機で矢・弾を込める（ボタンにも書く）
      const reloads = needsReload(u) && !has(u, 'loaded');
      actions += `<button id="wait" ${act ? '' : 'disabled'} class="${act && this.flashActions ? 'flash' : ''}" ${reloads ? 'data-tip="待機すると矢・弾を込めて「装填済み」になり、次の番から装填の要る技を撃てます"' : ''}>${reloads ? '待機（装填する）' : '待機'}${act ? '' : `<small class="why">${esc(notAct)}</small>`}</button>`;
      actions += `<button id="cancel">${this.mode.type !== 'idle' ? (this.mode.type === 'breach' ? '壊すのをやめる' : '技・軍略をやめる') : '選択を解く'}</button>`;
      if (this.undo && this.undo.unit === u.id && !u.acted) actions += `<button id="undo">移動を取り消す</button>`;
    }
    const cell = `<div id="cellinfo">${this.hoverCellHtml()}</div>`;
    // 指で操作するとき：駒を選ばずにマスを押したら、地形の説明を欄のいちばん上に出す（下だと送らないと見えない）
    const cellTop = this.coarse && !shown && this.hoverCell >= 0;
    this.root.querySelector('#panel')!.innerHTML = `
      <div class="turn" style="background:${SIDE_COLOR[st.turn]}">${esc(st.sideNames[st.turn])}の番 <small>${st.round}／${st.maxRounds}巡</small></div>
      ${cellTop ? cell : ''}
      ${this.skyLine()}
      ${shown ? this.unitCard(shown) : cellTop ? '' : '<div class="card dim">ユニットをクリックすると情報が出ます。<br>自軍のユニットを選び、青いマスで移動、技・軍略を選んで赤いマスで対象を決めます。<br>取り消しは「選択を解く」か、右クリック・Esc。<br>指で操作するときは、対象のマスを1度押すと見込みが出て、もう1度押すと実行します。</div>'}
      <div id="forecast">${fc.text}${this.coarse && fc.text && this.mode.type !== 'idle' ? '<br><span class="dim">同じマスをもう1度押すと実行</span>' : ''}</div>
      <div class="actions">${actions}</div>
      ${this.modeInfo()}
      ${cellTop ? '' : cell}
      <div class="foot">
        ${human && this.autoUnits.size ? `<button id="autoOff" data-tip="おまかせにした駒をやめて、全員を手動に戻します">おまかせを外す（全員手動・${this.autoUnits.size}隊）</button>` : ''}
        ${human ? '<button id="end" class="primary" data-tip="まだ動いていない自分の駒をすべて待機にして、自分の番を終えます">巡を終える（全員待機）</button>' : st.winner === null ? '<span class="dim">相手が行動中…</span>' : ''}
        ${st.winner !== null ? '' : this.allowQuit ? `<button id="quit">${esc(this.battleBack.label)}</button>` : `<button id="auto">おまかせで決着</button>${this.human.size === 1 ? '<button id="retreat" data-tip="この戦いから退きます。負けになり、重い罰があります（押すと説明が出ます）">退く</button>' : ''}`}
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((b) => { b.onclick = () => { this.mode = { type: 'skill', id: b.dataset.skill! }; this.autoTarget(); this.showInfo(); }; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tactic]').forEach((b) => { b.onclick = () => { this.mode = { type: 'tactic', id: b.dataset.tactic! }; this.autoTarget(); this.showInfo(); }; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-breach]').forEach((b) => { b.onclick = () => { this.mode = { type: 'breach', id: '' }; this.autoTarget(); this.showInfo(); }; });
    // 畳んだ技・軍略の欄：開け閉めを覚えておく（書き直しても、開いたまま）
    this.root.querySelectorAll<HTMLDetailsElement>('details[data-fold]').forEach((d) => { d.ontoggle = () => { this.artsFold[d.dataset.fold as 'more' | 'off'] = d.open; }; });
    const on = (id: string, fn: () => void) => { const b = this.root.querySelector<HTMLButtonElement>(id); if (b) b.onclick = fn; };
    on('#cancel', () => this.cancel());
    on('#wait', () => { this.act({ type: 'wait', unit: u!.id }); this.refresh(); });
    on('#autoUnit', () => { if (u) this.addAuto([u.id]); });
    on('#autoGen', () => { if (u) this.addAuto(st.units.filter((x) => x.alive && x.side === u.side && (x.id === u.id || x.leader === u.id)).map((x) => x.id)); });
    on('#autoOff', () => { this.autoUnits.clear(); clearTimeout(this.autoTimer); toast('おまかせを外しました（全員手動）'); this.refresh(); });
    on('#withdraw', async () => {
      const g = u!;
      const mine = st.units.filter((x) => x.alive && x.kind === 'general' && x.home === g.home && x.id !== g.id).length;
      const ok = await confirmBox(this.root.querySelector('.battle')!, {
        title: `${esc(g.name)}の部隊を退かせる`,
        body: `<p>${esc(g.name)}と配下の兵が、戦場から退きます。兵は失わず、深手にもなりません。${esc(g.name)}は翌月いっぱい休養になります（守りの出陣だけできます）。</p>${mine ? '' : '<p><b>最後の武将なので、退くとこの戦いは負けになります。</b></p>'}`,
        ok: '退却する', cancel: 'やめる', danger: !mine,
      });
      if (!ok || this.st !== st) return;
      this.selected = null;
      this.act({ type: 'withdraw', unit: g.id });
      this.refresh();
    });
    on('#undo', () => {
      clearTimeout(this.autoEndTimer);
      const x = this.undo!; const t = st.units[x.unit];
      t.pos = x.pos; t.moveSpent = x.moveSpent; t.moved = false; this.undo = null;
      // 取り消した移動は、記録からも消す
      const last = st.log[st.log.length - 1];
      if (last?.key === 'move' && last.vars.uid === t.id) { st.log.pop(); this.logView.reset(); }
      this.view?.clearFx(t.id);
      this.refresh();
    });
    // 巡を終える（全員待機）：まだ動ける駒があれば確かめてから、残りを待機にして番を終える（「番を終える」と「全員待機」をまとめた。P42）
    on('#end', async () => {
      const left = st.units.filter((x) => x.alive && x.side === st.turn && !this.unitDone(x));
      if (left.length) {
        const ok = await confirmBox(this.root.querySelector('.battle')!, { title: '巡を終える（全員待機）', body: `<p>まだ動ける駒が${left.length}隊あります（${left.slice(0, 6).map((x) => esc(x.name)).join('・')}${left.length > 6 ? ' ほか' : ''}）。すべて待機にして、この番を終えます。</p>`, ok: '巡を終える' });
        if (!ok || this.st !== st || st.winner !== null || !this.isHumanTurn()) return;
      }
      for (const x of st.units) if (x.alive && x.side === st.turn && canAct(st, x)) apply(st, { type: 'wait', unit: x.id });
      this.endTurn();
    });
    const frame = this.root.querySelector('.battle')!;
    on('#quit', async () => {
      if (!(await confirmBox(frame, { title: `${esc(this.battleBack.label)}`, body: '<p>この戦いをやめて戻ります。戦いの結果は残りません。</p>', ok: 'やめて戻る', cancel: '戦いを続ける', danger: true })) || this.st !== st) return;
      void busy(`${this.battleBack.label}…`, () => { clearTimeout(this.aiTimer); window.onkeydown = null; this.st = null; this.battleBack.fn(); });
    });
    on('#retreat', async () => {
      const side = [...this.human][0] as Side, R = S.retreat;
      const lose = side === 1 ? '<li>守っている領は、相手に取られる</li>' : '';
      // 初期配置のマスにいる部隊は、軽く退ける（翌月の休養だけ）。外にいる部隊には、これまでの重い罰
      const safe = st.units.filter((x) => x.alive && x.kind === 'general' && x.home === side && x.side === side && st.map.spawn[side].includes(x.pos));
      const outside = st.units.filter((x) => x.alive && x.kind === 'general' && x.home === side && !safe.includes(x));
      const ok = await confirmBox(frame, {
        title: '戦いから退く', danger: outside.length > 0,
        body: `<p>この戦いから退きます。<b>${esc(st.sideNames[side])}の負け</b>になります。${lose ? '守っている領は、相手に取られます。' : ''}</p>
          ${safe.length ? `<p>初期配置のマスにいる部隊（${safe.map((x) => esc(x.name)).join('・')}）は、兵を失わずに退けます。翌月いっぱい休養（守りの出陣だけできる）になります。</p>` : ''}
          ${outside.length ? `<p>初期配置のマスの外にいる部隊（${outside.map((x) => esc(x.name)).join('・')}）には、重い罰があります。</p>
          <ul class="small">${lose}<li>体力が${Math.round(R.troopLossBelowHp * 100)}%を切った兵は失う</li><li>ほかの兵も、${Math.round(R.troopLossChance * 100)}%の見込みで失う</li><li>兵糧の${R.supplyLossPct}%を失う</li><li>武将は${R.woundMonths}か月の深手を負う（戦えない）</li></ul>
          <p class="dim small">武将を初期配置のマスまで戻してから退けば、罰はほとんどありません（武将の「退却」でも、部隊ごとに退けます）。</p>` : ''}`,
        ok: '退く', cancel: '戦いを続ける',
      });
      if (!ok || this.st !== st || st.winner !== null) return;
      clearTimeout(this.aiTimer);
      for (const g of safe) if (g.alive) withdraw(st, g);
      st.retreat = side; st.winner = (1 - side) as Side;
      st.log.push({ key: 'retreatAll', vars: { side: st.sideNames[side], winner: st.sideNames[1 - side] } });
      this.selected = null; this.finish();
    });
    on('#auto', async () => {
      if (!(await confirmBox(frame, { title: 'おまかせで決着', body: '<p>ここから先は、両方の陣営をおまかせで動かして、すぐに決着をつけます。途中の動きは見られず、自分で動かすこともできなくなります。</p>', ok: 'おまかせで決着', cancel: '戦いを続ける' })) || this.st !== st) return;
      void busy('決着をつけています…', () => { clearTimeout(this.aiTimer); this.human = new Set(); this.view?.clearFx(); autoBattle(st); this.selected = null; this.finish(); });
    });
    this.renderLog();
  }

  /** 記録の欄。細かさ（簡易・通常・詳細）に合わせて出す。中身が変わったときだけ書き換えて、いちばん下まで送る */
  private renderLog(): void {
    const st = this.st, logEl = this.root.querySelector<HTMLElement>('#log');
    if (!st || !logEl) return;
    const html = this.logView.html(st, this.logLevel);
    // 詳細は行が増えるので、記録の欄を広げる（aside の lv0〜lv2 で高さを変える）
    const aside = logEl.parentElement!;
    if (aside.dataset.lv !== String(this.logLevel)) aside.dataset.lv = String(this.logLevel);
    else if (html === this.logHtml && logEl.childElementCount) return;
    this.logHtml = html;
    logEl.innerHTML = html;
    logEl.scrollTop = logEl.scrollHeight;
  }

  /** いま選んでいる技・軍略・「壊す」の対象に選べるマス */
  private modeTargets(u: BUnit): number[] {
    const st = this.st!;
    if (this.mode.type === 'skill') return skillTargetCells(st, u, skillOf(this.mode.id));
    if (this.mode.type === 'tactic') return tacticTargetCells(st, u, D.byTactic[this.mode.id]);
    if (this.mode.type === 'breach') return breachTargets(st, u);
    return [];
  }

  /** いま選んでいるものを、そのマスに使う行動 */
  private modeAction(u: BUnit, cell: number): Action | null {
    if (this.mode.type === 'skill') return { type: 'skill', unit: u.id, skill: this.mode.id, target: cell };
    if (this.mode.type === 'tactic') return { type: 'tactic', unit: u.id, tactic: this.mode.id, target: cell };
    if (this.mode.type === 'breach') return { type: 'breach', unit: u.id, target: cell };
    return null;
  }

  /** 対象が自分のマスだけの技・軍略（周囲に効くもの）は、同じボタンを2回押すと使える */
  private autoTarget(): void {
    const st = this.st!, u = this.sel();
    if (!u || this.mode.type === 'idle') return;
    const cells = this.modeTargets(u);
    if (this.mode.type !== 'breach' && cells.length === 1 && cells[0] === u.pos) {
      const a = this.modeAction(u, u.pos)!;
      // 同じボタンをもう一度押すと使う（1回目は、効く範囲と予測を見せるだけ）
      if (this.armed === this.mode.id) { this.armed = null; this.act(a); }
      else { this.armed = this.mode.id; this.hoverCell = u.pos; toast('自分の周りに使います。もう一度同じボタンを押すか、自分のマスをクリックしてください'); }
    } else this.armed = null;
    this.refresh();
  }
}
