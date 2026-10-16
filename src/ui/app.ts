// 画面：セーブの読み込み → 編成 → 戦闘 → 結果。

import { autoBattle, nextAiActions, stanceOf } from '../ai/ai';
import { personalityLabel, personalityOf } from '../ai/personality';
import { apply, canAct, canMove, moveCells } from '../battle/engine';
import { mapFromProvince } from '../battle/map';
import { applyBattleResult, type BattleSummary } from '../battle/result';
import { newCampaign, S, traitsOf, type Difficulty } from '../strategy/campaign';
import { CampaignScreen } from './campaignUi';
import { restore, type HexSave } from '../persist/save';
import { anySlot, openSaveMenu, readHexSaveFile } from './saveMenu';
import { createBattle, MAX_GENERALS } from '../battle/setup';
import type { Action, BUnit, BattleState, Side } from '../battle/types';
import { normalizeSave, readSaveFile, SaveError, type HSave } from '../bridge/histsim';
import { convert, generalsOf, variantOf } from '../convert/convert';
import type { GGeneral, GameStart } from '../convert/model';
import { D, L, setVariant } from '../data/db';
import type { SkillDef, TacticDef, Variant } from '../data/types';
import { BattleView, SIDE_COLOR, TERRAIN_NAME } from '../render/battleView';
import type { CrestSpec } from '../render/crest';
import { tint } from '../render/ink';
import { artUrl } from '../art/art';
import { bannerHtml, sceneUrl, setScene } from './scene';
import { confirmBox } from './confirm';
import { skillTip, tacticTip } from './describe';
import { initTips } from './tip';
import { busy } from './busy';
import { prewarm } from '../render/strategyView';
import { NationMap } from '../render/nationMap';

import {
  canUseSkill, canUseTactic, forecastSkill, healAmount, skillTargetCells, skillVictims, tacticDamage, tacticSide,
  tacticSuccess, tacticTargetCells, tacticVictims,
} from '../rules/combat';
import { unitAt } from '../rules/move';
import { affinityOf, agility, attackPower, basicSkill, defense, intellect, moveOf, outOfCommand, skillOf, supplyMultOf, terrainMod } from '../rules/stats';
import { AFFINITY_NAME, kindName, STATUS_NAME, T, TRAIT_NAME } from './text';
import { BattleLogView, loadLogLevel, LOG_LEVEL_NAME, saveLogLevel } from './battleLog';
import { SEASON_NAME, seasonOf, skyEffects, skyLabel } from '../battle/weather';
import { before, cues, notePath } from './battleFx';
import { initSound, play, setVolume, volume, VOLUME_NAME } from './sound';
import { BGM_LEVEL_NAME, bgm, bgmLevel, initBgm, jingle, setBgmLevel } from './bgm';

const SAMPLES: [string, string][] = [
  ['sengoku_fid5_1575', '日本の戦国 1575年'],
  ['shunju_fid5_259bc', '春秋戦国 前259年'],
  ['rome_fid3_212bc', 'ローマ 前212年'],
  ['invented_archipelago_y30', '架空の多島海 30年目'],
];
type Mode = { type: 'idle' } | { type: 'skill'; id: string } | { type: 'tactic'; id: string };
type Control = 'attack' | 'defend' | 'both' | 'watch';
/** おまかせの陣営が1手ごとに空ける間（ミリ秒）。速さ1〜5 */
const AI_DELAY = [900, 500, 260, 110, 0];
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
  private human = new Set<Side>([0]);
  private undo: { unit: number; pos: number; moveSpent: number } | null = null;
  private aiTimer = 0;
  /** 手動のときに操作する陣営（観戦に切り替えても覚えておく） */
  private manual = new Set<Side>([0]);
  private watching = false;
  /** おまかせの陣営が動く速さ（0〜4）。1手ごとの間は AI_DELAY */
  private aiSpeed = loadSpeed();
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
        <p>hist-sim のセーブ（.histsim）を読み込んで、その状態からヘックスの戦いを始めます。</p>
        <p><label class="btn">セーブファイルを選ぶ<input type="file" accept=".histsim,.json,.hexsim" hidden></label> <button id="continue" hidden>つづきから</button></p>
        <p class="dim">または、サンプルから始める</p>
        <p>${SAMPLES.map(([id, name]) => `<button data-sample="${id}">${name}</button>`).join(' ')}</p>
        <p><button data-help="intro">遊び方</button></p>
        <p class="error">${esc(error)}</p>
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
      this.variant = variantOf(save);
      this.rebuild();
    } catch (e) {
      this.titleScreen(e instanceof SaveError ? e.message : `読み込みに失敗しました：${e}`);
    }
  }

  /** 読み込んだ世界から作り直して、画面を出す（next：出す画面。名前の版を変えたときは、今の画面のまま） */
  private rebuild(next: 'mode' | 'nation' | 'local' = 'mode'): void {
    setVariant(this.variant);
    this.gs = convert(this.save!, { variant: this.variant });
    const facs = this.factionsBySize();
    this.setup.attacker = facs[0].id;
    this.setup.defender = (facs[1] ?? facs[0]).id;
    this.autoPick();
    if (!this.gs.factions[this.nation]) this.nation = facs[0].id;
    if (next === 'nation') this.nationScreen(); else if (next === 'local') this.setupScreen(); else this.modeScreen();
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
      ${L(c.name)} Lv${g.level}
      <span class="dim">${T.str()}${g.stats.str + c.mod.str} ${T.int()}${g.stats.int + c.mod.int} ${T.agi()}${g.stats.agi + c.mod.agi}
      ${T.hp()}${g.stats.hp + c.mod.hp} 采配${g.command}／${g.commandRange}${traits ? ` ・${traits}` : ''} ／ 性格：${personalityLabel(personalityOf(g.traits, g.ab))}</span><br>
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
          <select id="difficulty" title="戦略の難しさ：自分の収入と領の落ちにくさ、相手の攻めやすさが変わる">${(['easy', 'normal', 'hard'] as const).map((d) => `<option value="${d}" ${this.difficulty === d ? 'selected' : ''}>難しさ：${S.difficulty[d].name}</option>`).join('')}</select>
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
    this.root.querySelector<HTMLSelectElement>('#difficulty')!.onchange = (e) => { this.difficulty = (e.target as HTMLSelectElement).value as Difficulty; };
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
    q<HTMLButtonElement>('#start').onclick = () => {
      if (this.setup.attacker === this.setup.defender) { toast('攻め手と守り手に同じ勢力は選べません'); return; }
      if (!this.setup.picks[0].length || !this.setup.picks[1].length) { toast('武将を1人以上選んでください'); return; }
      void busy('戦場を用意しています…', () => this.startBattle());
    };
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
    this.refresh();
    this.splash('開戦');
    this.maybeAi();
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
    const u = this.sel();
    // 指で触る画面には「重ねる」が無いので、触ったマスを「重ねたマス」として扱う（地形や見込みが出る）
    const armed = touch && this.hoverCell === cell;
    if (touch) this.hoverCell = cell;
    if (u && this.isHumanTurn() && this.mode.type !== 'idle') {
      const targets = this.mode.type === 'skill' ? skillTargetCells(st, u, skillOf(this.mode.id)) : tacticTargetCells(st, u, D.byTactic[this.mode.id]);
      // 指のときは、1度目で見込みを出し、同じマスをもう1度押すと実行する
      if (touch && !armed && targets.includes(cell)) { this.refresh(); return; }
      if (targets.includes(cell)) {
        const a: Action = this.mode.type === 'skill' ? { type: 'skill', unit: u.id, skill: this.mode.id, target: cell } : { type: 'tactic', unit: u.id, tactic: this.mode.id, target: cell };
        this.act(a);
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
    } else { this.selected = null; this.inspect = null; }
    this.refresh();
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
    if (st.winner !== null) this.finish();
  }

  private endTurn(): void {
    const st = this.st!;
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
    if (st.winner !== null || this.human.has(st.turn)) return;
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
    box.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.onclick = () => { this.aiSpeed = Number(b.dataset.speed); saveSpeed(this.aiSpeed); this.renderCtl(); };
    });
  }

  /** 観戦（両方おまかせ）と手動を切り替える。戦闘の途中でも切り替えられる */
  private setWatching(on: boolean): void {
    this.watching = on;
    this.renderCtl();
    this.human = on ? new Set() : new Set(this.manual);
    this.selected = null; this.mode = { type: 'idle' }; this.undo = null;
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

  private unitCard(u: BUnit): string {
    const st = this.st!;
    const bar = (v: number, max: number, cls: string) => `<div class="bar ${cls}"><i style="width:${max ? Math.round(100 * v / max) : 0}%"></i><span>${v}/${max}</span></div>`;
    const statuses = u.statuses.map((s) => `${STATUS_NAME[s.id]}${s.turns > 0 ? `(${s.turns})` : ''}`);
    if (outOfCommand(st, u)) statuses.push('采配範囲外');
    const sm = supplyMultOf(st, u);
    if (sm !== 1) statuses.push(`飛び地（攻撃・防御${Math.round((sm - 1) * 100)}%）`);
    const g = u.kind === 'general' ? this.gs!.generals[u.generalId] : null;
    const leader = u.kind === 'troop' ? st.units[u.leader] : null;
    return `<div class="card" style="border-color:${SIDE_COLOR[u.side]}">
      <div><b>${esc(u.name)}</b> <span class="dim">${u.kind === 'general' ? kindName(u) : `${esc(leader?.name ?? '')}の兵`} Lv${u.level}</span></div>
      ${bar(u.hp, u.maxHp, 'hp')}${u.maxMp ? bar(u.mp, u.maxMp, 'mp') : ''}
      <div class="stats">攻撃${Math.round(attackPower(st, u))} 防御${Math.round(defense(st, u))} ${T.int()}${intellect(u)} ${T.agi()}${agility(u)}
        移動${moveOf(u)} ${AFFINITY_NAME[affinityOf(u)]}${u.kind === 'general' ? ` 采配範囲${u.commandRange}` : ''}</div>
      <div class="dim">${TERRAIN_NAME[st.map.terrain[u.pos]]}（命中・回避 ${terrainMod(st, u) >= 0 ? '+' : ''}${terrainMod(st, u)}${this.terrainNote(u)}）</div>
      ${g?.traits.length ? `<div class="dim">${g.traits.map((t) => TRAIT_NAME[t] ?? t).join('・')}</div>` : ''}
      ${this.personaLine(u)}
      ${statuses.length ? `<div class="status">${statuses.join('・')}</div>` : ''}
    </div>`;
  }

  /** 性格と、いまの構え（おまかせの陣営がどう動こうとしているか） */
  private personaLine(u: BUnit): string {
    const st = this.st!;
    const leader = st.units[u.leader];
    if (!leader?.persona) return '';
    const STANCE = { advance: '前進', engage: '交戦', hold: '守備', retreat: '退却' } as const;
    const stance = st.winner === null && leader.alive ? ` ／ 構え：${STANCE[stanceOf(st, u)]}` : '';
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
    const lines = [...fx, ...cut];
    return `<div class="sky ${lit ? 'flash' : ''} ${sky.night ? 'night' : ''}" id="sky" style="${url ? `--sky-bg:url('${url}')` : ''}">${when}天気：<b>${label}</b>${lines.length ? `<small>${lines.join('<br>')}</small>` : ''}</div>`;
  }

  /** いまいる地形の、命中・回避のほかの効果 */
  private terrainNote(u: BUnit): string {
    const k = this.st!.map.terrain[u.pos];
    const notes: string[] = [];
    const regen = D.terrain.regen[k], perch = D.terrain.ranged[k];
    if (regen) notes.push(`番の始めに体力${regen}%回復`);
    if (perch) notes.push(`射程2以上の技は命中+${perch.hit}・射程+${perch.range}`);
    return notes.length ? `、${notes.join('、')}` : '';
  }

  private skillLabel(s: SkillDef): string {
    const range = s.shape.type === 'around' ? `周囲${s.shape.n}` : s.shape.type === 'line' ? `直線${s.shape.n}` : s.range[0] === s.range[1] ? `射程${s.range[1]}` : `射程${s.range[0]}〜${s.range[1]}`;
    return `${L(s.name)} <small>威力${s.power || '-'} ${range}${s.mp ? ` 気${s.mp}` : ''}</small>`;
  }
  private tacticLabel(t: TacticDef): string {
    const range = t.range === null ? '' : t.area ? (t.range ? `射程${t.range}・範囲${t.area}` : `周囲${t.area}`) : `射程${t.range}`;
    return `${L(t.name)} <small>${t.power ? `威力${t.power} ` : ''}${range} 気${t.mp}</small>`;
  }

  /** いま選んでいる技・軍略を、マウスのあるマスに使ったときの予測 */
  private forecast(): { text: string; area: Set<number> } {
    const st = this.st!, u = this.sel();
    const none = { text: '', area: new Set<number>() };
    if (!u || this.mode.type === 'idle' || this.hoverCell < 0) return none;
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
      move: u && human && this.mode.type === 'idle' ? new Set(moveCells(st, u)) : undefined,
      target: u && human && this.mode.type !== 'idle'
        ? new Set(this.mode.type === 'skill' ? skillTargetCells(st, u, skillOf(this.mode.id)) : tacticTargetCells(st, u, D.byTactic[this.mode.id]))
        : undefined,
      area: fc.area.size ? fc.area : undefined,
      commandOf: u ? st.units[u.leader] : this.inspect !== null ? st.units[st.units[this.inspect].leader] : undefined,
    };
    view.draw();
    const fcBox = this.root.querySelector<HTMLElement>('#forecast');
    if (!panel && fcBox) { fcBox.innerHTML = fc.text; return; }

    const shown = u ?? (this.inspect !== null ? st.units[this.inspect] : null);
    let actions = '';
    if (u && human) {
      const act = canAct(st, u);
      const btn = (kind: 'skill' | 'tactic', id: string, label: string, ok: boolean) =>
        `<button data-${kind}="${id}" ${ok ? '' : 'disabled'} class="${this.mode.type === kind && this.mode.id === id ? 'on' : ''}" data-tip="${esc(kind === 'skill' ? skillTip(skillOf(id)) : tacticTip(D.byTactic[id]))}">${label}</button>`;
      actions += u.skills.map((id) => { const s = skillOf(id); return btn('skill', id, this.skillLabel(s), act && canUseSkill(st, u, s) && skillTargetCells(st, u, s).length > 0); }).join('');
      actions += u.tactics.map((id) => { const t = D.byTactic[id]; return btn('tactic', id, this.tacticLabel(t), act && canUseTactic(u, t) && tacticTargetCells(st, u, t).length > 0); }).join('');
      actions += `<button id="wait" ${act ? '' : 'disabled'}>待機</button>`;
      actions += `<button id="cancel">${this.mode.type !== 'idle' ? '技・軍略をやめる' : '選択を解く'}</button>`;
      if (this.undo && this.undo.unit === u.id && !u.acted) actions += `<button id="undo">移動を取り消す</button>`;
    }
    const cell = this.hoverCell >= 0 ? `<div class="dim">マス：${TERRAIN_NAME[st.map.terrain[this.hoverCell]]}</div>` : '';
    this.root.querySelector('#panel')!.innerHTML = `
      <div class="turn" style="background:${SIDE_COLOR[st.turn]}">${esc(st.sideNames[st.turn])}の番 <small>${st.round}／${st.maxRounds}巡</small></div>
      ${this.skyLine()}
      ${shown ? this.unitCard(shown) : '<div class="card dim">ユニットをクリックすると情報が出ます。<br>自軍のユニットを選び、青いマスで移動、技・軍略を選んで赤いマスで対象を決めます。<br>取り消しは「選択を解く」か、右クリック・Esc。<br>指で操作するときは、対象のマスを1度押すと見込みが出て、もう1度押すと実行します。</div>'}
      <div id="forecast">${fc.text}${this.coarse && fc.text && this.mode.type !== 'idle' ? '<br><span class="dim">同じマスをもう1度押すと実行</span>' : ''}</div>
      <div class="actions">${actions}</div>
      ${this.modeInfo()}
      ${cell}
      <div class="foot">
        ${human ? `<button id="end" class="primary">ターン終了</button><button id="waitAll" ${st.units.some((x) => x.alive && x.side === st.turn && canAct(st, x)) ? '' : 'disabled'} data-tip="まだ動いていない自分の兵を、すべて待機にします（そのあと「ターン終了」を押します）">全員待機</button>` : st.winner === null ? '<span class="dim">相手が行動中…</span>' : ''}
        ${st.winner !== null ? '' : this.allowQuit ? `<button id="quit">${esc(this.battleBack.label)}</button>` : '<button id="auto">おまかせで決着</button>'}
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((b) => { b.onclick = () => { this.mode = { type: 'skill', id: b.dataset.skill! }; this.autoTarget(); this.showInfo(); }; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tactic]').forEach((b) => { b.onclick = () => { this.mode = { type: 'tactic', id: b.dataset.tactic! }; this.autoTarget(); this.showInfo(); }; });
    const on = (id: string, fn: () => void) => { const b = this.root.querySelector<HTMLButtonElement>(id); if (b) b.onclick = fn; };
    on('#cancel', () => this.cancel());
    on('#wait', () => { this.act({ type: 'wait', unit: u!.id }); this.refresh(); });
    on('#undo', () => {
      const x = this.undo!; const t = st.units[x.unit];
      t.pos = x.pos; t.moveSpent = x.moveSpent; t.moved = false; this.undo = null;
      // 取り消した移動は、記録からも消す
      const last = st.log[st.log.length - 1];
      if (last?.key === 'move' && last.vars.uid === t.id) { st.log.pop(); this.logView.reset(); }
      this.view?.clearFx(t.id);
      this.refresh();
    });
    on('#end', () => this.endTurn());
    on('#waitAll', async () => {
      const left = st.units.filter((x) => x.alive && x.side === st.turn && canAct(st, x));
      if (!left.length) return;
      const ok = await confirmBox(this.root.querySelector('.battle')!, { title: '全員待機', body: `<p>まだ動いていない${left.length}隊を、すべて待機にします。待機した隊は、このターンはもう動けません。</p>`, ok: '全員待機' });
      if (!ok || this.st !== st) return;
      for (const x of left) if (x.alive && canAct(st, x)) apply(st, { type: 'wait', unit: x.id });
      this.selected = null; this.mode = { type: 'idle' }; this.undo = null;
      this.refresh();
    });
    const frame = this.root.querySelector('.battle')!;
    on('#quit', async () => {
      if (!(await confirmBox(frame, { title: `${esc(this.battleBack.label)}`, body: '<p>この戦いをやめて戻ります。戦いの結果は残りません。</p>', ok: 'やめて戻る', cancel: '戦いを続ける', danger: true })) || this.st !== st) return;
      void busy(`${this.battleBack.label}…`, () => { clearTimeout(this.aiTimer); window.onkeydown = null; this.st = null; this.battleBack.fn(); });
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

  /** 対象が自分のマスだけの技・軍略（周囲に効くもの）は、同じボタンを2回押すと使える */
  private autoTarget(): void {
    const st = this.st!, u = this.sel();
    if (!u || this.mode.type === 'idle') return;
    const cells = this.mode.type === 'skill' ? skillTargetCells(st, u, skillOf(this.mode.id)) : tacticTargetCells(st, u, D.byTactic[this.mode.id]);
    if (cells.length === 1 && cells[0] === u.pos) {
      const a: Action = this.mode.type === 'skill' ? { type: 'skill', unit: u.id, skill: this.mode.id, target: u.pos } : { type: 'tactic', unit: u.id, tactic: this.mode.id, target: u.pos };
      // 同じボタンをもう一度押すと使う（1回目は、効く範囲と予測を見せるだけ）
      if (this.armed === this.mode.id) { this.armed = null; this.act(a); }
      else { this.armed = this.mode.id; this.hoverCell = u.pos; toast('自分の周りに使います。もう一度同じボタンを押すか、自分のマスをクリックしてください'); }
    } else this.armed = null;
    this.refresh();
  }
}
