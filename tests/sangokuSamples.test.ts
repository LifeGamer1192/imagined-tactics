// 三国志の見本（P123）：hist-sim で作った184〜234年の見本が読めて、国モードと局地戦が動く（public/samples を直に読む）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { createBattle } from '../src/battle/setup';
import { readSaveFile } from '../src/bridge/histsim';
import { convert, generalsOf } from '../src/convert/convert';
import { autoMonth, newCampaign, provinceMap, provincesOf } from '../src/strategy/campaign';

const YEARS = ['184', '190', '200', '208', '212', '220', '234'];
const load = async (y: string) => (await readSaveFile(new Uint8Array(readFileSync(fileURLToPath(new URL(`../public/samples/sangoku_fid5_${y}.histsim`, import.meta.url)))))).save;

describe('三国志の見本（184〜234年）', () => {
  for (const y of YEARS) {
    it(`${y}年：読み込み、国モードで3か月、局地戦が決着する`, async () => {
      const save = await load(y), gs = convert(save);
      const facs = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
      expect(facs.length).toBeGreaterThanOrEqual(5);
      expect(gs.year).toBe(Number(y));
      const c = newCampaign(gs, save.world, facs[0].id);
      for (let m = 0; m < 3 && !c.over; m++) autoMonth(c);
      expect(c.months).toBe(3);
      // 局地戦：いちばん大きな2家の将で、2家目の本拠を舞台に
      const gs2 = convert(save), [a, b] = Object.values(gs2.factions).sort((x, z) => generalsOf(gs2, z.id).length - generalsOf(gs2, x.id).length);
      const c2 = newCampaign(gs2, save.world, a.id);
      const st = createBattle(gs2, provinceMap(c2, b.capital), [generalsOf(gs2, a.id).slice(0, 3).map((g) => g.id), generalsOf(gs2, b.id).slice(0, 3).map((g) => g.id)], `s${y}`);
      autoBattle(st);
      expect(st.winner === 0 || st.winner === 1 || st.round >= st.maxRounds).toBe(true);
      expect(provincesOf(c2, a.id).length).toBeGreaterThan(0);
    }, 120000);
  }
});
