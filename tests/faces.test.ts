// 史実の人物の顔絵（hist-sim と共有、tools/sync-faces.mjs で写す）：台帳の絵がすべてあり、見本の武将が引ける。名前を変えても同じ顔
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { faceFor, setFaces, type FaceTable } from '../src/art/faces';
import { convert } from '../src/convert/convert';
import { renameGeneral } from '../src/strategy/events';
import type { Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

const table = JSON.parse(readFileSync('public/art/faces/faces.json', 'utf8')) as FaceTable;
setFaces(table);

describe('faces', () => {
  it('every face in the table has a picture', () => {
    for (const [era, names] of Object.entries(table.eras)) for (const id of Object.values(names)) expect(existsSync(`public/art/faces/${era}/${id}.webp`), `${era}/${id}`).toBe(true);
  });

  it('the Warring States sample finds faces for its generals, and keeps them after a rename', async () => {
    const gs = convert(await loadFixture('shunju_fid5_259bc'));
    expect(gs.scenario).toBe('shunju');
    const found = Object.values(gs.generals).filter((g) => faceFor(gs.scenario!, g.name.ja));
    expect(found.length).toBeGreaterThanOrEqual(10);
    const c = { gs } as unknown as Campaign;
    const g = c.gs.generals[found[0].id], before = faceFor('shunju', g.name.ja);
    expect(renameGeneral(c, g.id, '別の名')).toBe(true);
    expect(faceFor('shunju', g.recordName ?? g.name.ja)).toBe(before);
  });
});
