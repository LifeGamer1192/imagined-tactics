import { describe, expect, it } from 'vitest';
import { advanceClass, convert, convertStats, generalsOf, inferRole, lordLine, pickBaseClass, startLevel, variantOf } from '../src/convert/convert';
import { D } from '../src/data/db';
import { FIXTURES, loadFixture } from './helpers';

describe('stat conversion (docs/13 の 4-12 の計算例)', () => {
  const cases: [string, [number, number, number, number], string[], number, { str: number; int: number; agi: number; hp: number; command: number; range: number }][] = [
    ['柴田勝家', [6, 9, 4, 6], ['brave'], 6, { str: 83, int: 60, agi: 69, hp: 370, command: 220, range: 2 }],
    ['前田利家', [6, 8, 6, 8], ['brave'], 6, { str: 78, int: 65, agi: 70, hp: 370, command: 260, range: 3 }],
    ['滝川一益', [5, 8, 6, 5], [], 4, { str: 75, int: 63, agi: 64, hp: 355, command: 180, range: 2 }],
    ['丹羽長秀', [8, 6, 6, 6], ['builder'], 4, { str: 65, int: 70, agi: 60, hp: 340, command: 200, range: 2 }],
    ['お市', [3, 2, 6, 9], ['charismatic'], 6, { str: 45, int: 58, agi: 54, hp: 315, command: 320, range: 4 }],
    ['管仲', [10, 6, 9, 7], ['wise', 'genius'], 8, { str: 65, int: 93, agi: 62, hp: 345, command: 260, range: 3 }],
  ];
  for (const [name, ab, traits, fame, want] of cases) {
    it(name, () => {
      const c = convertStats(ab, 1, traits, fame);
      expect({ str: c.stats.str, int: c.stats.int, agi: c.stats.agi, hp: c.stats.hp, command: c.command, range: c.commandRange }).toEqual(want);
    });
  }

  it('health lowers hp', () => {
    expect(convertStats([5, 5, 5, 5], 0.5, [], 4).stats.hp).toBeLessThan(convertStats([5, 5, 5, 5], 1, [], 4).stats.hp);
  });

  it('class pick', () => {
    const pick = (sex: 'm' | 'f', ab: [number, number, number, number], role: any, traits: string[]) =>
      pickBaseClass(sex, ab, role, traits, convertStats(ab, 1, traits, 4).stats).cls.id;
    expect(pick('m', [6, 9, 4, 6], 'general', ['brave'])).toBe('nobushi');
    expect(pick('m', [5, 8, 6, 5], 'general', [])).toBe('ashigaru');
    expect(pick('m', [8, 6, 6, 6], 'minister', ['builder'])).toBe('gunbaisha');
    expect(pick('f', [3, 2, 6, 9], 'hero', ['charismatic'])).toBe('shirabyoshi');
  });

  it('raises stats when no class fits', () => {
    const s = convertStats([1, 1, 1, 1], 1, [], 4).stats;
    const r = pickBaseClass('m', [1, 1, 1, 1], 'general', [], s);
    expect(r.raised).toBe(true);
    expect(s.str).toBeGreaterThanOrEqual(r.cls.req.str ?? 0);
  });

  it('advance by level', () => {
    const s = convertStats([5, 8, 6, 5], 1, [], 4).stats;
    expect(advanceClass(D.byClass.ashigaru, 5, s, []).id).toBe('ashigaru');
    expect(advanceClass(D.byClass.ashigaru, 12, s, []).id).toBe('samurai');
    expect(advanceClass(D.byClass.ashigaru, 22, s, ['cruel']).id).toBe('gedo_musha');
    expect(advanceClass(D.byClass.ashigaru, 12, { ...s, agi: 80 }, []).id).toBe('kenshi');
  });

  it('level, role and lord line', () => {
    expect(startLevel(4, 20, false)).toBe(3);
    expect(startLevel(8, 60, false)).toBe(20);
    expect(startLevel(4, 5, false)).toBe(3);
    expect(inferRole([3, 9, 3, 3])).toBe('general');
    expect(inferRole([9, 3, 3, 3])).toBe('minister');
    expect(inferRole([3, 3, 3, 9])).toBe('hero');
    expect(lordLine({ government: 'theocracy', economy: 'agrarian' }, 'm', 40)).toBe('monshu');
    expect(lordLine({ government: 'monarchy', economy: 'maritime' }, 'm', 40)).toBe('funa_taisho');
    expect(lordLine({ government: 'monarchy', economy: 'agrarian' }, 'f', 40)).toBe('onna_joshu');
    expect(lordLine({ government: 'tribe', economy: 'agrarian' }, 'm', 40)).toBe('kokujin');
    expect(lordLine({ government: 'monarchy', economy: 'agrarian' }, 'm', 20)).toBe('wakatono');
    expect(lordLine({ government: 'monarchy', economy: 'agrarian' }, 'm', 40)).toBe('daimyo');
  });
});

describe('convert a whole save', () => {
  for (const f of FIXTURES) {
    it(f, async () => {
      const save = await loadFixture(f);
      const gs = convert(save);
      const factions = Object.values(gs.factions);
      expect(factions.length).toBe(save.summary.nations);
      for (const fa of factions) {
        // 当主は必ずいる
        const lord = gs.generals[fa.lordId];
        expect(lord, `lord of ${fa.name.ja}`).toBeDefined();
        expect(lord.isLord).toBe(true);
        expect(D.byClass[lord.classId].unique, lord.name.ja).toBeTruthy();
        expect(Object.keys(fa.recruit).length, fa.name.ja).toBeGreaterThan(0);
      }
      for (const g of Object.values(gs.generals)) {
        const c = D.byClass[g.classId];
        expect(c, g.name.ja).toBeDefined();
        expect(c.sex === 'any' || c.sex === g.sex, `${g.name.ja} ${c.id}`).toBe(true);
        expect(g.age).toBeGreaterThanOrEqual(15);
        expect(g.level).toBeGreaterThanOrEqual(1); expect(g.level).toBeLessThanOrEqual(25);
        for (const k of ['str', 'int', 'agi'] as const) { expect(g.stats[k]).toBeGreaterThanOrEqual(1); expect(g.stats[k]).toBeLessThanOrEqual(150); }
        expect(g.troops.length).toBeLessThanOrEqual(6);
        expect(g.troops.reduce((s, t) => s + D.byUnit[t.unitId].cost, 0), g.name.ja).toBeLessThanOrEqual(g.command);
        expect(g.faction === 0 || gs.factions[g.faction], g.name.ja).toBeTruthy();
        for (const t of g.ties) expect(gs.generals[t.with], g.name.ja).toBeDefined();
      }
      // 同じセーブからは同じ結果
      expect(JSON.stringify(convert(save))).toBe(JSON.stringify(gs));
    });
  }

  it('sengoku details', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const gs = convert(save);
    expect(variantOf(save)).toBe('jp');
    expect(gs.year).toBe(1575);
    const oda = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!;
    const nobunaga = gs.generals[oda.lordId];
    expect(nobunaga.name.ja).toBe('織田信長');
    expect(nobunaga.level).toBeGreaterThanOrEqual(12);   // 当主は威信から名声を決める
    expect(generalsOf(gs, oda.id).length).toBeGreaterThan(15);
    // 1575年なので鉄砲足軽系は解禁済み。交易の勢力でなくても、解禁の判定で落ちない
    expect(Object.values(gs.factions).some((f) => 'u04a' in f.recruit)).toBe(true);
    expect(generalsOf(gs, 0).length).toBeGreaterThan(0); // 浪人
    expect(Object.values(gs.generals).filter((g) => g.ties.length).length).toBeGreaterThan(5);
  });
});
