// ima-rpg のセーブ（.imarpg）の読み込み（P61）：主人公・仲間・ライバル・率いる兵を、武将と兵として連れてくる
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyIma, imaRealm, imaVariant, inferTraits, pickArts, readImaFile, type ImaGame } from '../src/bridge/imarpg';
import { generalUnit } from '../src/battle/setup';
import { convert, generalsOf } from '../src/convert/convert';
import { D, setVariant } from '../src/data/db';
import { basicSkill } from '../src/rules/stats';

async function load() {
  const path = fileURLToPath(new URL('./fixtures/ima_test_troops.imarpg', import.meta.url));
  const file = await readImaFile(new Blob([readFileSync(path)]));
  const v = imaVariant(file.game) ?? 'cn';
  setVariant(v);
  return { ...file, v, gs: convert(file.save, { variant: v }) };
}

// 2MB ほどのセーブを読んで世界を作るので、ほかのテストと並んで重いときに時間切れにならないよう、長めに待つ
describe('ima-rpg save into hex-sim (P61)', { timeout: 30000 }, () => {
  it('reads the save and its world', async () => {
    const { game, save, v } = await load();
    expect(game.version).toBe(1);
    expect(save.format).toBe('hist-sim');
    expect(v).toBe('cn');
    expect(imaRealm(game)).toBe(6);
  });

  it('brings the hero, companions and troops into the realm served (not as lord)', async () => {
    const { game, gs, v } = await load();
    const realm = imaRealm(game), lordBefore = gs.factions[realm].lordId;
    const res = applyIma(gs, game, v, { faction: realm, king: false });
    const hero = gs.generals[res.heroId!];
    expect(hero.name.ja).toBe(game.player.name);
    expect(hero.faction).toBe(realm);
    expect(hero.isLord).toBe(false);
    expect(gs.factions[realm].lordId).toBe(lordBefore);
    expect(res.companionIds.length).toBe(game.player.companions!.length);
    // 技と軍略を引き継ぐ
    for (const id of game.player.arts!.filter((a) => a.startsWith('k') && D.bySkill[a])) expect(hero.skills).toContain(id);
    for (const id of game.player.arts!.filter((a) => a.startsWith('x') && D.byTactic[a])) expect(hero.learned).toContain(id);
    // 主人公の隊＋部将4人が兵として、主人公から順に入る（采配と数の上限まで）
    const all = [hero, ...res.companionIds.map((id) => gs.generals[id])].reduce((s, g) => s + g.troops.length, 0) + res.reserve.length;
    expect(all).toBe(1 + game.player.troop!.lts!.length);
    expect(hero.troops.length).toBeGreaterThan(0);
    // 戦場では、引き継いだ技で戦う
    const bu = generalUnit(hero, 0, 0);
    expect(bu.skills.slice(0, hero.skills!.length)).toEqual(hero.skills);
    expect(basicSkill(bu)).toBeTruthy();
  });

  it('can make the hero the lord; the old lord stays as a general', async () => {
    const { game, gs, v } = await load();
    const realm = imaRealm(game), old = gs.generals[gs.factions[realm].lordId];
    const res = applyIma(gs, game, v, { faction: realm, king: true });
    expect(gs.factions[realm].lordId).toBe(res.heroId);
    expect(gs.generals[res.heroId!].isLord).toBe(true);
    expect(D.byClass[gs.generals[res.heroId!].classId].unique).toBe('lord');
    expect(old.isLord).toBe(false);
    expect(old.faction).toBe(realm);
    expect(D.byClass[old.classId].unique).not.toBe('lord');
    expect(generalsOf(gs, realm).filter((g) => g.isLord).length).toBe(1);
  });

  it('companions of the records, rivals, the throne and jail', async () => {
    const { game, gs, v } = await load();
    const realm = imaRealm(game);
    // 記録の人物の仲間：別の国の武将を1人選んで、仲間にしたことにする
    const other = Object.values(gs.generals).find((g) => g.pid !== undefined && g.faction && g.faction !== realm && !g.isLord)!;
    const foe = Object.values(gs.factions).find((f) => f.id !== realm)!;
    const g2: ImaGame = JSON.parse(JSON.stringify(game));
    g2.player.companions = [...(g2.player.companions ?? []), { name: other.name.ja, pid: other.pid }];
    g2.player.jail = { until: (g2.day ?? 0) + 45, prov: 0 };
    g2.rivals = [{ id: 7, joined: false, g: { player: { name: '宿敵', skills: { blade: { lv: 80 }, bow: { lv: 40 } }, maxHp: 90, fame: 50, rank: 5, patron: foe.id, throne: { realm: foe.id, how: '簒奪', since: 0 }, arts: ['k001', 'x01'], troop: { lts: [{ type: 'foot', lv: 5 }] } } } }];
    const res = applyIma(gs, g2, v, { faction: realm, king: false });
    expect(other.faction).toBe(realm);
    expect(res.companionIds).toContain(other.id);
    expect(res.jailMonths).toBe(2);
    const rival = gs.generals[res.rivalIds[0]];
    expect(rival.faction).toBe(foe.id);
    expect(gs.factions[foe.id].lordId).toBe(rival.id);
    expect(rival.troops.length).toBe(1);
    expect(rival.stats.str).toBe(Math.round(50 + 0.7 * 80 + 0.2 * 40));
  });

  it('infers traits for people without any, and picks the strongest arts within the limits', () => {
    expect(inferTraits({ feats: ['sword'], origin: 'youxia', skill: () => 0 })).toEqual(['warrior', 'brave']);
    expect(inferTraits({ origin: 'merchant', feats: ['trade'], skill: () => 0 })).toEqual(['generous']);
    const all = D.skills.map((s) => s.id).filter((id) => id.startsWith('k'));
    expect(pickArts(all).skills.length).toBe(8);
  });
});
