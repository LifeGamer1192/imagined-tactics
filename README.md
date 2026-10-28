# hex-sim

hist-sim のセーブ（.histsim）を読み込み、その状態からヘックスの巡ごとに交互に動くの戦いを始めるゲーム。
日本版（戦国）と中国版（春秋戦国）の2つの名前の版がある。

## 動かし方

node は兄弟フォルダの `node-portable` を使う。

```powershell
$env:PATH = "..\node-portable\node-v22.23.2-win-x64;$env:PATH"
npm install        # 初回だけ
npm run dev        # http://localhost:5183/ で開く
npm test           # テスト
npm run build      # 型チェックとビルド
```

画面の流れ
1. セーブを選ぶ（hist-sim の「書き出し」で保存した .histsim。サンプルも4つ入っている。hist-sim の「この状態で hex で遊ぶ」ボタンからも始められる）
2. 編成：攻め手・守り手の勢力と、出陣する武将を3人まで選ぶ
   - 「戦闘開始」で1戦だけの合戦
   - 「戦略を始める」で、領を取り合う戦略パート
3. 戦闘：自軍のユニットを選び、青いマスで移動、技・軍略を選んで赤いマスで対象を決める。右クリックか Esc で取り消し

## フォルダ

| フォルダ | 中身 |
|---|---|
| `docs/` | 仕様の md（00〜14）。計画は `13_実装計画.md`、進み具合は `15_実装状況.md` |
| `data/system/` | 仕組みのデータ（役職・兵種・技・軍略・地形・経験値）と、係数（戦闘式・変換ルール・成長） |
| `src/core/` | 乱数、優先度付きキュー、ヘックス座標 |
| `src/bridge/` | hist-sim のセーブの読み込み |
| `src/convert/` | セーブ → 勢力・武将・兵・領 への変換 |
| `src/rules/` | 能力の補正、移動、戦闘計算、成長と昇進 |
| `src/battle/` | 戦場マップ、戦闘の進行、結果の反映 |
| `src/ai/` | 敵の思考 |
| `src/strategy/` | 戦略パート（徴兵・移動・侵攻・月送り） |
| `src/render/` `src/ui/` | 描画と画面 |
| `tests/` | テストと、テスト用のセーブ（`fixtures/`） |
| `tools/` | `sim.ts`（画面なしの自動対戦）、`smoke.mjs`（ブラウザでの動作確認） |

`core` `bridge` `convert` `rules` `battle` `ai` `strategy` は画面を参照しない。テストと自動対戦は画面なしで回る。

## 道具

```powershell
npx vite-node tools/balance.ts 6 8                     # 3つのセーブで自動対戦を回し、勝率・長さ・経験値・兵種ごとの損耗をまとめる
npx vite-node tools/sim.ts sengoku_fid5_1575 30        # 決まった2勢力で30戦（末尾に swap を付けると攻守を入れ替える）
npx vite-node tools/trace.ts sengoku_fid5_1575         # 1戦の経過（各巡の構え・距離・行動の内訳）を追う
node tools/smoke.mjs shots                             # 開発サーバーを動かした状態で。ブラウザを自動操作して51項目を確かめ、画面を保存する
node tools/preview-check.mjs                           # ビルドした版（npx vite preview --port 5184）の確認
```

自分の手で試す手順は `docs/16_試験手順.md` にある。

## 調整するところ

数値はすべて `data/system/` の JSON にある。

| ファイル | 内容 |
|---|---|
| `combat.json` | 戦闘式の係数（命中の基本値、△の命中減、会心、獲得経験値の倍率など） |
| `ai.json` | 戦闘の思考：判断の軸ごとの重み、特性と性格の対応、構えを決めるしきい値 |
| `convert.json` | 変換ルールの係数（能力値の式、初期役職、当主の役職、開始時の兵、時代による解禁） |
| `growth.json` | 武将のレベルアップ時の上昇量 |
| `classes.json` `units.json` `skills.json` `tactics.json` | 役職・兵種・技・軍略 |

## hist-sim から直接受け取る

hex-sim は、開かれたときに開いた側のウィンドウへ `{type: 'hex-sim:ready'}` を送り、
`{type: 'hex-sim:save', snapshot}`（hist-sim の `snapshot()` の結果）を `postMessage` で受け取ると、そのセーブで始める。
hist-sim 側の「この状態で hex で遊ぶ」ボタンは未実装。

## 公開前の確認

開発サーバー（`npm run dev`、http://localhost:5183/）を動かしてから実行する。Playwright は兄弟フォルダ hist-sim にあればそれを借り、無ければこのリポジトリか全体に入れたものを使う（`tools/pw.mjs`）。

| 確認 | コマンド |
|---|---|
| 型とテスト | `npm run build`、`npm test` |
| 画面のひととおり（51項目） | `node tools/smoke.mjs` |
| 観戦・速さ・音・記録の切り替え | `node tools/watch-check.mjs` |
| 戦略の操作（PC幅とスマホ幅） | `node tools/campaign-check.mjs` |
| 外交の操作 | `node tools/diplomacy-check.mjs` |
| 遊び方の案内 | `node tools/help-check.mjs` |
| 見本5つの通し（観戦の1戦＋戦略24か月） | `node tools/soak-check.mjs`（ビルド版には `HEX_URL` で場所を指定） |
| 操作への反応（無反応は0.2秒以内） | `node tools/respond-check.mjs` |
| サブフォルダに置いたビルド版 | `node tools/subdir-check.mjs` |

公開の手順は `docs/17_公開の手引き.md`。