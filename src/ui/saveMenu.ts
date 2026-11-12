// セーブと読み込みのメニュー：自動の枠、手動の枠（数に限りなし。1ページ10枠）、ファイルへの書き出しと読み込み。
// 枠の並びは rts-mons/web/src/save.js と hist-sim/src/ui/saves.ts にならう。

import { gunzip, gzip } from '../persist/idb';
import { AUTO_SLOT, fromJSON, HexSaveError, summaryText, toJSON, type HexSave } from '../persist/save';
import { failReport, loadSlot, removeSlot, saveSlot, slotMetas, type SaveResult, type SlotMeta } from '../persist/slots';

export type { SlotMeta } from '../persist/slots';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** 保存した日時（端末の時刻で「2026/11/3 11:53」） */
function savedAtText(iso: string): string {
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** 一覧の1ページに出す手動の枠の数 */
export const SLOTS_PER_PAGE = 10;

export const readSlot = (slot: string): Promise<HexSave | undefined> => loadSlot(slot);
/** 枠に保存する（make：いまの状態のセーブを作る）。失敗したら、分類したコードと端末の情報を返す（P124） */
export const writeSlot = (slot: string, make: HexSave | (() => HexSave)): Promise<SaveResult> => saveSlot(slot, typeof make === 'function' ? make : () => make);
export const deleteSlot = (slot: string): Promise<void> => removeSlot(slot);
/** 入っている枠の控え。自動の枠を先に、手動の枠は新しく保存した順 */
export async function listSlots(): Promise<SlotMeta[]> {
  return (await slotMetas()).sort((a, b) => (a.slot === AUTO_SLOT ? -1 : b.slot === AUTO_SLOT ? 1 : b.savedAt.localeCompare(a.savedAt)));
}
/** 新しい手動の枠の名前（今ある番号のいちばん大きいもの＋1） */
export function nextSlotName(slots: readonly string[]): string {
  return String(slots.reduce((m, s) => (/^\d+$/.test(s) ? Math.max(m, Number(s)) : m), 0) + 1);
}
export async function anySlot(): Promise<boolean> {
  return (await slotMetas()).length > 0;
}

/** 保存に失敗したときの知らせ（コード・試した手・端末の情報。写せる） */
async function failHtml(r: SaveResult): Promise<string> {
  if (r.ok) return '';
  const { title, text } = await failReport(r.fail);
  return `<div class="savefail"><b>${esc(title)}</b>
    <details><summary>詳しく（この内容を写して知らせてください）</summary><pre class="savediag">${esc(text)}</pre></details>
    <button data-copydiag>内容を写す</button> <span class="dim small">「ファイルに書き出す」なら、端末にファイルとして残せます</span></div>`;
}

/** .hexsim ファイル（gzip）を読む */
export async function readHexSaveFile(file: Blob): Promise<HexSave> {
  let text: string;
  try { text = await gunzip(file); } catch { throw new HexSaveError('セーブを展開できませんでした（.hexsim ファイルではありません）'); }
  return fromJSON(text);
}

export interface SaveMenuOptions {
  /** いまの状態のセーブを作る。渡さなければ読み込み専用のメニューになる */
  current?: () => HexSave;
  onLoad: (s: HexSave) => void;
}

export async function openSaveMenu(parent: HTMLElement, opts: SaveMenuOptions): Promise<void> {
  parent.querySelector('.savemenu')?.remove();
  const box = document.createElement('div');
  box.className = 'result savemenu';
  parent.appendChild(box);
  const close = () => box.remove();
  let note = '';
  /** 保存の結果（失敗の知らせ、または縮めて入れたときの断り） */
  let saved = '';
  const afterSave = async (r: SaveResult): Promise<void> => {
    note = '';
    saved = r.ok ? (r.via === 'idb' ? '' : `<p class="dim small">保存しました（${r.via === 'packed' ? 'ブラウザ内の保存に、縮めた形で' : '端末の保存（localStorage）に、縮めた形で'}）。</p>`) : await failHtml(r);
    if (!r.ok) console.error('save failed', r.fail);
  };

  let page = 0;

  const render = async () => {
    const all = await listSlots();
    const auto = all.find((m) => m.slot === AUTO_SLOT);
    const manual = all.filter((m) => m.slot !== AUTO_SLOT);
    const pages = Math.max(1, Math.ceil(manual.length / SLOTS_PER_PAGE));
    page = Math.min(page, pages - 1);
    const row = (m: SlotMeta): string => {
      const isAuto = m.slot === AUTO_SLOT;
      return `<div class="slot"><b>${isAuto ? '自動' : `枠${esc(m.slot)}`}</b><div class="info">${esc(summaryText(m))} <span class="dim">${savedAtText(m.savedAt)}</span></div><div>
        ${opts.current && !isAuto ? `<button data-save="${esc(m.slot)}">上書き</button>` : ''}
        <button data-load="${esc(m.slot)}">読み込み</button>
        ${isAuto ? '' : `<button data-del="${esc(m.slot)}">削除</button>`}
      </div></div>`;
    };
    const shown = manual.slice(page * SLOTS_PER_PAGE, (page + 1) * SLOTS_PER_PAGE);
    const nav = pages > 1 ? `<div class="slotnav"><button id="prevPage" ${page ? '' : 'disabled'}>‹ 前</button><span>${page + 1} / ${pages}</span><button id="nextPage" ${page < pages - 1 ? '' : 'disabled'}>次 ›</button></div>` : '';
    box.innerHTML = `<h2>${opts.current ? 'セーブ・読み込み' : 'つづきから'}</h2>
      ${opts.current ? '<p><button id="saveNew">新しい枠に保存</button> <span class="dim small">枠の数に限りはありません</span></p>' : ''}
      <div class="slots">${auto ? row(auto) : ''}${shown.map(row).join('')}${!auto && !manual.length ? '<div class="slot"><span></span><div class="info dim">セーブはまだありません</div><div></div></div>' : ''}</div>
      ${nav}
      <p>${opts.current ? '<button id="export">ファイルに書き出す</button> ' : ''}<label class="btn">ファイルから読み込む<input type="file" accept=".hexsim" hidden></label></p>
      ${saved}<p class="error">${esc(note)}</p>
      <button id="closeMenu">閉じる</button>`;
    const saveNew = box.querySelector<HTMLButtonElement>('#saveNew');
    if (saveNew) saveNew.onclick = async () => {
      saveNew.disabled = true;
      await afterSave(await writeSlot(nextSlotName(all.map((m) => m.slot)), opts.current!));
      page = 0;
      await render();
    };
    box.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`枠${b.dataset.save}に上書きします。よろしいですか？`)) return;
        await afterSave(await writeSlot(b.dataset.save!, opts.current!));
        page = 0;
        await render();
      };
    });
    box.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((b) => {
      b.onclick = async () => { const s = await readSlot(b.dataset.load!); if (s) { close(); opts.onLoad(s); } };
    });
    box.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`枠${b.dataset.del}を消します。よろしいですか？`)) return;
        await deleteSlot(b.dataset.del!);
        await render();
      };
    });
    const prev = box.querySelector<HTMLButtonElement>('#prevPage'), next = box.querySelector<HTMLButtonElement>('#nextPage');
    if (prev) prev.onclick = () => { page--; void render(); };
    if (next) next.onclick = () => { page++; void render(); };
    const exp = box.querySelector<HTMLButtonElement>('#export');
    if (exp) exp.onclick = async () => {
      const s = opts.current!();
      const blob = await gzip(toJSON(s));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hex-sim_${s.summary.faction}_${s.summary.year}_${s.summary.month}.hexsim`.replace(/[\\/:*?"<>|\s]+/g, '_');
      // 文書に付けてから押す（付けないと、ファイル名が付かないブラウザがある）
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const file = box.querySelector<HTMLInputElement>('input[type=file]')!;
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      try { const s = await readHexSaveFile(f); close(); opts.onLoad(s); }
      catch (e) { note = e instanceof Error ? e.message : String(e); await render(); }
    };
    const copy = box.querySelector<HTMLButtonElement>('[data-copydiag]');
    if (copy) copy.onclick = async () => {
      const text = box.querySelector('.savediag')?.textContent ?? '';
      try { await navigator.clipboard.writeText(text); copy.textContent = '写しました'; }
      catch { const d = box.querySelector<HTMLDetailsElement>('.savefail details'); if (d) d.open = true; copy.textContent = '開いた内容を長押しで選んで写してください'; }
    };
    box.querySelector<HTMLButtonElement>('#closeMenu')!.onclick = close;
  };
  await render();
}
