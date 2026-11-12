// セーブの枠の入れ物（P124）：IndexedDB にそのまま → だめなら縮めて IndexedDB に → それもだめなら端末の保存（localStorage）に縮めて。
// 失敗したら、どの段階で何の誤りだったかをコード（SV-◯◯）にまとめ、端末の情報と一緒に返す（画面に出して、写せるようにする）。

import pkg from '../../package.json';
import { gunzip, gzip, idbDel, idbGet, idbKeys, idbPut, IdbError } from './idb';
import { fromJSON, toJSON, type HexSave } from './save';

export interface SlotMeta { slot: string; summary: HexSave['summary']; savedAt: string; via?: SaveVia }
/** どの形で入れたか：idb＝そのまま、packed＝縮めて IndexedDB、local＝縮めて端末の保存（localStorage） */
export type SaveVia = 'idb' | 'packed' | 'local';

/** 失敗の分類（画面に出すコード） */
export const SAVE_CODES = {
  'SV-10': 'この端末のブラウザでは、ブラウザ内の保存（IndexedDB）が使えません（プライベートブラウズ・設定で止められている など）',
  'SV-11': 'ブラウザ内の保存（IndexedDB）を開けませんでした',
  'SV-12': 'ほかのタブがこのゲームを開いていて、保存の場所を使えません（ほかのタブを閉じてください）',
  'SV-20': '保存の容量が足りません（端末の空きか、ブラウザがこのページに許す量を超えました）',
  'SV-30': 'セーブの中身を、ブラウザ内の保存の形に直せませんでした（データの形の誤り）',
  'SV-40': '書き込みが途中で取り消されました',
  'SV-41': '書き込みで誤りが起きました',
  'SV-50': 'セーブを作れませんでした（ゲームの状態の誤り）',
  'SV-60': '端末の保存（localStorage）にも入りませんでした',
  'SV-70': '保存したはずなのに、読み戻せませんでした（保存の場所から一覧に出てこない）',
  'SV-90': '分からない誤りです',
} as const;
export type SaveCode = keyof typeof SAVE_CODES;

/** 試した1つの手と、その結果 */
export interface SaveTry { via: SaveVia | 'snapshot'; ok: boolean; code?: SaveCode; err?: string }
export interface SaveFail { code: SaveCode; tries: SaveTry[]; size?: number }
export type SaveResult = { ok: true; via: SaveVia; tries: SaveTry[] } | { ok: false; fail: SaveFail };

const key = (slot: string): string => `slot:${slot}`;
const metaKey = (slot: string): string => `meta:${slot}`;
/** localStorage の鍵（ほかのページと混ざらないよう頭に印） */
const LS = 'hexsim.';
/** 端末の保存に入れた枠の名前の一覧（鍵を数えて探さなくても読めるように。P125） */
const LS_INDEX = LS + 'index';
function localIndex(): string[] {
  try { const v = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
function setLocalIndex(list: string[]): void {
  try { localStorage.setItem(LS_INDEX, JSON.stringify([...new Set(list)])); } catch { /* 一覧が書けなくても、鍵を数えて探す */ }
}

/** 縮めた形（IndexedDB に入れる） */
interface Packed { packed: 'gzip'; bytes: Uint8Array }
const isPacked = (v: unknown): v is Packed => !!v && typeof v === 'object' && (v as Packed).packed === 'gzip';

/** 誤りを分類する（step：どの手のときか） */
export function classify(e: unknown, via: SaveVia | 'snapshot'): { code: SaveCode; err: string } {
  if (via === 'snapshot') return { code: 'SV-50', err: errText(e) };
  const name = e instanceof IdbError ? e.errName : (e as DOMException)?.name ?? '';
  const step = e instanceof IdbError ? e.step : '';
  let code: SaveCode = 'SV-90';
  if (/Quota/i.test(name) || (e as DOMException)?.code === 22) code = 'SV-20';
  else if (via === 'local') code = 'SV-60';
  else if (step === 'missing' || name === 'SecurityError' || name === 'NotSupported') code = 'SV-10';
  else if (step === 'blocked') code = 'SV-12';
  else if (step === 'open') code = 'SV-11';
  else if (name === 'DataCloneError') code = 'SV-30';
  else if (step === 'abort' || name === 'AbortError') code = 'SV-40';
  else if (step === 'request' || step === 'tx') code = 'SV-41';
  return { code, err: errText(e) };
}
function errText(e: unknown): string {
  if (e instanceof IdbError) return `${e.step}／${e.errName}：${e.message}`;
  if (e instanceof Error) return `${(e as DOMException).name ?? 'Error'}：${e.message}`;
  return String(e);
}

const b64 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string): Uint8Array => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

async function pack(s: HexSave): Promise<Uint8Array> {
  return new Uint8Array(await (await gzip(toJSON(s))).arrayBuffer());
}
async function unpack(bytes: Uint8Array): Promise<HexSave> {
  return fromJSON(await gunzip(new Blob([bytes as BlobPart])));
}

/** 枠に保存し、一覧に出てくるか読み戻して確かめる（P125）。出てこなければ SV-70 */
export async function saveSlot(slot: string, make: () => HexSave): Promise<SaveResult> {
  const r = await saveSlotRaw(slot, make);
  if (!r.ok) return r;
  const metas = await slotMetas();
  if (metas.some((m) => m.slot === slot)) return r;
  return { ok: false, fail: { code: 'SV-70', tries: [...r.tries, { via: r.via, ok: false, code: 'SV-70', err: `一覧に出てこない（一覧の枠：${metas.map((m) => m.slot).join('・') || 'なし'}）` }] } };
}

/** 枠に保存する。そのまま → 縮めて → 端末の保存、の順に試す */
async function saveSlotRaw(slot: string, make: () => HexSave): Promise<SaveResult> {
  const tries: SaveTry[] = [];
  let s: HexSave;
  try { s = make(); } catch (e) { const c = classify(e, 'snapshot'); return { ok: false, fail: { code: c.code, tries: [{ via: 'snapshot', ok: false, ...c }] } }; }
  const meta = (via: SaveVia): SlotMeta => ({ slot, summary: s.summary, savedAt: s.savedAt, via });
  let idbDown = false;
  // 1. そのまま（型付き配列も入る、いちばん速い形）
  try {
    await idbPut(key(slot), s);
    await idbPut(metaKey(slot), meta('idb'));
    clearLocal(slot);
    tries.push({ via: 'idb', ok: true });
    return { ok: true, via: 'idb', tries };
  } catch (e) {
    const c = classify(e, 'idb');
    tries.push({ via: 'idb', ok: false, ...c });
    idbDown = c.code === 'SV-10' || c.code === 'SV-11' || c.code === 'SV-12';
  }
  // 2. 縮めて IndexedDB に（形の誤り・大きすぎるときに効く）
  let bytes: Uint8Array | null = null;
  try { bytes = await pack(s); } catch (e) { tries.push({ via: 'packed', ok: false, ...classify(e, 'packed') }); }
  if (bytes && !idbDown) {
    try {
      await idbPut(key(slot), { packed: 'gzip', bytes } satisfies Packed);
      await idbPut(metaKey(slot), meta('packed'));
      clearLocal(slot);
      tries.push({ via: 'packed', ok: true });
      return { ok: true, via: 'packed', tries };
    } catch (e) { tries.push({ via: 'packed', ok: false, ...classify(e, 'packed') }); }
  }
  // 3. 端末の保存（localStorage）に、縮めて文字にして（ふつう5MBまで）
  if (bytes) {
    try {
      localStorage.setItem(LS + key(slot), b64(bytes));
      localStorage.setItem(LS + metaKey(slot), JSON.stringify(meta('local')));
      setLocalIndex([...localIndex(), slot]);
      tries.push({ via: 'local', ok: true });
      return { ok: true, via: 'local', tries };
    } catch (e) {
      try { localStorage.removeItem(LS + key(slot)); } catch { /* 消せなくても続ける */ }
      tries.push({ via: 'local', ok: false, ...classify(e, 'local') });
    }
  }
  // いちばん初めの失敗を代表のコードにする（容量不足があれば、それを優先）
  const failed = tries.filter((t) => !t.ok && t.code);
  const code = failed.find((t) => t.code === 'SV-20')?.code ?? failed[0]?.code ?? 'SV-90';
  return { ok: false, fail: { code, tries, size: bytes?.length } };
}

function clearLocal(slot: string): void {
  try { localStorage.removeItem(LS + key(slot)); localStorage.removeItem(LS + metaKey(slot)); } catch { /* 無くてもよい */ }
  const idx = localIndex();
  if (idx.includes(slot)) setLocalIndex(idx.filter((x) => x !== slot));
}

/** 枠を読む（IndexedDB のそのまま・縮めた形、端末の保存の、どれでも） */
export async function loadSlot(slot: string): Promise<HexSave | undefined> {
  try {
    const v = await idbGet<HexSave | Packed>(key(slot));
    if (v) return isPacked(v) ? await unpack(v.bytes) : v;
  } catch { /* 端末の保存を見る */ }
  try {
    const t = localStorage.getItem(LS + key(slot));
    if (t) return await unpack(unb64(t));
  } catch { /* 無い */ }
  return undefined;
}

export async function removeSlot(slot: string): Promise<void> {
  try { await idbDel(key(slot)); await idbDel(metaKey(slot)); } catch { /* 消せなくても続ける */ }
  clearLocal(slot);
}

/** 入っている枠の控え（IndexedDB と端末の保存を合わせる）。控えの無い古い枠は、本体から控えを作る */
export async function slotMetas(): Promise<SlotMeta[]> {
  const out = new Map<string, SlotMeta>();
  let keys: IDBValidKey[] = [];
  try { keys = await idbKeys(); } catch { keys = []; }
  const names = new Set(keys.map(String));
  for (const k of names) {
    if (!k.startsWith('slot:')) continue;
    const slot = k.slice(5);
    let m: SlotMeta | undefined;
    try { m = names.has(metaKey(slot)) ? await idbGet<SlotMeta>(metaKey(slot)) : undefined; } catch { m = undefined; }
    if (!m) {
      const s = await loadSlot(slot);
      if (!s) continue;
      m = { slot, summary: s.summary, savedAt: s.savedAt };
      try { await idbPut(metaKey(slot), m); } catch { /* 控えが書けなくても一覧には出す */ }
    }
    out.set(slot, m);
  }
  // 端末の保存：書き留めた一覧から（鍵を数える方法がうまく働かない端末があるため）、それから鍵を数えて
  const fromLocal = (slot: string): void => {
    if (out.has(slot)) return;
    try {
      const m = JSON.parse(localStorage.getItem(LS + metaKey(slot)) ?? 'null') as SlotMeta | null;
      if (m) out.set(slot, { ...m, slot });
      else if (localStorage.getItem(LS + key(slot))) out.set(slot, { slot, summary: { world: '（控えなし）', year: 0, month: 0, faction: '', provinces: 0, months: 0 }, savedAt: new Date(0).toISOString(), via: 'local' });
    } catch { /* 読めない */ }
  };
  for (const slot of localIndex()) fromLocal(slot);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS + 'meta:')) fromLocal(k.slice((LS + 'meta:').length));
      else if (k?.startsWith(LS + 'slot:')) fromLocal(k.slice((LS + 'slot:').length));
    }
  } catch { /* 端末の保存が使えない */ }
  return [...out.values()];
}

/** 端末の情報（保存に失敗したとき、写して知らせてもらう） */
export async function deviceInfo(): Promise<string[]> {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean }; standalone?: boolean };
  const lines = [
    `hex-sim ${pkg.version}`,
    `日時：${new Date().toISOString()}`,
    `ブラウザ：${nav.userAgent}`,
    `機種の種類：${nav.userAgentData?.platform ?? nav.platform ?? '不明'}${nav.maxTouchPoints ? `（指で触る画面・${nav.maxTouchPoints}点）` : ''}`,
    `画面：${screen.width}×${screen.height}（表示 ${innerWidth}×${innerHeight}・倍率 ${devicePixelRatio}）`,
    `言語：${nav.language}`,
    `ホーム画面から開いた：${(nav.standalone || matchMedia?.('(display-mode: standalone)').matches) ? 'はい' : 'いいえ'}`,
    `IndexedDB：${typeof indexedDB !== 'undefined' && indexedDB ? 'あり' : 'なし'}`,
    `localStorage：${(() => { try { localStorage.setItem(LS + 'probe', '1'); localStorage.removeItem(LS + 'probe'); return '使える'; } catch (e) { return `使えない（${errText(e)}）`; } })()}`,
    `縮める仕組み（CompressionStream）：${typeof CompressionStream !== 'undefined' ? 'あり' : 'なし'}`,
    `Cookie：${nav.cookieEnabled ? '有効' : '無効'}`,
  ];
  try {
    const est = await nav.storage?.estimate?.();
    if (est) lines.push(`保存の量：使用 ${mb(est.usage)}／上限 ${mb(est.quota)}`);
    const persisted = await nav.storage?.persisted?.();
    if (persisted !== undefined) lines.push(`保存を消されにくくする設定：${persisted ? 'あり' : 'なし'}`);
  } catch (e) { lines.push(`保存の量：調べられない（${errText(e)}）`); }
  return lines;
}
const mb = (n: number | undefined): string => (n === undefined ? '不明' : `${(n / 1048576).toFixed(1)}MB`);

/** 保存の場所の様子（P125）：IndexedDB が開けるか・何が入っているか、端末の保存に何が入っているか */
export async function storageReport(): Promise<string[]> {
  const out: string[] = ['■ 保存の場所の様子'];
  try {
    const keys = (await idbKeys()).map(String);
    out.push(`ブラウザ内の保存（IndexedDB）：開けた。鍵 ${keys.length}件${keys.length ? `（${keys.slice(0, 20).join('・')}${keys.length > 20 ? ' ほか' : ''}）` : ''}`);
  } catch (e) { out.push(`ブラウザ内の保存（IndexedDB）：使えない（${errText(e)}）`); }
  try {
    out.push(`端末の保存（localStorage）：全部で ${localStorage.length}件、このゲームの一覧 [${localIndex().join('・')}]`);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS)) out.push(`　${k}：${(localStorage.getItem(k) ?? '').length}字`);
    }
  } catch (e) { out.push(`端末の保存（localStorage）：使えない（${errText(e)}）`); }
  try { const m = await slotMetas(); out.push(`一覧に出る枠：${m.map((x) => `${x.slot}（${x.via ?? 'idb'}）`).join('・') || 'なし'}`); } catch (e) { out.push(`一覧を作れない（${errText(e)}）`); }
  return out;
}

/** 失敗の知らせ（画面と写し用の文） */
export async function failReport(f: SaveFail): Promise<{ title: string; text: string }> {
  const title = `保存できませんでした（${f.code}：${SAVE_CODES[f.code]}）`;
  const via = { idb: 'ブラウザ内の保存（そのまま）', packed: 'ブラウザ内の保存（縮めて）', local: '端末の保存（localStorage）', snapshot: 'セーブを作る' } as const;
  const lines = [
    title,
    ...f.tries.map((t, i) => `試した${i + 1}：${via[t.via]} → ${t.ok ? 'できた' : `失敗 ${t.code ?? ''} ${t.err ?? ''}`}`),
    ...(f.size ? [`セーブの大きさ（縮めたあと）：${(f.size / 1048576).toFixed(2)}MB`] : []),
    '',
    ...(await storageReport()),
    '',
    ...(await deviceInfo()),
  ];
  return { title, text: lines.join('\n') };
}
