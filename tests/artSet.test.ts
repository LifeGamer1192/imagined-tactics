// 絵の版（P87）：ローマは西洋版の絵を使い、西洋版の絵が無い所は、日本版・中国版の絵で代えない
import { describe, expect, it } from 'vitest';
import { artUrl } from '../src/art/art';
import { artSetOf, convert, variantOf } from '../src/convert/convert';
import { D, getArtSet, L, setArtSet, westName, westOf } from '../src/data/db';
import { sceneUrl } from '../src/ui/scene';
import { loadFixture } from './helpers';

describe('art set', () => {
  it('Rome uses the western art; Japan and China keep their own', async () => {
    const rome = await loadFixture('rome_fid3_212bc');
    expect(artSetOf(convert(rome).scenario, variantOf(rome))).toBe('west');
    expect(artSetOf('sengoku', 'jp')).toBe('jp');
    expect(artSetOf('shunju', 'cn')).toBe('cn');
    expect(artSetOf(null, 'jp')).toBe('jp');
  });

  it('western scenes come from the western pictures, and missing ones are not filled with Japanese ones', () => {
    const before = getArtSet();
    setArtSet('west');
    for (const n of ['setup', 'victory', 'defeat', 'envoy', 'death', 'defect', 'promote', 'succession', 'travel']) expect(sceneUrl(n), n).toMatch(/_west\.webp$/);
    expect(sceneUrl('no_such_scene')).toBeNull();
    expect(artUrl('unit/west/u01a')).toMatch(/unit\/west\/u01a\.webp$/);
    setArtSet(before);
  });

  it('in the western world, units go by their western names; other names stay as they are', () => {
    const before = getArtSet();
    setArtSet('west');
    expect(L(D.byUnit.u01b.name)).toBe('重装歩兵');
    expect(L(D.byUnit.u16a.name)).toBe('三段櫂船');
    // 技・軍略・役職も西洋の名前（P94）
    expect(L(D.bySkill.k002.name)).toBe('盾列突き');
    expect(L(D.byTactic.x25.name)).toBe('亀甲隊形');
    expect(L(D.byClass.samurai_taisho.name)).toBe('将軍');
    setArtSet('jp');
    expect(L(D.byUnit.u01b.name)).toBe('足軽槍組');
    // すべての兵種に西洋の名前がある
    for (const u of D.units) expect(westName(u.id), u.id).toBeTruthy();
    // すべての技・軍略・役職に西洋の名前がある
    for (const x of [...D.skills, ...D.tactics, ...D.classes]) expect(westOf(x.name), x.id).toBeTruthy();
    setArtSet(before);
  });
});
