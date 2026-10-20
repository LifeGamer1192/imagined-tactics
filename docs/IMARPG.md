# ima-rpg のセーブ（.imarpg）の読み込み（検討）

兄弟の作品 ima-rpg（hist-sim の世界を一人の人物として旅する RPG）のセーブを hex-sim で読み込み、同じ人物・仲間・兵・技で戦うための検討。**2026-10-20 に作った（P61・P62）**。作ったものは下の「作ったもの」、数は data/system/imarpg.json。

読んだもの：ima-rpg の `docs/HEX.md`（ブランチ proto-v0.1）と、セーブを書くコード（`src/game/state.ts`・`persist.ts`・`command.ts`・`companions.ts`・`era/era.ts`）。

**2026-10-16 更新**：ima-rpg が HEX.md（proto-v0.1、コミット 1b2d0b8）を、下の「追記案」どおりに書き直した。読み込みを作るときは HEX.md を正とする。この文書と食い違う所は HEX.md に合わせた（兵種の対応・部将の `hexUnit`・戦えない状態）。

## セーブの形（ima-rpg 側の今のコードから）

- ファイル：gzip した JSON `{ format: "ima-rpg", game, hist }`。
- `hist`：**文字列**（`worldText`）。中身は hist-sim のセーブの JSON の文字列で、遊んでいる間に進んだ世界。
- `game`：`GameState`。主なもの：
  - `version`（今は 1）、`eraId`（`sengoku`・`shunju`・`generic`）、`day`、`tick0`（始めたときの hist-sim の月）、`place.prov`（いる領）。
  - `player`：`name`・`sex`・`hp/maxHp`・`fame`・`money`・`patron`（仕える国、0 は無し）・`rank`・`skills`（`{blade, bow, speech, letters, trade, medicine, stealth, theft}` それぞれ `{lv: 0〜100, xp}`）・`arts`（k と x の ID）・`mp`・`troop`・`companions`。
  - `troop`：`{ men, loyalty, lts: [{id, name, type, xp, lv(1〜9), hexUnit}], battles, won, cap }`。`type` は時代の兵種（foot・archer・gun・horse・chariot）。`hexUnit` は hex-sim の兵種 ID（書き出したセーブにだけ付く。無い古いセーブは下の表で `type` から引く）。
  - `player.jail`：獄にいるとき `{ until, prov }`。有れば主人公は戦えない（ima-rpg に深手は無い）。
  - `companions[]`：`{ name, sex, age, job, pid?, blade, bow, medicine, speech（0〜100）, hp, maxHp, loyalty, arts? }`。

## 読み込みの流れ（案）

1. ファイルを gunzip → JSON。`format === "ima-rpg"` を確かめる。
2. `hist` の文字列を、今の「.json の hist-sim セーブ」と同じ道（`readSaveFile(blob, plain=true)`）で読む → 世界（`convert` で GameStart）。
3. 版は `eraId` から：`sengoku` → 日本版（jp）、`shunju` → 中国版（cn）、ほか → hist-sim のセーブの決まりどおり。
4. 主人公を武将にして、`patron` の勢力（hist-sim の国 ID ＝ hex-sim の勢力 ID）に加える。いる領は `place.prov`（その勢力の領でなければ本拠）。`patron` が 0（浪人）なら、読み込んだあとに仕官先の勢力を選んでもらう（勢力の一覧から選び、その勢力の本拠か、いる領に近い領に加わる）。
5. 仲間を武将にする。`pid` があり、変換した世界にその人物がいれば、その武将を主人公の勢力に移す（能力は hist-sim の値のまま）。`pid` が無ければ、下の換算で作る。
6. 部将（`troop.lts`）を兵1隊ずつにして、主人公（入りきらなければ仲間）に付ける。兵種は `hexUnit`（無ければ下の表）。主人公自身の隊も1隊（剣術が弓術より上なら槍、下なら弓）。`player.jail` があれば、主人公は深手と同じ扱い（その間は戦えない）。
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
| horse | **u13a 騎馬武者**（HEX.md の決定。ima-rpg の兵の名が騎馬武者のため） | u07b 騎兵 |
| chariot | ― | u13a 戦車 |

u04a と u13a は、同じ ID で日本版と中国版の兵種が違う（鉄砲足軽／弩兵、騎馬武者／戦車）。対応は版ごとに分けて持つのがよい。

## ima-rpg の docs/HEX.md への追記案（2026-10-16、すべて反映された）

以下を HEX.md に足してほしいと頼んだ。ima-rpg の proto-v0.1 の HEX.md に、すべて入った（`hist` の形、版ごとの兵種の対応、`skills` は `{lv, xp}`、`place.prov`、部将の `hexUnit`、戦えない状態、版の変更点）。

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

## 作ったもの（2026-10-20・P61〜P63）

- 読み込み：`src/bridge/imarpg.ts`（`readImaFile`・`applyIma`）。題の画面の「セーブファイルを選ぶ」で .imarpg を選ぶと、「ima-rpg から来た人々」の画面（`app.ts` の `imaScreen`）。
- 換算は上の表どおり（data/system/imarpg.json で調整できる）。hist-sim の能力4つ（役職の向きと性格に使う）は、学問→政治、剣術・弓術→軍事、弁舌→外交、名声→魅力で見立てる。
- 技・軍略：`arts` のうち hex-sim にあるものを、すべて（技は威力の強い順、軍略は威力・気力の大きい順に並べる。初めは8つずつまでにしていたが、2026-10-20 に上限をなくし、戦闘の画面で多いときは畳むようにした）。技は通常攻撃の前に使う（`GGeneral.skills`）。
- 特性（ユーザーの指示「再現できる範囲で引き継ぐ」）：記録の人物（`pid` のある仲間）は hist-sim の特性のまま。主人公・仲間・ライバルは特性を持たないので、極めた道（feats）・技能（70以上）・悪名・名声・生まれ・仲間の職から、反対の特性と重ならないように3つまで決める（`traitRules`）。
- 仕える国と王：王位（`throne`）があれば、その国の王として迎える。無ければ、仕える国（浪人なら選ぶ）と「主人公を王にする（本来の王は武将に降格。役職は能力から選び直し、当主のぶんの采配を移す）／しない（本来の王のまま）」を選ぶ（ユーザーの指示）。王にすると、役職は当主の系統（政体などから）。
- 仲間：`pid` があり世界にいれば、その武将を主人公の国へ移す。ライバルが仲間になっていれば、ライバルの詳しい状態（`rivals[].g.player`）から作る。ほかは技能から。
- ライバル（仲間でない）：仕える国の武将、または浪人。王位にあれば、その国の当主（主人公を同じ国の王にしたときを除く）。部将を兵として連れる。
- 兵：主人公自身の隊（剣術が弓術以上なら槍、下なら弓。レベルは主人公のレベルの8割）と部将（兵種は `hexUnit`、無ければ版ごとの表）。主人公から順に、采配と1人6隊の上限まで入れ、入りきらなければ仲間、まだ余れば始まりの領の予備兵。
- 獄：日数を30日で1か月として、その月数だけ深手と同じ扱い。討たれた主人公（`dead`）は連れてこない（仲間と兵だけ）。
- 始まりの領：`place.prov` がその国の領ならそこ、ほかは本拠。世界の月は `hist` の世界の月のまま（決めていなかったこと。このままにした）。
- 記録：来た人々のことは記録と年表に「【ima-rpg から】…」と残る。武将の欄に「主人公」「仲間」「ライバル」の札。
- 確かめたもの：tests/imarpg.test.ts（ima-rpg の見本 test_troops を tests/fixtures/ima_test_troops.imarpg に写した）、画面写真。