// セーブの失敗の分類（P124）
import { describe, expect, it } from 'vitest';
import { IdbError } from '../src/persist/idb';
import { classify, SAVE_CODES } from '../src/persist/slots';

describe('save failure codes', () => {
  it('sorts each kind of failure into its code', () => {
    expect(classify(new IdbError('missing', 'NotSupported', 'x'), 'idb').code).toBe('SV-10');
    expect(classify(new IdbError('open', 'UnknownError', 'x'), 'idb').code).toBe('SV-11');
    expect(classify(new IdbError('blocked', 'Blocked', 'x'), 'idb').code).toBe('SV-12');
    expect(classify(new IdbError('abort', 'QuotaExceededError', 'x'), 'idb').code).toBe('SV-20');
    expect(classify(new IdbError('request', 'DataCloneError', 'x'), 'idb').code).toBe('SV-30');
    expect(classify(new IdbError('abort', 'AbortError', 'x'), 'packed').code).toBe('SV-40');
    expect(classify(new IdbError('request', 'UnknownError', 'x'), 'idb').code).toBe('SV-41');
    expect(classify(new Error('boom'), 'snapshot').code).toBe('SV-50');
    expect(classify(new Error('denied'), 'local').code).toBe('SV-60');
    expect(classify('???', 'idb').code).toBe('SV-90');
    expect(classify(new IdbError('request', 'DataCloneError', 'could not be cloned'), 'idb').err).toContain('DataCloneError');
    for (const c of Object.keys(SAVE_CODES)) expect(SAVE_CODES[c as keyof typeof SAVE_CODES].length).toBeGreaterThan(5);
  });
});
