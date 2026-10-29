// セーブと読み込みのメニュー：自動の枠、手動の枠、ファイルへの書き出しと読み込み。
// 枠の並びは rts-mons/web/src/save.js と hist-sim/src/ui/saves.ts にならう。

import { gunzip, gzip, idbDel, idbGet, idbPut } from '../persist/idb';
import { fromJSON, HexSaveError, SLOTS, summaryText, toJSON, type HexSave } from '../persist/save';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const key = (slot: string): string => `slot:${slot}`;

export async function readSlot(slot: string): Promise<HexSave | undefined> {
  try { return await idbGet<HexSave>(key(slot)); } catch { return undefined; }
}
export async function writeSlot(slot: string, s: HexSave): Promise<boolean> {
  try { await idbPut(key(slot), s); return true; } catch (e) { console.error(e); return false; }
}
export async function anySlot(): Promise<boolean> {
  for (const s of SLOTS) if (await readSlot(s)) return true;
  return false;
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

  const render = async () => {
    const rows: string[] = [];
    for (const slot of SLOTS) {
      const s = await readSlot(slot);
      const label = slot === 'auto' ? '自動' : `枠${slot}`;
      const info = s ? `${esc(summaryText(s))}<br><span class="dim">${new Date(s.savedAt).toLocaleString()}</span>` : '<span class="dim">空き</span>';
      rows.push(`<div class="slot"><b>${label}</b><div class="info">${info}</div><div>
        ${opts.current && slot !== 'auto' ? `<button data-save="${slot}">保存</button>` : ''}
        ${s ? `<button data-load="${slot}">読み込み</button>` : ''}
        ${s && slot !== 'auto' ? `<button data-del="${slot}">削除</button>` : ''}
      </div></div>`);
    }
    box.innerHTML = `<h2>${opts.current ? 'セーブ・読み込み' : 'つづきから'}</h2>
      <div class="slots">${rows.join('')}</div>
      <p>${opts.current ? '<button id="export">ファイルに書き出す</button> ' : ''}<label class="btn">ファイルから読み込む<input type="file" accept=".hexsim" hidden></label></p>
      <p class="error">${esc(note)}</p>
      <button id="closeMenu">閉じる</button>`;
    box.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((b) => {
      b.onclick = async () => { note = (await writeSlot(b.dataset.save!, opts.current!())) ? '' : '保存できませんでした'; await render(); };
    });
    box.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((b) => {
      b.onclick = async () => { const s = await readSlot(b.dataset.load!); if (s) { close(); opts.onLoad(s); } };
    });
    box.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.onclick = async () => { try { await idbDel(key(b.dataset.del!)); } catch { /* 消せなくても続ける */ } await render(); };
    });
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
    box.querySelector<HTMLButtonElement>('#closeMenu')!.onclick = close;
  };
  await render();
}
