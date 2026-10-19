// 年表（P57）：自分の家の歩み（起った日・攻め取った領・滅ぼした家・開戦）と功臣を書き留め、セーブに残す
import { describe, expect, it } from 'vitest';
import type { BattleState } from '../src/battle/types';
import { convert, generalsOf } from '../src/convert/convert';
import { restore, snapshot } from '../src/persist/save';
import { battleFor, generalsAt, newCampaign, planAttack, resolveBattle } from '../src/strategy/campaign';
import { spanText, startChronicle } from '../src/strategy/chronicle';
import { loadFixture } from './helpers';

const finish = (st: BattleState, winner: 0 | 1): BattleState => { st.winner = winner; return st; };

describe('chronicle of the player house', () => {
  it('records the start, wars and captures, and the generals who won', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
    const c = newCampaign(gs, save.world, f.id);
    startChronicle(c);
    expect(c.chronicle![0].kind).toBe('start');
    expect(c.chronicle![0].text).toContain(f.name.ja);
    // 隣の敵の領を攻め取る
    let done = false;
    for (const p of gs.provinces.filter((x) => x.owner === f.id && generalsAt(c, x.id, f.id).length)) {
      const to = p.nb.find((n) => gs.provinces[n].owner && gs.provinces[n].owner !== f.id && gs.factions[gs.provinces[n].owner].capital !== n);
      if (to === undefined) continue;
      const gid = generalsAt(c, p.id, f.id)[0].id;
      const pb = planAttack(c, f.id, p.id, to, [gid])!;
      resolveBattle(c, pb, finish(battleFor(c, pb), 0));
      expect(c.chronicle!.some((e) => e.kind === 'war')).toBe(true);
      const cap = c.chronicle!.find((e) => e.kind === 'capture');
      expect(cap?.text).toContain(gs.provinces[to].name.ja);
      expect(c.feats![gid].wins).toBe(1);
      done = true;
      break;
    }
    expect(done).toBe(true);
    expect(spanText(c)).toMatch(/か月|年/);
    const back = restore(JSON.parse(JSON.stringify(snapshot(c))));
    expect(back.chronicle).toEqual(c.chronicle);
    expect(back.feats).toEqual(c.feats);
  });
});
