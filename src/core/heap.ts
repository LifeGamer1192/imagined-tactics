// Binary min-heap of (key, value) number pairs. Ties break on value so pop
// order is deterministic regardless of push order.

export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(key, val, k[p], v[p])) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }

  /** key of the top element (heap must be non-empty) */
  peekKey(): number {
    return this.keys[0];
  }

  /** removes the top element and returns its value */
  pop(): number {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && less(k[r], v[r], k[l], v[l]) ? r : l;
        if (!less(k[c], v[c], lk, lv)) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function less(ka: number, va: number, kb: number, vb: number): boolean {
  return ka < kb || (ka === kb && va < vb);
}
