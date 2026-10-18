// 遊び方の案内。画面の右下にいつも出る「？」ボタンで開く重ね表示。
// 用語と数値は data/system/ の JSON から作る（文章に数値を直書きすると、調整したときにずれるため）。
// 言葉は画面に出るものに合わせる。日本版・中国版で変わる名前は、開くたびに今の版で作り直す。

import convertJson from '../../data/system/convert.json';
import { BM } from '../battle/map';
import { MAX_GENERALS, MAX_ROUNDS } from '../battle/setup';
import { D, getVariant, L, term } from '../data/db';
import type { Affinity, StatusId, TerrainKind } from '../data/types';
import { SLOTS } from '../persist/save';
import { TERRAIN_NAME } from '../render/battleView';
import { FIELD } from '../rules/stats';
import { S } from '../strategy/config';
import { AFFINITY_NAME, STATUS_NAME, TRAIT_NAME } from './text';

type Tab = 'intro' | 'strategy' | 'battle' | 'terms';
const TABS: [Tab, string][] = [['intro', 'はじめに'], ['strategy', '戦略'], ['battle', '戦闘'], ['terms', '用語']];
const CONVERT = convertJson as unknown as { supply: { recruitCostMult: number }; troops: { maxPerGeneral: number } };

/** 普請の一覧（建物・兵糧・戦場に現れるもの） */
const BUILD_HELP = `${dlBuild()}`;
function dlBuild(): string {
  const rows = Object.entries(BM.build.costs).map(([k, cost]) => `<dt>${BM.buildings[k]?.name ?? k}（兵糧${cost}）</dt><dd>${BM.buildings[k]?.text ?? ''}</dd>`);
  rows.unshift(`<dt>城を固める（兵糧${BM.build.fortCostBase}＋城の強さ×${BM.build.fortCostPerFort}）</dt><dd>城の強さが${Math.round(BM.build.fortStep * 100)}%上がる。守備兵が強くなり、拠点が 陣 → 砦 → 城 → 城壁つきの城 と変わる</dd>`);
  return `<dl>${rows.join('')}</dl>`;
}
const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const dl = (rows: [string, string][]): string => `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const ul = (rows: string[]): string => `<ul>${rows.map((r) => `<li>${r}</li>`).join('')}</ul>`;
const ol = (rows: string[]): string => `<ol>${rows.map((r) => `<li>${r}</li>`).join('')}</ol>`;
/** その種類の軍略の、今の版の名前（例：状態異常を治す軍略） */
const tacticName = (kind: string): string => { const t = D.tactics.find((x) => x.kind === kind); return t ? L(t.name) : ''; };

// ------------------------------------------------------------ はじめに

function intro(): string {
  return `
    <h3>どんなゲームか</h3>
    <p>hist-sim で作った世界のセーブを読み込み、その時点の勢力と武将で遊ぶ、ヘックス（六角形のマス）の戦いのゲームです。遊び方は2つあります。</p>
    ${ul([
      '<b>国モード</b>（国を選ぶ）：国を1つ受け持ち、月ごとに兵を集めて領を取り合う。攻め込み・攻められれば戦う。',
      '<b>局地戦モード</b>（局地戦を1戦だけ遊ぶ）：勢力を2つ選んで、1戦だけ戦う。戦いは国モードと同じ画面で行う。',
    ])}
    <h3>始め方</h3>
    ${ol([
      'タイトルの「セーブファイルを選ぶ」で、hist-sim から書き出したセーブ（.histsim）を選ぶ。手元に無ければ、サンプルのどれかを押す。',
      '「遊び方を選ぶ」の画面で、国モードか局地戦モードを選ぶ。',
      '国モード：国の一覧から主になる国と難しさを選び、「◯◯で始める」を押す。「国を選ばず観戦する」は、すべての国をおまかせにして眺める。',
      `局地戦モード：攻め手と守り手の勢力を選び、出陣する武将を${MAX_GENERALS}人まで選ぶ。「操作」で自分が動かす側を選び、「戦闘開始」を押す。`,
    ])}
    <p>hist-sim の「セーブとロード」にある「この状態で hex で遊ぶ」を押すと、ファイルを選ばなくても、その世界がそのまま「遊び方を選ぶ」の画面に届きます。どの画面からも、右上の「モードを選ぶ」で戻れます。</p>
    <h3>名前の版</h3>
    <p>兵種・役職・技・軍略の名前には、日本版と中国版があります。画面の右上の「名前の版」で切り替えます（今は${getVariant() === 'jp' ? '日本版' : '中国版'}）。</p>
    <h3>セーブ</h3>
    ${ul([
      `保存できるのは戦略だけ。戦略の画面の「セーブ」を押す。枠は「自動」（月が変わるたびに入る）と、手動の${SLOTS.length - 1}つ。`,
      'セーブは、いま使っているブラウザの中に入る。別の端末で続けるときは「ファイルに書き出す」で .hexsim を作り、タイトルの「セーブファイルを選ぶ」で読み込む。',
      '保存があると、タイトルに「つづきから」が出る。',
      '戦闘の途中は保存できない。',
    ])}`;
}

// ------------------------------------------------------------ 戦略

function strategy(): string {
  const q = S.quest, dip = S.diplomacy, sg = S.siege, p = S.people, hist = S.history;
  const traits = (group: Record<string, { name: string; text: string }>): string =>
    Object.values(group).map((t) => `<b>${t.name}</b>（${t.text}）`).join('、');
  return `
    <h3>月の流れ</h3>
    ${ol([
      '地図の領をクリックすると、右にその領と、そこにいる武将が出る。',
      '自分の領で、徴兵・移動・攻めるなどを行う。',
      '「月を進める」で1か月進む。兵糧に収入が入り、ほかの勢力が動く。攻められたときは、「自分で戦う」か「おまかせ」かを選ぶ窓が出る。',
    ])}
    <p>上の帯に、年月、自分の勢力、兵糧（かっこの中は月ごとの収入）、領の数が出ます。武将は、移動するか攻めると、その月は「行動済」になります。</p>
    <h3>徴兵</h3>
    <p>武将の行で兵種を選び、「徴兵」を押すと、その武将の兵が1隊増えます。</p>
    ${ul([
      `費用は兵糧。その兵種の采配負担 × ${CONVERT.supply.recruitCostMult}（勢力の特色で安くなる兵種がある）。`,
      `兵は武将1人につき${CONVERT.troops.maxPerGeneral}隊まで。兵の采配負担の合計は、武将の采配力を超えられない（武将の行の「采配 12/80」は、負担の合計／采配力）。`,
      `軍略を使う兵は、武将1人につき${S.tactical.capPerGeneral}隊まで。`,
    ])}
    <h3>移動</h3>
    <p>武将にチェックを入れて「移動」を押し、青くなった自分の領をクリックします。1か月に、自分の領づたいに${S.move.range}つ先まで移れます（ほかの勢力の領は通り抜けられません）。海沿いの領は、海路でつながった領も隣になります。</p>
    <p>「まとめて選ぶ」で、その領の全員、またはレベルの高い${MAX_GENERALS}人を一度に選べます。</p>
    <h3>攻める</h3>
    <p>武将にチェックを入れて（${MAX_GENERALS}人まで）「攻める」を押し、赤くなった隣の領をクリックします。</p>
    ${ul([
      '守る武将がいれば戦いになる。「自分で戦う」か「おまかせ」かを選ぶ。攻め手が勝てば、領が手に入る。',
      '中立の相手に攻め込むと、戦争になる。味方と、停戦中の相手は攻められない。',
    ])}
    <h3>守る武将のいない領</h3>
    <p>守る武将のいない領は、守備兵が守ります。守備兵は弱く、強さはその領の城の強さと人口で決まります。攻め込むと守備兵との戦いになり、「観戦」か「おまかせ」を選びます。観戦は戦いを見ます（途中で「手動にする」を押すと、自分で動かせます）。おまかせは、結果だけ出ます。大事な領には、武将を置いておきましょう。</p>
    <h3>兵の入れ替え</h3>
    <p>武将の欄で兵の名前をつまんで（マウスでも指でも）、同じ領にいる別の武将の欄へ運ぶと渡せます。武将の欄の外へ落とすと、手放すかを聞かれます。兵の名前を押して出る欄からも、同じことができます。渡す相手には、采配力と隊数の空きが要ります。手放しても兵糧は戻りません。</p>
    <h3>予備兵</h3>
    <p>どの武将にも付いていない兵は、その領の「予備兵」になります（${S.reserve.max}隊まで）。兵を予備兵の欄へ運ぶと予備兵になり、予備兵を武将の欄へ運ぶとその武将に付きます。武将がいなくなったとき、その兵も予備兵になります。予備兵は戦いには出ません。予備兵は領に付いていて、領を奪われると相手のものになり、予備兵のいる領を奪えば手に入ります（ほかの勢力の領でも、武将が世を去るなどして残った兵が予備兵になっています。領を選ぶと数が見えます）。</p>
    <h3>史実の出来事</h3>
    <p>hist-sim の時代の見本（戦国・春秋戦国など）から始めると、史実の出来事が、その年月に起きます（要る勢力がそろっているときだけ。歴史が変わって勢力が無ければ起きません）。起きる効果は、人物や当主の死去・兵の減少・兵糧の増減・本拠の移りと、外交（戦・停戦・同盟・同盟の解消・従属・宗主から離れる・家の名の改め）です。あなたの家が受ける側の停戦・同盟・従属は「史実の出来事から」の申し込みとして届き、受けるか断るかを選べます（史実の停戦は、史実の長さになります）。ほかの家からあなたの家への宣戦は起きます。あなたの家から仕掛ける戦・あなたの家が他家に従うこと・あなたの家の名の改めと、兵や武将への効果は起こしません。領の動き（割譲・併合・領を削る・分裂・新しい家の起こり）も起きます。新しい家は、史実の名・色・本拠・当主で立ち、領を奪って起こった家は、奪われた家と戦になります。あなたの家にかかわる領の動きは、領の画面の上に「史実：…」の欄が出て、受けるか断るかを選べます（${hist.choiceMonths}か月のうちに選ばないと、断ったことになります）。領を得るものは、断っても何も起きません。領を求められて断ると、相手の心証が${-hist.refuseOpinion}下がり、相手と戦になります。あなたの領から新しい家が分かれるのを断ると、その領の不満が${hist.refuseUnrest}上がります。併せられるのを受けると、家は滅びず、相手に従います。受けても、本拠だけは渡しません。記録に【史実】と出て、大きな出来事は「今月の知らせ」の窓に出ます。</p>
    <h3>本拠を移す</h3>
    <p>本拠でない自分の領を選ぶと「本拠を移す」があります。兵糧を多く使い（少なくとも${S.capital.costMin}、収入の${S.capital.costIncomeMonths}か月ぶん）、本拠とつながった領なら${S.capital.monthsNear}か月、飛び地なら${S.capital.monthsFar}か月かかります。終わるまでは今の本拠のままで、途中でその領を失うと取りやめになり、兵糧は戻りません。本拠は城になり、飛び地は新しい本拠から数え直します。</p>
    <h3>飛び地</h3>
    <p>本拠から、自分の領づたい（地図の線：陸の隣と海路）にたどり着けない領は「飛び地」です。収入が${Math.round(S.exclave.incomeMult * 100)}%に減り、守備兵が弱くなり（レベル${Math.abs(S.exclave.garrisonLevel)}減・${Math.abs(S.exclave.garrisonTroops)}隊減）、徴兵の兵糧が${S.exclave.recruitCostMult}倍になります。戦いでも、飛び地を守る側と、飛び地から攻めて出た側は、兵糧や援軍が届きにくく、攻撃と防御が${Math.abs(S.exclave.battleAtkDefPct)}%下がります（戦闘の画面の天気の欄に出ます）。あいだの領を取ってつなげると解けます。飛び地の領を選ぶと、警告と、どの領を取ればつながるか（直し方）が出ます。</p>
    <h3>戦場と普請</h3>
    <p>戦場は六角形の盤で、北が上、地形は本当の地理のままです。攻め手は、攻めてきた領の方角（東・南東・南西・西・北西・北東の6つ）の端から入り、守り手・城・城壁は反対側に構えます。山や川のある方角から攻めると苦しく、ほかの方角の領から攻めると楽になることがあります。領の欄の「戦場」で、どの領から攻めるとどうなるかを下見できます。</p>
    <p>戦いの戦場は、領ごとに違います。領の地形（山・森・川・海）に、領のようす（人口が多いほど城下の街が広く、豊かなほど棚田や脇街道が増え、不穏が高いと荒れ地になる）、城の強さ（陣 → 砦 → 城 → 城壁つきの城）、建物が重なって決まります。領の欄の「戦場」を開くと、今戦えばどんな戦場になるかを下見できます（左から攻め、右で守る）。</p>
    <p>自分の領では「普請」で、兵糧を使って建物を建てたり城を固めたりできます（1つの領で1か月に1回）。建てたものはすぐ、その領の戦場に現れます。ほかの勢力も、兵糧に余りがあると、ときどき普請をします。</p>
    ${BUILD_HELP}
    <h3>スマホ・タブレットでの操作</h3>
    <p>地図は、1本指でなぞると動き、2本指を広げると大きくなります。戦いでは、技や軍略の対象を1度押すと見込みが出て、同じマスをもう1度押すと実行します。取り消しは「選択を解く」「技・軍略をやめる」のボタンです。速さ・音・記録のボタンの並びは、横になぞると続きが出ます。</p>
    <h3>おまかせで進める・説明の小窓・確かめる窓</h3>
    <p>「月を進める」の横の「1か月オート」を押すと、自分の勢力の動き（移動・攻め・攻められたときの戦い）もおまかせにして1か月進めます。素早く2度押すと、ずっとおまかせで進みます。どこかを押すと手動に戻ります。</p>
    <p>特性・性格・兵の名前・技や軍略のボタンには、くわしい説明があります。マウスを重ねるか、指で1度押すと小窓で出ます（兵の名前を押して開く欄にも、兵種の説明が出ます）。戦いで技や軍略を選ぶと、届く相手ごとのダメージ・命中・期待値（ダメージ×命中）の表が出ます。</p>
    <p>戦いの「全員待機」は、まだ動いていない自分の兵をすべて待機にします。</p>
    <p>「やめる」「戦を仕掛ける」「諸国巡りに出す」「兵にする」など、取り返しのつかない操作や大きな結果を招く操作は、説明つきの窓で確かめてから進みます。</p>
    <p>攻め込むとき・攻められたときは、攻めてきた領（朱）と攻められた領（金）を地図で示し、矢印でつなぎます。月が変わったとき、自分の勢力にかかわる大きな出来事（訃報・代替わり・寝返り・外交・諸国巡りの帰り・仕官）は、絵を添えた「今月の知らせ」で出ます。</p>
    <h3>名前の変更と、武将と兵の入れ替わり</h3>
    <p>武将は名前の横の「✎」で、兵は名前を押して出る「名前を変える」で、名前を変えられます（${S.officer.nameMax}文字まで）。</p>
    <p>レベル${S.officer.minTroopLevel}以上の兵は「武将にする」で武将に取り立てられます。兵糧が要ります（${S.officer.raiseCostBase}＋レベル×${S.officer.raiseCostPerLevel}）。その隊は無くなり、同じレベルの武将が同じ領に加わります（兵は連れていません）。兵のときの特技と軍略はそのまま使え、将としての特性を1つ得ます（${S.officer.leaderTraits.map((x) => TRAIT_NAME[x] ?? x).join('・')}のどれか）。</p>
    <p>武将（当主を除く）は「兵にする」で兵に下げられます。その領の予備兵1隊になり、率いていた兵も予備兵になります。取り立ての費用の3分の2の兵糧が戻ります。名前とレベルは残りますが、能力・特性・縁は残らず、元には戻せません。</p>
    <h3>深手</h3>
    <p>戦いで倒された武将は深手を負い、${S.people.wound.short}〜${S.people.wound.long}か月のあいだ戦えません（攻めにも守りにも出られません）。長さは武将の特性で変わります（${S.people.wound.shortTraits.map((x) => TRAIT_NAME[x] ?? x).join('・')}は${S.people.wound.short}か月、${S.people.wound.longTraits.map((x) => TRAIT_NAME[x] ?? x).join('・')}は${S.people.wound.long}か月、ほかは${S.people.wound.months}か月）。武将がみな深手の領は、守る武将がいないのと同じです。敵の武将を倒したあとは、攻めどきです。</p>
    <h3>外交</h3>
    <p>ほかの勢力の領を選ぶと、相手との関係（中立・交戦中・味方・停戦中）と、外交のボタンが出ます。</p>
    ${dl([
      ['同盟を申し込む', `中立の相手に。相手の心証が${dip.allianceOpinion}以上なら結べる。`],
      ['戦を仕掛ける', '中立の相手に。攻め込んだときも、同じく戦争になる。'],
      ['停戦を申し込む', `交戦中の相手に。相手の力が自分の${dip.truceStrengthRatio}倍より大きいと断られる。${dip.aiTruceAfter}か月続いた戦争なら受けてもらえる。停戦は${dip.truceMonths}か月続く。`],
      ['同盟を破る', '同盟の相手に。相手の心証が大きく下がる。'],
      ['加勢を頼む', `味方に。相手の心証が${dip.callToArmsOpinion}以上なら、自分が戦っている相手との戦争に加わってくれる。`],
    ])}
    <p>ほかの勢力から、停戦・同盟・従属の申し込みが来ることがあります。画面の上に出るので、受けるか断るかを選びます。${dip.offerMonths}か月放っておくと流れます。同じ敵と戦っている相手とは、月ごとに心証が良くなります。</p>
    <h3>兵糧と難しさ</h3>
    ${ul([
      `兵糧は、収入の${S.supply.capMonths}か月ぶん（少なくとも${S.supply.capMin}）までためられる。画面の上の「兵糧 今の量／上限」で分かる。`,
      `難しさは、国を選ぶ画面で選ぶ（${(['easy', 'normal', 'hard'] as const).map((d) => S.difficulty[d].name).join('・')}）。戦略では、自分の収入（やさしい×${S.difficulty.easy.playerIncome}・むずかしい×${S.difficulty.hard.playerIncome}）、自分の領の守備兵の強さ、相手が自分を狙う度合い、相手の兵の初めのレベル（むずかしいは+${S.difficulty.hard.aiTroopLevel}）、守りのいない領を攻める度合いが変わる。`,
      '戦闘では数値は変わらず、自分と戦う相手の考え方の賢さが変わる。やさしいは、あまり考えずに動き（危険や地形を気にせず、とどめも刺し損ねる）、守り手は城から打って出やすい。むずかしいは、弱った相手を集中して狙い、地形と危険をよく見て、天守を固く守る。さらに、とどめを刺せる駒から先に動き、傷んだ兵は前線から陣などへ下げ、受けるダメージを立つ地形で見積もり、敵を囲み自分は囲まれないように動き、気力を使う技は効き目が大きいときに取っておき、攻め手のときは時間が経つほど押し、天守を早めに目指す。局地戦では、編成の画面の「相手」で選ぶ。',
    ])}
    <h3>諸国巡り</h3>
    <p>当主のほかの武将を、${q.months}か月の旅に出せます（武将の欄の「諸国巡りに出す」）。その間は戦えません。戻ったときに、次のどれかが起きます。</p>
    ${ul([
      `昇進の品を持ち帰る（${pct(q.item)}）`,
      `浪人を連れ帰る（${pct(q.ronin)}）`,
      `経験を積んでレベルが上がる（${pct(q.exp)}）`,
      `何も無い（${pct(Math.max(0, 1 - q.item - q.ronin - q.exp))}）`,
    ])}
    <h3>昇進</h3>
    <p>条件を満たすと、武将の欄にボタンが出ます。「昇進：◯◯」は武将の役職、「◯◯ → ◯◯」は兵の兵種が上がります。兵種の最上位には、諸国巡りで得る品が要るものがあります。持っている品は、上の「特色」の行の右に出ます。</p>
    <h3>勢力の特色</h3>
    <p>勢力は、経済と政体から1つずつ特色を持ちます。自分の特色は、画面の上の「特色」に出ます。</p>
    ${dl([['経済', traits(S.traits.economy)], ['政体', traits(S.traits.government)]])}
    <h3>人の出入り</h3>
    ${ul([
      `武将は年の初めに歳を取る。${p.oldAge}歳を超えると、世を去ることがある。当主が欠けると、跡継ぎが継ぐ。`,
      `幼い一族は、${p.comingOfAge}歳で元服して加わる。`,
      '忠誠の低い武将は、隣の敵の勢力へ寝返ることがある。滅んだ勢力の武将の一部は、滅ぼした勢力に降る。浪人が仕えてくることもある。',
    ])}
    <h3>人物どうしの縁</h3>
    <p>武将には、hist-sim から引き継いだ縁（友・義兄弟・師弟・伴侶・好敵手・仇など）があります。起きたことは記録に出ます。</p>
    ${ul([
      '友・義兄弟・師弟・伴侶：負けた側の武将が、戦場で出会った相手の勢力に仕えることがある。',
      '好敵手：戦場で出会うと、どちらも経験を得る。',
      '仇：勝った側が仇を討ち取ることがある（当主は討たれない）。討たれた武将の義兄弟や伴侶は、討った武将を新たな仇とする。',
      '師弟：年の初めに同じ領にいれば、若い方が経験を得る。',
      '同じ勢力に義兄弟や伴侶がいると寝返りにくく、好敵手や仇がいると寝返りやすい。縁のある相手のいる勢力へ移りやすく、仇のいる勢力へは移らない。',
    ])}
    <h3>勝ち負け</h3>
    <p>味方のほかに勢力が残っていなければ、天下を取ったことになります。自分の勢力が滅びると終わりです。</p>`;
}

// ------------------------------------------------------------ 戦闘

function battle(): string {
  const C = D.combat, out = D.status.outOfCommand, hit = D.terrain.hitMod;
  return `
    <h3>進み方</h3>
    <p>攻め手と守り手が、交互に番を持ちます。自分の番に、ユニット（武将と兵）を1つずつ動かし、終わったら「ターン終了」を押します。攻め手と守り手が1回ずつ動くと、1巡です。</p>
    <p>自分で動かす戦いは、始める前に「配置」があります。自分の駒を押してから青いマス（自分の配置場所）を押すと動き、自分の駒がいるマスなら入れ替わります。「配置完了（戦闘開始）」で戦いが始まります。</p>
    <h3>選ぶ</h3>
    ${ul([
      '自軍のユニットをクリックすると、右に情報と行動のボタンが出る。',
      '相手のユニットをクリックすると、情報だけが出る。',
      '右クリックか Esc で、選んだものを取り消す。',
      'マウスのホイールで拡大と縮小、ドラッグで地図を動かす。',
    ])}
    <h3>動かす</h3>
    ${ul([
      '選んだユニットの動けるマスが青くなる。青いマスをクリックすると移動する。',
      '行動する前なら、「移動を取り消す」で元の場所に戻せる。',
      '移動と行動は、1つの番に1回ずつ。何もしないときは「待機」。',
      '騎馬など一部の兵は、攻撃したあとに、残った移動の分だけ動ける。',
    ])}
    <h3>技と軍略</h3>
    ${ul([
      '技か軍略のボタンを押すと、対象にできるマスが赤くなる。赤いマスにマウスを乗せると、右に予測（ダメージ・命中率・反撃）が出る。クリックで実行する。',
      `<b>技</b>は主に${term('str')}で戦う攻撃。大きな技には、移動したあとは使えないものがある。`,
      `<b>軍略</b>は${term('int')}で効き目が決まる。攻撃のほか、回復・補助・妨害がある。${term('mp')}を使い、<b>移動する前にだけ</b>使える。`,
      `ボタンの「威力」「射程」「気」は、強さ、届く距離、使う${term('mp')}。`,
    ])}
    <h3>当たるかどうか</h3>
    ${ul([
      `命中率は ${C.hitBase}% を元に、${term('agi')}の差、技の当てやすさ、地形で上下する（${C.hitMin}〜${C.hitMax}%）。`,
      `${C.critRate}% で会心になり、ダメージが${C.critMult}倍になる。ダメージは毎回 ${C.randomMin}〜${C.randomMax}倍の間でぶれる。`,
      `騎馬や戦車（得意地形が「騎」）には、近くからの攻撃が当たりにくいものがある（命中 −${C.triPenalty}）。弓は当たりやすい。`,
    ])}
    <h3>采配の範囲</h3>
    <p>兵は、率いる武将のそばで戦います。武将か、その兵を選ぶと、采配範囲が地図に出ます。範囲の外に出た兵には「采配範囲外」が付き、攻撃と防御が${Math.abs(out.atkDefPct)}%下がり、軍略で受けるダメージが${out.tacticDamagePct}%増えます。</p>
    <h3>地形</h3>
    <p>マスの地形で、移動にかかる力と、命中・回避が変わります。ユニットごとに得意地形があり、得意な地形では速く動けて、当てやすく、避けやすくなります。</p>
    ${ul([
      `${TERRAIN_NAME.castle}（${signed(hit.castle.plain)}）と${TERRAIN_NAME.town}（${signed(hit.town.plain)}）は、誰にとっても守りやすい。`,
      `${TERRAIN_NAME.forest}・${TERRAIN_NAME.mountain}・${TERRAIN_NAME.swamp}は、得意なら ${signed(hit.forest.forest)}、苦手なら ${signed(hit.forest.plain)}。`,
      `得意地形が「騎」のユニットは、${TERRAIN_NAME.water}と${TERRAIN_NAME.cliff}に入れない。`,
      '地形ごとの数値は「用語」の地形の表にある。',
    ])}
    <h3>城攻めと天気</h3>
    ${ul([
      '守り手の領の城の強さで、守り手の拠点が陣・砦・城に変わる。本拠や城の強い領では、城壁と門と櫓のある城攻めになる。',
      '城壁は歩兵なら乗り越えられるが、移動に大きな力が要る。騎馬や戦車は門を通る。',
      '天気（晴れ・雨・霧・雪）と昼夜は、戦いごとに季節から決まり、戦闘画面の上に出る。雨は飛び道具と火に、霧は離れた相手への攻撃に、雪は移動に響く。',
    ])}
    <h3>反撃</h3>
    <p>1体を狙う攻撃を受けたユニットは、倒されなければ通常攻撃でやり返します。次のときは反撃しません。</p>
    ${ul([
      '攻めてきた相手が、自分の通常攻撃の届かない所にいる（弓で遠くから撃たれた、など）。',
      `${STATUS_NAME.daze}・${STATUS_NAME.stun}・${STATUS_NAME.confuse}・${STATUS_NAME.defect}の状態にある。`,
      '直線や周囲をまとめて攻める技、反撃を受けない技で攻められた。',
    ])}
    <h3>勝ち負け</h3>
    ${ul([
      '相手の武将をすべて倒すと勝ち。',
      `${MAX_ROUNDS}巡を過ぎると、守り手の勝ち。攻め手は急ぐ必要がある。`,
      `門・砦の門・柵は「造り」で、耐久がある（門${BM.structures.gate.hp}・砦の門${BM.structures.fortgate.hp}・柵${BM.structures.palisade.hp}）。門と砦の門は、攻め手は壊すまで通れない（守り手は通れる）。柵は騎馬が通れず、歩兵も重い。攻め手の駒を造りの隣（通常攻撃の届く所）に置くと「壊す（門・柵）」が出て、通常攻撃で打てる（石火矢・大筒の系統は${BM.structures.siegeMult}倍、火の攻撃は${BM.structures.fireMult}倍）。壊れた門は道に、柵は平地になる。傷んだ造りの下には耐久の棒が出る。`,
      '物見櫓に乗ると、射程2以上の技の命中と射程が上がる（櫓と同じ）。攻め手が取れば攻め手が使える。騎馬は乗れない。',
      '城の戦場では、攻め手が天守（城のマス。金の点線の輪）を押さえ続けると勝ち。要る巡の数は2〜4（城壁があれば +1、城がとても強ければ +1）で、天守の下に「天守 押さえた巡／要る巡」と出る。追い出されると数は0に戻る。時間切れのとき天守に攻め手がいれば、攻め手の勝ち。',
      `国モードで自分が戦う戦いは、途中でやめられない代わりに「退く」がある。退くと負けになり、重い罰を受ける（体力が${Math.round(S.retreat.troopLossBelowHp * 100)}%を切った兵と、ほかの兵も${Math.round(S.retreat.troopLossChance * 100)}%の見込みで失う。兵糧の${S.retreat.supplyLossPct}%を失う。武将は${S.retreat.woundMonths}か月の深手。守り手なら領も失う）。`,
      '武将が倒れると、その兵は戦場を離れる。',
      '倒れた兵は失われる。戦場を離れただけの兵は残る。倒れた武将は、その戦いから退くだけで、失われない。',
      '戦いのあと、経験値がたまったユニットはレベルが上がる。レベルに上限は無いが、上がるほど次のレベルまでに要る経験値が増える（LV1を1倍として、LV7で2倍、LV13で5倍、LV31で26倍）。倒した相手のレベルが高いほど、多くの経験値を得る。',
    ])}
    <h3>観戦と速さ</h3>
    ${ul([
      '右の「観戦にする」で、両方の陣営をおまかせにできる。「手動にする」で戻る。戦いの途中でも切り替えられる。',
      'おまかせの陣営が動く速さは、「速さ」の 1〜5 で選ぶ（5がいちばん速い）。',
      '速さ5では、駒の動きの演出を省く。音の大きさは、同じ並びの「音」で切・小・大を選ぶ。',
      '「記録」で、右下の記録の細かさを選ぶ。簡易は結果だけ、通常は誰が誰にどの技でいくつ与えたかと体力の変化、詳細は命中率やダメージの計算式まで出る。速さとは別に選べる。',
      '戦略から入った戦いは、途中でやめられない。代わりに「おまかせで決着」で、残りをすぐに終わらせられる。',
    ])}`;
}

// ------------------------------------------------------------ 用語

/** 状態の説明。数値は statuses.json から */
function statusRows(): [string, string][] {
  const s = D.status, hp = term('hp'), agi = term('agi'), int = term('int');
  const span = (t: [number, number]): string => `${t[0]}〜${t[1]}ターン`;
  const text: Partial<Record<StatusId, string>> = {
    poison: `番の始めに、最大${hp}の${s.poison.pct}%を失う。戦いが終わるまで続く。`,
    daze: `${span(s.daze.turns)}動けず、受ける攻撃が必ず当たる。`,
    stun: `${span(s.stun.turns)}動けず、受ける攻撃が必ず当たる。攻撃を受けると解ける。`,
    confuse: `動けず、受ける攻撃が必ず当たる。防御が${s.confuse.def}になる。戦いが終わるまで続く。`,
    silence: `${span(s.silence.turns)}、軍略を使えない。`,
    defect: `${span(s.defect.turns)}、相手の陣営として動く。反撃もしない。兵だけがかかり、武将はかからない。`,
    weaken: `${s.weaken.turns}ターン、攻撃${signed(s.weaken.atk)}、防御${signed(s.weaken.def)}。`,
    atkDown: `${s.atkDown.turns}ターン、攻撃${signed(s.atkDown.atk)}。`,
    intDown: `${s.intDown.turns}ターン、${int}${signed(s.intDown.int)}（軍略の威力と、軍略への強さが下がる）。`,
    grounded: `${s.grounded.turns}ターン、${agi}${signed(s.grounded.agi)}。得意地形が平地になる（馬から降ろされる）。`,
    atkNext: `次に使う技の攻撃${signed(s.atkNext.atk)}。`,
    sureNext: '次に使う技が必ず当たる。',
    atkUp: `${s.atkUp.turns}ターン、攻撃${signed(s.atkUp.atk)}。`,
    defUp: `${s.defUp.turns}ターン、防御${signed(s.defUp.def)}。`,
    agiUp: `${s.agiUp.turns}ターン、${agi}${signed(s.agiUp.agi)}。`,
    moveUp: `${s.moveUp.turns}ターン、移動${signed(s.moveUp.move)}。`,
    resistUp: `${s.resistUp.turns}ターン、軍略で受けるダメージと、かけられる軍略の成功率が${s.resistUp.pct}%下がる。`,
    regen: `${s.regen.turns}ターン、番の始めに最大${hp}の${s.regen.pct}%を回復する。`,
    ward: '次に受ける軍略を、1度だけ無効にする。味方からの回復も無効になる。',
    extraAct: '行動のあと、もう1度動ける。',
    mounted: '得意地形が「騎」になる（馬に乗る）。',
    routed: '倒れた兵が、収容した側の陣営で戦う。戦いが終わると失われる。',
  };
  const rows = (Object.keys(text) as StatusId[]).map((id): [string, string] => [STATUS_NAME[id], text[id]!]);
  rows.push(['采配範囲外', `武将の采配範囲の外にいる兵。攻撃と防御が${Math.abs(s.outOfCommand.atkDefPct)}%下がり、軍略で受けるダメージが${s.outOfCommand.tacticDamagePct}%増える。`]);
  return rows;
}

/** 地形 × 得意地形の表 */
function terrainTable(cell: (k: TerrainKind, a: Affinity) => string): string {
  const affs = D.terrain.affinities;
  return `<div class="scroll"><table>
    <tr><th>地形＼得意</th>${affs.map((a) => `<th>${AFFINITY_NAME[a]}</th>`).join('')}</tr>
    ${D.terrain.kinds.filter((k) => TERRAIN_NAME[k] && k !== 'void').map((k) => `<tr><th>${TERRAIN_NAME[k]}</th>${affs.map((a) => `<td>${cell(k, a)}</td>`).join('')}</tr>`).join('')}
  </table></div>`;
}

/** 地形・天気ごとの、攻撃の種類の倍率（field.json から作る） */
function fieldTable(): string {
  const kinds = Object.keys(FIELD.kinds);
  const fmt = (t?: Record<string, number>) => kinds.filter((k) => t?.[k] !== undefined).map((k) => `<span class="${t![k] > 1 ? 'up' : 'down'}">${L(FIELD.kinds[k])}×${t![k]}</span>`).join(' ');
  const rows = D.terrain.kinds.filter((k) => k !== 'void' && FIELD.terrain[k]).map((k) => {
    const e = FIELD.terrain[k]!;
    return `<tr><th>${TERRAIN_NAME[k]}</th><td>${fmt(e.target) || '−'}</td><td>${fmt(e.attacker) || '−'}</td></tr>`;
  });
  const sky: [string, string][] = [['clear', '晴れ'], ['rain', '雨'], ['fog', '霧'], ['snow', '雪'], ['night', '夜']];
  return `<div class="scroll"><table class="field">
    <tr><th>地形</th><th>相手がいる</th><th>自分がいる</th></tr>${rows.join('')}
    ${sky.map(([k, n]) => `<tr><th>${n}</th><td colspan="2">${fmt(FIELD.weather[k]) || '−'}</td></tr>`).join('')}
  </table></div>`;
}

function terms(): string {
  const cure = tacticName('cure'), dispel = tacticName('dispel');
  return `
    <h3>能力値</h3>
    ${dl([
      [term('hp'), '0になると倒れる。緑の棒。'],
      [term('mp'), '軍略と一部の技で使う。青の棒。ボタンでは「気」と書く。'],
      [term('str'), `技の強さの元。攻撃 ＝ ${term('str')} × ${D.combat.atkPerStr}。`],
      [term('int'), '軍略の威力と成功率、軍略への強さの元。'],
      [term('agi'), '命中と回避の元。相手より高いほど、当てやすく避けやすい。'],
      ['攻撃・防御', '技のダメージは、技の威力 × 攻撃 ÷ 相手の防御。'],
      ['移動', '1つの番に動ける力。地形ごとに、1マスにかかる力が違う。'],
      ['得意地形', `${D.terrain.affinities.map((a) => AFFINITY_NAME[a]).join('・')}のどれか。ユニットの情報の「移動」の右に出る。`],
      ['Lv', 'レベル。戦うと経験値がたまって上がり、能力値が伸びる。上限は無い。'],
      ['采配', '武将が率いられる兵の量。「采配 12/80」は、兵の采配負担の合計／武将の采配力。'],
      ['采配範囲', '武将の周りの、兵が力を出せるマスの数。'],
      ['強さ', '戦略の画面に出る、武将と兵を合わせた力の目安。'],
      ['特性', '勇敢・賢明など、武将の人柄。能力値と性格に効く。'],
      ['性格・構え', 'おまかせのときの動き方。構えは前進・交戦・守備・退却。'],
    ])}
    <h3>状態</h3>
    <p>ユニットの情報に、黄色い字で出ます。かっこの中の数は残りのターン。悪い状態は${cure ? `「${cure}」` : '回復の軍略'}で治り、軍略で付いた強化や弱体は${dispel ? `「${dispel}」` : '打ち消しの軍略'}で消えます。</p>
    ${dl(statusRows())}
    <h3>地形</h3>
    <p><b>1マスに入るのにかかる移動</b>（小さいほど速い。× は入れない）</p>
    ${terrainTable((k, a) => { const v = D.terrain.moveCost[k][a]; return v === null ? '×' : String(v); })}
    <p><b>命中・回避の補正</b>（そのマスにいるユニットが、当てやすく避けやすくなる分）</p>
    ${terrainTable((k, a) => signed(D.terrain.hitMod[k][a]))}
    <p><b>地形と天気で強まる・弱まる攻撃</b>（ダメージの倍率。攻撃の種類：${Object.values(FIELD.kinds).map((n) => L(n)).join('・')}）。「相手」は攻撃を受ける側のいる地形、「自分」は攻める側のいる地形。自分の側の弱まりは、その地形が得意な兵には掛からない。技・軍略を選ぶと、見込みの表のダメージにもう入っている。</p>
    ${fieldTable()}
    <h3>戦略の言葉</h3>
    ${dl([
      ['領', '地図の1区画。持ち主の勢力に収入をもたらす。'],
      ['本拠', '勢力の中心の領。'],
      ['兵糧', '徴兵に使う。月ごとに、持っている領の収入の合計が入る。'],
      ['収入', 'その領から月ごとに入る兵糧。'],
      ['城', '領の守りの固さ（0〜100%）。高いほど、戦場で守り手の拠点が固くなる（陣 → 砦 → 城）。'],
      ['深手', '戦いで倒された武将の状態。しばらく戦えない。'],
      ['心証', '相手の勢力が、こちらをどう思っているか。同盟を結ぶのに要る。戦を仕掛けたり、同盟を破ったりすると下がる。'],
      ['中立・交戦中・味方・停戦中', 'ほかの勢力との関係。攻められるのは、中立と交戦中の相手だけ。'],
      ['当主', '勢力の主の武将。諸国巡りには出せない。'],
      ['浪人', 'どの勢力にも仕えていない武将。'],
      ['行動済', 'その月に移動したか攻めた武将。次の月まで動かせない。'],
      ['品', '兵種を最上位に上げるのに要るもの。諸国巡りで得る。'],
      ['特色', '勢力の経済と政体による得手。「戦略」の「勢力の特色」を参照。'],
    ])}`;
}

const PAGES: Record<Tab, () => string> = { intro, strategy, battle, terms };

// ------------------------------------------------------------ 表示

let back: HTMLElement | null = null;
let tab: Tab = 'intro';

/** いまの画面に合うタブ（戦略の画面なら戦略、戦闘の画面なら戦闘） */
function tabForScreen(): Tab {
  if (document.querySelector('#app #next')) return 'strategy';
  if (document.querySelector('#app .battle canvas')) return 'battle';
  return 'intro';
}

function render(): void {
  if (!back) return;
  back.querySelector('nav')!.innerHTML = TABS.map(([id, name]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${name}</button>`).join('');
  const body = back.querySelector<HTMLElement>('.help-body')!;
  body.innerHTML = PAGES[tab]();
  body.scrollTop = 0;
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // 戦闘の画面の Esc（選択の取り消し）まで届かないよう、ここで止める
  e.stopPropagation(); e.preventDefault();
  closeHelp();
}

/** 案内を開く。タブを渡さなければ、いまの画面に合うものを出す */
export function openHelp(to?: Tab): void {
  if (!back) return;
  tab = to ?? tabForScreen();
  render();
  back.hidden = false;
  document.addEventListener('keydown', onKey, true);
  back.querySelector<HTMLButtonElement>('.help-close')!.focus();
}

export function closeHelp(): void {
  if (!back || back.hidden) return;
  back.hidden = true;
  document.removeEventListener('keydown', onKey, true);
}

/** 「？」ボタンと重ね表示を document.body に付ける。main.ts から1度だけ呼ぶ */
export function initHelp(): void {
  if (back) return;
  const btn = document.createElement('button');
  btn.className = 'help-btn';
  btn.type = 'button';
  btn.title = '遊び方';
  btn.setAttribute('aria-label', '遊び方');
  btn.textContent = '？';
  btn.onclick = () => openHelp();

  back = document.createElement('div');
  back.className = 'help-back';
  back.hidden = true;
  back.innerHTML = `
    <div class="help" role="dialog" aria-modal="true" aria-label="遊び方">
      <header><b>遊び方</b><nav></nav><span class="spacer"></span><button type="button" class="help-close">閉じる</button></header>
      <div class="help-body"></div>
    </div>`;
  back.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    // 外側（暗いところ）のクリックで閉じる
    if (el === back || el.closest('.help-close')) { closeHelp(); return; }
    const t = el.closest<HTMLElement>('[data-tab]');
    if (t) { tab = t.dataset.tab as Tab; render(); }
  });
  document.body.append(btn, back);

  // 画面の中の入口（data-help を付けたボタン。タイトル画面の「遊び方」など）
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-help]');
    if (!el) return;
    const to = el.dataset.help as Tab;
    openHelp(to in PAGES ? to : undefined);
  });
}
