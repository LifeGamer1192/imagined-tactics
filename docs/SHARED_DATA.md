# 共有する戦闘のデータ（技・軍略・兵種・役職）

兄弟の作品 ima-rpg と共有しているデータの場所と形。計算式は `docs/COMBAT.md`、変更の記録は `CHANGELOG.md`。

## 場所

- 正本：このリポジトリの `data/system/*.json`。コードには数値を書かず、ここから読む（`src/data/db.ts`）。
- 公開物：ビルドのときに `tools/export-data.mjs` が同じ中身を `data/` に写す。公開先では次で読める（コードを読まなくてよい）。
  - `https://lifegamer1192.github.io/imagined-tactics/data/index.json`（一覧と版）
  - `…/data/skills.json`・`tactics.json`・`units.json`・`classes.json`・`statuses.json`・`combat.json`・`terrain.json`・`exp.json`・`growth.json`
- 型の定義：`src/data/types.ts`（`SkillDef`・`TacticDef`・`UnitDef`・`ClassDef`）。

## 約束

- ID（技 `k001`〜`k092`、軍略 `x01`〜`x39`、兵種 `u01a`〜`u18c`）は両方の作品で共有している。**番号を付け替えない・使い回さない**。消すときは欠番にする。足すときは続きの番号にする。
- 名前は `{ "jp": 日本版, "cn": 中国版 }`。
- 数値の形（項目の名前・単位）を変えるとき、値を変えるときは、`CHANGELOG.md` に書く。
- 確率は百分率（0〜100）。割合（0〜1）なのは、技の効果 `lifesteal` の rate と、耐性の内部の値だけ。
- 着想元になった既存の作品の名前は、データにも文書にも書かない。

## skills.json（技 k###）

| 項目 | 意味 |
|---|---|
| id, name | ID と名前 |
| mp | 使う気力 |
| power | 威力（ダメージの式の power） |
| range | 射程 `[最小, 最大]`（マス） |
| hit | 命中の補正（命中の式に足す） |
| vsGround / vsRider | 地上・騎馬の相手への記号。`sure`＝必中、`o`＝有効、`tri`＝効きにくい（命中 −C.triPenalty）、`x`＝当てられない |
| afterMove | 移動したあとでも使えるか |
| counter / basic | 反撃に使うか／通常攻撃か（反撃に使うのは basic かつ counter の技） |
| shape | `{type:'single'}`＝1体、`{type:'line', n}`＝向いた方へ直線 n マス、`{type:'around', n}`＝周り n マス |
| targets | `enemy`＝敵だけ、`all`＝味方も巻き込む |
| effects | 当たったあとの効果。`status`（status, chance%）、`lifesteal`（rate＝与えたダメージの割合を回復）、`weakenStun`（chance%）、`mpHalf`、`heal`、`knockback`、`critBonus`（会心のとき ×1.25） |
| noDamage / needsWater / noCounter | ダメージ無し／水の上でだけ使える／相手は反撃できない（無ければ偽） |
| reload | 装填の要る技。状態「装填済み」のときだけ使え、使うと外れる。待機で込める（無ければ偽。0.7.3） |

## tactics.json（軍略 x##）

| 項目 | 意味 |
|---|---|
| id, name, mp, power | ID・名前・気力・威力 |
| range | 射程（マス）。`null` は射程なし（自分の周り・戦場全体） |
| area | 0＝1体、1以上＝効果の半径 |
| sure | 状態の軍略で、知略の比べ合いをせず必ず付く |
| kind | `damage` `heal` `cure`（状態異常を治す）`mpRestore` `buff` `debuff` `status` `dispel`（強化・弱体を消す）`pull`（味方を引き寄せる）`revive`（倒れた兵を立て直す）`displace`（敵を飛ばす） |
| status | 付ける状態。文字列か `{status, chance%}`（damage のとき、当たったあとの確率） |
| turns / amount / purge / friendlyFire / anyTarget | 続くターン／気力の回復量／敗残兵を消す／味方も巻き込む／敵味方どちらにも使える |

## units.json（兵種 u###）

| 項目 | 意味 |
|---|---|
| id, name | ID と名前 |
| line, tier | 系統（1〜18）と段（1〜3） |
| cost | 采配の重さ（武将の采配力から引く） |
| hp, mp, str, int, agi, def, move | Lv1 の能力（体力・気力・武力・知略・機敏・防御・移動） |
| affinity | 得意地形（plain・forest・mountain・swamp・water・rider） |
| growth | レベルが1上がるごとの伸び `[最小, 最大]`（hp・mp・str・int・agi） |
| skills / tactics | 使える技・軍略の ID |
| passives | 特技（`evade`・`hit`・`crit`・`counterDamage`・`tacticResist` は pct%、`shield` は chance%、`regen` は pct%（on があればその地形で）、`immune` は statuses、`bane` は vs と pct、`remove`・`doubleAct`） |
| promote | 昇格先 `{to, lv?, item?}` |

## classes.json（武将の役職）

| 項目 | 意味 |
|---|---|
| id, name, sex, tier, from, line, unique | ID・名前・性別・段・前の役職・系統・固有 |
| req | 就く条件（武力・知略・機敏・レベル・熟練） |
| mod | 武将の能力に足す値（hp・mp・str・int・agi） |
| def, move, affinity | 防御・移動・得意地形 |
| attack | 通常攻撃 `{kind: melee|bow, power, range, hit}`。技の形にすると id `atk:<役職id>`、記号は地上 o・騎馬は melee なら tri、bow なら o |
| tactics | 覚えている軍略の ID |
