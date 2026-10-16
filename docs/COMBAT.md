# 戦闘の計算式

hex-sim の戦闘で使っている計算式を1か所にまとめたもの。兄弟の作品（ima-rpg）の1対1の戦いでも、同じ式を使えるように書いてある。

- 係数の正本は `data/system/combat.json`（以下「C」）と `data/system/statuses.json`（以下「S」）。地形は `terrain.json`。
- 式の実装は `src/rules/combat.ts`（命中・ダメージ・会心・軍略）、`src/rules/stats.ts`（状態を含めたいまの能力）、`src/battle/engine.ts`（乱数の引き方・反撃・状態の付き方・ターンの始まり）。
- 公開物では `https://lifegamer1192.github.io/imagined-tactics/data/combat.json` などで同じ JSON を読める（`data/index.json` に一覧）。
- 確率はすべて百分率（0〜100）で持つ。乱数は `r = 0以上100未満の一様乱数` を引き、`r < 確率` なら成功。
- 1対1の戦いに要らない部分（采配範囲・地形・天気・櫓）は、0 または 1 として読めば式がそのまま使える（各節の「1対1では」）。

## 1. いまの能力（状態変化を含む）

| 値 | 式 |
|---|---|
| 攻撃 | `max(1, (武力 × C.atkPerStr ＋ 状態の足し引き) × 采配外の倍率)`。足し引き：次の攻撃アップ S.atkNext.atk、攻撃アップ S.atkUp.atk、攻防ダウン S.weaken.atk、攻撃ダウン S.atkDown.atk |
| 防御 | 混乱中は `S.confuse.def` で固定。ほかは `max(1, (防御 ＋ S.defUp.def（防御アップ）＋ S.weaken.def（攻防ダウン）) × 采配外の倍率)` |
| 機敏 | `機敏 ＋ S.agiUp.agi（命中回避アップ）＋ S.grounded.agi（足止め）` |
| 知略 | `max(1, 知略 ＋ S.intDown.int（知略ダウン）)` |
| 軍略への耐性 | `min(0.9, 特技 tacticResist の合計 ÷ 100 ＋ S.resistUp.pct ÷ 100（軍略耐性アップ） − 采配外なら S.outOfCommand.tacticDamagePct ÷ 100)`。負なら受けるダメージが増える |

- 采配外の倍率：兵が、率いる武将の采配範囲（マス）の外にいるか、武将が倒れているとき `1 ＋ S.outOfCommand.atkDefPct ÷ 100`。ほかは 1。
- 武将の能力は「武将の値 ＋ 役職（classes.json）の mod」。防御・移動・得意地形は役職の値。兵は兵種（units.json）の値に、レベルぶんの成長を足したもの（`基本値 ＋ 成長の中央値 ×（LV−1）`。実際のレベルアップでは成長の幅から乱数）。
- **1対1では**：采配外の倍率は 1。

## 2. 命中率（技）

```
命中 = C.hitBase ＋ 機敏(攻) − 機敏(守) ＋ 技の hit ＋ 地形補正(攻) − 地形補正(守)
       − (相手への記号が「効きにくい」なら C.triPenalty)
       ＋ 特技 hit(攻) − 特技 evade(守)
       ＋ 状況（櫓・雨・霧・夜）
命中率 = clamp(round(命中), C.hitMin, C.hitMax)
```

- 相手への記号：相手の得意地形が騎（rider）なら技の `vsRider`、ほかは `vsGround`。`x` は当てられない（対象に選べない）。`sure` は必中。
- 必中になる場合：記号が `sure`、相手が行動不能（怯み・気絶・混乱）、自分に「次の攻撃が必中」。
- 地形補正：`terrain.json` の `hitMod[いるマスの地形][得意地形]`。
- 状況：櫓（`terrain.ranged[地形].hit`、射程2以上の単体技のみ）、雨（射程2以上の技に C.weather.rainRangedHit）、霧（2マス以上離れた相手に C.weather.fogFarHit）、夜（C.weather.nightHit）。
- **1対1では**：地形補正・状況は 0。

## 3. ダメージ（技）

```
基準 = floor( 技の power × 攻撃(攻) ÷ 防御(守)
              × 特効の倍率 × 反撃の倍率 × 雨の日の火の倍率 )   （1未満は1）
実際 = round( 基準 × 乱数[C.randomMin, C.randomMax]
              × (会心なら C.critMult) × (会心かつ効果 critBonus なら 1.25)
              × (盾で受けたら 0.5) )                          （1未満は1）
```

- 特効：特技 `bane`（相手の得意地形が vs なら ×(1＋pct÷100)）、`baneOnTerrain`（相手のいる地形が terrain なら同じ）。
- 反撃の倍率：反撃のときだけ `C.counterMult × (1 ＋ 特技 counterDamage の合計 ÷ 100)`。
- 雨の日の火：雨で、技の id が `C.weather.fireSkills` にあれば `C.weather.rainFireMult`。
- 盾：守る側の特技 `shield` の chance（百分率）で成功すると半分。単体技のときだけ。
- `noDamage` の技はダメージ0（効果だけ）。
- 乱数を引く順番：命中 → ダメージの乱数 → 会心 → 盾 → 効果（効果ごとに1回）。
- 画面の「期待値」は `基準 × 命中率 ÷ 100`（乱数と会心は入れない）。

## 4. 会心

`会心率 = clamp(C.critRate ＋ 特技 crit の合計 ＋ 武将の critPct（特性「残酷」など）, 0, 100)`。会心で ×C.critMult。

## 5. 反撃

- 単体の技（shape が single）で攻撃されたとき、相手は「通常攻撃」（技の `basic` かつ `counter` が真のもの。武将は役職の attack）で1回だけ反撃する。
- 反撃できない：技の `noCounter`、相手が行動不能、寝返り中、通常攻撃の射程の外、通常攻撃の記号が x。
- 反撃の命中・ダメージは、上の式を攻守を入れ替えて使い、ダメージに反撃の倍率を掛ける。反撃にさらに反撃はしない。

## 6. 状態異常

| 付け方 | 式 |
|---|---|
| 技の効果 `status` | 当たったあと、効果の chance（百分率）で付く |
| 技の効果 `weakenStun` | 当たったあと chance で、攻防ダウン（S.weaken.turns ターン）と気絶 |
| 軍略 `damage` で status が `{status, chance}` | 当たったあと chance で付く |
| 軍略 `status`（sure でない、敵に） | 成功率 `clamp(round((C.statusBase ＋ 知略(攻) − 知略(守)) × (1 − max(0, 耐性))), C.statusMin, C.statusMax)` |
| 軍略 `status`（sure、または味方に）、`buff`・`debuff` | 必ず付く |

- 特技 `immune` に含まれる状態は付かない。
- 続くターン：怯み・攪乱・寝返り・気絶は S.<id>.turns の範囲から乱数。軍略は tactics.json の turns。ほかは S.<id>.turns か、終わるまで。同じ状態が付いていれば、長い方に延ばす。
- 状態の効き目は S（statuses.json）：毒は番の始まりに最大体力の S.poison.pct%、毎ターン回復は S.regen.pct%、混乱は防御を S.confuse.def に固定、など。気絶は攻撃を受けると解ける。
- 武将は寝返らない。
- **1対1では**：寝返り（陣営が入れ替わる）は「行動不能」と読み替えるとよい。

## 7. 軍略のダメージ・回復

```
軍略ダメージ基準 = max(1, floor( power × (知略(攻) × C.tacticIntMult)
                                 ÷ (知略(守) ＋ 防御(守)〔C.tacticDefInDenominator が偽なら 100〕)
                                 × (1 − 耐性) × 雨の日の火の倍率 ))
実際 = round(基準 × 乱数[C.randomMin, C.randomMax])   （会心・盾は無い）
回復量 = round( power × (0.6 ＋ 知略 ÷ 150) × (1 ＋ 回復の特性 healPct ÷ 100) )
```

- 軍略は外れない（damage・heal・buff など）。確率で決まるのは 6. の状態だけ。
- 用心（ward）が付いた相手には、1度だけ軍略が効かない（看破を除く）。

## 8. 気力

- 戦いの始まりは最大気力（武将：成長した mp ＋ 役職の mod.mp、兵：兵種の mp ＋ 成長）。
- 技・軍略を使うと、その mp を引く。足りなければ使えない。
- 戦いの中で自然には戻らない。戻すのは軍略 `mpRestore`（amount だけ、最大まで）。技の効果 `mpHalf` は相手の気力を半分（切り捨て）にする。
- 軍略は、移動したあとと攪乱中には使えない。技は `afterMove` が偽なら移動したあとに使えない。

## 9. 経験値（参考）

- 技・軍略を使うと C.useExp（回復・立て直しは C.healExp）、相手を倒すと `exp.json` の kill（`base ＋ perLv × 相手のLV`）。
- 次のレベルまで：`round(K × (1 ＋ (LV−1)² ÷ exp.curve.div))`。K は exp.json の k（役職・兵種ごと）。レベルに上限は無い。
