// セーブ枠のための、小さな IndexedDB の入れ物（セーブは数MBあり localStorage には入らない）。
// hist-sim/src/persist/idb.ts から。値は structured clone で保存されるので、型付き配列もそのまま入る。
// 2026-11-12（P124）：接続は1つを使い回す（前は操作のたびに開いて閉じなかった。Safari で失敗のもとになりうる）。
//   書き込みは、取引（transaction）が終わったのを見てから「できた」とする。失敗は IdbError（段階と DOMException の名前）で返す。

const DB = 'hex-sim';
const STORE = 'saves';

/** IndexedDB の失敗：どの段階（open・put など）で、どんな名前の誤り（QuotaExceededError など）か */
export class IdbError extends Error {
  constructor(readonly step: 'missing' | 'open' | 'blocked' | 'tx' | 'request' | 'abort', readonly errName: string, message: string) {
    super(message);
    this.name = 'IdbError';
  }
}

let conn: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (conn) return conn;
  conn = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new IdbError('missing', 'NotSupported', 'この端末のブラウザには IndexedDB がありません');
      req = indexedDB.open(DB, 1);
    } catch (e) {
      reject(e instanceof IdbError ? e : new IdbError('open', (e as DOMException)?.name ?? 'Error', (e as Error)?.message ?? String(e)));
      return;
    }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      const db = req.result;
      // ほかのタブが版を上げたとき・ブラウザが接続を閉じたときは、次の操作で開き直す
      db.onversionchange = () => { db.close(); conn = null; };
      (db as IDBDatabase & { onclose: (() => void) | null }).onclose = () => { conn = null; };
      resolve(db);
    };
    req.onerror = () => reject(new IdbError('open', req.error?.name ?? 'Error', req.error?.message ?? 'データベースを開けませんでした'));
    req.onblocked = () => reject(new IdbError('blocked', 'Blocked', 'ほかのタブがデータベースを使っていて開けません'));
  }).catch((e) => { conn = null; throw e; });
  return conn;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction, req: IDBRequest<T>;
    try {
      t = db.transaction(STORE, mode);
      req = fn(t.objectStore(STORE));
    } catch (e) {
      // put の時点で投げる誤り（DataCloneError など）や、閉じた接続（InvalidStateError）
      const name = (e as DOMException)?.name ?? 'Error';
      if (name === 'InvalidStateError') conn = null;
      reject(new IdbError('request', name, (e as Error)?.message ?? String(e)));
      return;
    }
    let result: T;
    req.onsuccess = () => { result = req.result; if (mode === 'readonly') resolve(result); };
    req.onerror = () => reject(new IdbError('request', req.error?.name ?? 'Error', req.error?.message ?? '読み書きに失敗しました'));
    // 書き込みは、取引が終わって（ディスクに入って）からできたとする
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(new IdbError('abort', t.error?.name ?? 'AbortError', t.error?.message ?? '書き込みが取り消されました'));
    t.onerror = () => { /* onabort で扱う */ };
  });
}

export const idbPut = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key));
export const idbGet = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbDel = (key: string) => tx('readwrite', (s) => s.delete(key));
export const idbKeys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());

export async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
