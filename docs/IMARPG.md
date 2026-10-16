# ima-rpg のセーブ（.imarpg）の読み込み（検討）

兄弟の作品 ima-rpg（hist-sim の世界を一人の人物として旅する RPG）のセーブを hex-sim で読み込み、同じ人物・仲間・兵・技で戦うための検討。まだ作っていない。

読んだもの：ima-rpg の `docs/HEX.md`（ブランチ proto-v0.1）と、セーブを書くコード（`src/game/state.ts`・`persist.ts`・`command.ts`・`companions.ts`・`era/era.ts`）。

## セーブの形（ima-rpg 側の今のコードから）

- ファイル：gzip した JSON `{ format: "ima-rpg", game, hist }`。
- `hist`：**文字列**（`worldText`）。中身は hist-sim のセーブの JSON の文字列で、遊んでいる間に進んだ世界。
- `game`：`GameState`。主なもの：
  - `version`（今は 1）、`eraId`（`sengoku`・`shunju`・`generic`）、`day`、`tick0`（始めたときの hist-sim の月）、`place.prov`（いる領）。
  - `player`：`name`・`sex`・`hp/maxHp`・`fame`・`money`・`patron`（仕える国、0 は無し）・`rank`・`skills`（`{blade, bow, speech, letters, trade, medicine, stealth, theft}` それぞれ `{lv: 0〜100, xp}`）・`arts`（k と x の ID）・`mp`・`troop`・`companions`。
  - `troop`：`{ men, loyalty, lts: [{id, name, type, xp, lv(1〜9)}], battles, won, cap }`。`type` は時代の兵種（foot・archer・gun・horse・chariot）。
  - `companions[]`：`{ name, sex, age, job, pid?, blade, bow, medicine, speech（0〜100）, hp, maxHp, loyalty, arts? }`。

## 読み込みの流れ（案）

1. ファイルを gunzip → JSON。`format === "ima-rpg"` を確かめる。
2. `hist` の文字列を、今の「.json の hist-sim セーブ」と同じ道（`readSaveFile(blob, plain=true)`）で読む → 世界（`convert` で GameStart）。
3. 版は `eraId` から：`sengoku` → 日本版（jp）、`shunju` → 中国版（cn）、ほか → hist-sim のセーブの決まりどおり。
4. 主人公を武将にして、`patron` の勢力（hist-sim の国 ID ＝ hex-sim の勢力 ID）に加える。いる領は `place.prov`（その勢力の領でなければ本拠）。`patron` が 0（浪人）なら、読み込んだあとに仕官先の勢力を選んでもらう（勢力の一覧から選び、その勢力の本拠か、いる領に近い領に加わる）。
5. 仲間を武将にする。`pid` があり、変換した世界にその人物がいれば、その武将を主人公の勢力に移す（能力は hist-sim の値のまま）。`pid` が無ければ、下の換算で作る。
6. 部将（`troop.lts`）を兵1隊ずつにして、主人公（入りきらなければ仲間）に付ける。主人公自身の隊も1隊（剣術が弓術より上なら槍、下なら弓）。
7. あとは今の戦略・戦闘のまま。戦いの結果（レベル、兵の損害、技の習得）は ima-rpg に書き戻さない（hex-sim の中だけで進む。続きは hex-sim のセーブ .hexsim に残る）。

## 換算（案。数は data/system に置いて調整できるようにする）

技能はどれも 0〜100（ima-rpg では 5 から始まり、使うと上がる）。hex-sim の武将は、名のある武将で 武力・知略・機敏が 90〜130 ほど。

| hex-sim | 換算 |
|---|---|
| 武力 | `50 ＋ 0.7 × 剣術 ＋ 0.2 × 弓術` |
| 知略 | `45 ＋ 0.5 × 学問 ＋ 0.3 × 弁舌 ＋ 0.1 × 医術` |
| 機敏 | `45 ＋ 0.4 × 隠密 ＋ 0.3 × 弓術 ＋ 0.1 × 剣術` |
| 体力 | `300 ＋ 3 × 最大体力（ima-rpg の maxHp）` |
| 気力 | `game.player.mp`（無ければ `40 ＋ 知略 ÷ 2`）。最大気力も同じ値から始める |
| 采配力 | 位（rank）と名声から：`120 ＋ 30 × rank ＋ fame ÷ 2` |
| レベル | `1 ＋ round((剣術＋弓術＋学問＋弁舌＋医術) ÷ 25) ＋ floor(名声 ÷ 25)`（上限なし） |
| 役職 | 今の `pickBaseClass`（能力で選ぶ）をそのまま使い、レベルぶん進める |
| 技・軍略 | `arts` の k は武将の技（通常攻撃のほかに使える技として足す）、x は覚えた軍略（`learned`）に入れる |
| 特性 | 無し（性格は能力からの既定値） |

仲間（pid 無し）も同じ式で、学問・隠密が無いので 知略 ＝ `45 ＋ 0.5 × 弁舌 ＋ 0.3 × 医術`、機敏 ＝ `45 ＋ 0.4 × 弓術 ＋ 0.2 × 剣術`。体力は仲間の maxHp から。

部将の兵：兵種は下の対応、レベルは `1 ＋ 3 ×（lv − 1）`（ima-rpg の 1〜9 → hex-sim の 1〜25）。

## 兵種の対応（hex-sim の兵種の名前で確かめた）

| ima-rpg | 日本版（戦国）の hex-sim | 中国版（春秋戦国）の hex-sim |
|---|---|---|
| foot | u01b 足軽槍組 | u01b 戈兵 |
| archer | u06a 弓足軽 | **u04a 弩兵**（u06a は「弓兵」） |
| gun | u04a 鉄砲足軽 | ―（u04a は中国版では弩兵） |
| horse | u07b 騎馬隊（「騎馬武者」の名は u13a） | u07b 騎兵 |
| chariot | ― | u13a 戦車 |

u04a と u13a は、同じ ID で日本版と中国版の兵種が違う（鉄砲足軽／弩兵、騎馬武者／戦車）。対応は版ごとに分けて持つのがよい。

## ima-rpg の docs/HEX.md への追記案

以下を HEX.md に足してもらえると、hex-sim 側の読み込みが確実になる。

1. **`hist` の中身をはっきり書く**：`hist` は文字列で、hist-sim の「.json のセーブ」と同じ形（`{format, version, world, …}`、型付き配列は `{__ta, b64}`）であること。hex-sim は今の読み込み（`readSaveFile(…, plain)`）でそのまま読む。形が違う（走っている世界の生の写しなど）なら、その形を書いてほしい。
2. **兵種の対応を版ごとに**：上の表のとおり、中国版の archer（弩兵）は u04a、日本版の horse を「騎馬武者」とするなら u13a。`eraId` ごとの表にしてほしい。
3. **技能の形**：`game.player.skills` は `{lv, xp}` の組（数ではない）。換算には lv（0〜100）を使う、と書いておく。
4. **いる場所**：`game.place.prov`（hist-sim の領 ID）を、hex-sim の始まりの領に使う、と書いておく。
5. **あると助かるもの（任意）**：
   - `game.player.troop.lts[].type` に、hex-sim の兵種 ID も並べて持つ（例 `hexUnit: "u04a"`）。対応の表がずれても困らない。
   - 戦いに出られない状態（深手など）があれば、それを示す項目。
   - セーブの版（`game.version`）を上げたときの変更点を HEX.md に書く。hex-sim は `format` と `game.version` を見て読む。
6. **hex-sim からの約束**：共有の ID（k・x・u）は付け替えない。データは公開物の `data/*.json` で読める（`…/imagined-tactics/data/index.json`）。計算式は hex-sim の `docs/COMBAT.md`。変更は hex-sim の `CHANGELOG.md` に書く。

## 決めたこと（2026-10-15、ユーザー）

- 主人公が浪人（`patron` が 0）のときは、仕官先の勢力を選ばせる。
- 戦いの結果（レベル、兵の損害、技の習得）は ima-rpg に書き戻さない。

## 決めていないこと

- 世界の月：`hist` の世界は遊んだぶん進んでいる。hex-sim はその月から始める（このままでよいか、作るときに確かめる）。
