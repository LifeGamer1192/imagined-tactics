// 絵の版（P87）：ローマは西洋版の絵を使い、西洋版の絵が無い所は、日本版・中国版の絵で代えない
import { describe, expect, it } from 'vitest';
import { artUrl } from '../src/art/art';
import { artSetOf, convert, variantOf } from '../src/convert/convert';
import { getArtSet, setArtSet } from '../src/data/db';
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
});
