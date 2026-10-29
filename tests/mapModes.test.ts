// 地図の切り替え（P97）：塗り分け・凡例・偵察が足りない領は「分からない」・観戦では自分の家から見る地図は無い
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { newCampaign } from '../src/strategy/campaign';
import { scoutTier } from '../src/strategy/scouting';
import { MAP_MODES, mapModesFor, mapPaint, UNKNOWN } from '../src/ui/mapModes';
import { loadFixture } from './helpers';

const start = async (player = true) => {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  return newCampaign(gs, save.world, player ? Object.values(gs.factions)[0].id : 0);
};

describe('map modes', () => {
  it('land is the usual map; every other mode paints every province on stage and has a legend', async () => {
    const c = await start();
    expect(mapPaint(c, 'land')).toBeNull();
    const stage = c.gs.provinces.filter((p) => !p.out).length;
    for (const m of MAP_MODES) {
      if (m.id === 'land') continue;
      const p = mapPaint(c, m.id)!;
      expect(p.fills.size, m.id).toBe(stage);
      expect(p.legend.items.length, m.id).toBeGreaterThanOrEqual(2);
      expect(p.legend.title).toBe(m.name);
    }
  });

  it('provinces the player cannot see well are unknown (grey) and have no number', async () => {
    const c = await start();
    const p = mapPaint(c, 'pop')!;
    const hidden = c.gs.provinces.filter((q) => !q.out && ['rough', 'none'].includes(scoutTier(c, q.id)));
    expect(hidden.length).toBeGreaterThan(0);
    for (const q of hidden) { expect(p.fills.get(q.id)).toBe(UNKNOWN); expect(p.labels.has(q.id)).toBe(false); }
    expect(p.legend.items.at(-1)!.color).toBe(UNKNOWN);
    // 自分の領は数がそのまま（「約」なし）
    const mine = c.gs.provinces.find((q) => q.owner === c.player)!;
    expect(p.labels.get(mine.id)).not.toMatch(/約/);
    // 人口の多い領ほど濃い（同じか後ろの段）
    const ramp = p.legend.items.map((i) => i.color);
    const seen = c.gs.provinces.filter((q) => !q.out && p.fills.get(q.id) !== UNKNOWN).sort((a, b) => a.pop - b.pop);
    for (let i = 1; i < seen.length; i++) expect(ramp.indexOf(p.fills.get(seen[i].id)!)).toBeGreaterThanOrEqual(ramp.indexOf(p.fills.get(seen[i - 1].id)!));
  });

  it('diplomacy colours the player and spectators have no player-only maps', async () => {
    const c = await start();
    const p = mapPaint(c, 'diplo')!;
    expect(p.legend.items.map((i) => i.label)).toContain('自分の家');
    const w = await start(false);
    expect(mapModesFor(w).map((m) => m.id)).not.toContain('diplo');
    expect(mapModesFor(w).map((m) => m.id)).not.toContain('scout');
    // 観戦ではすべて見える
    expect([...mapPaint(w, 'income')!.fills.values()]).not.toContain(UNKNOWN);
  });
});
