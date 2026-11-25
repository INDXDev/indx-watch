import { DOCS } from '@/lib/site';
import { PW_PATH, PW_TC3 } from './code';
import type { TeamContent } from './types';

/**
 * チームガイド（/ja/team/）。セットアップ後の毎日を、役割ごとに。team-en.ts と同じ場面・同じ順番で、
 * 日本語として書く（翻訳調にしない）。コマンドと会話は CLI と docs/guides/ から。
 */
export const teamJa: TeamContent = {
  locale: 'ja',
  path: '/ja/team/',
  meta: {
    title: 'チームガイド — INDX Watch',
    description:
      'QA・エンジニア・プロダクトマネージャーが INDX Watch を毎日どう使うか。頼まれたテストの実行、自動化と修正、テストケースの追加、テストの計画、リリースの判断まで。',
  },
  hero: {
    kicker: 'チームガイド',
    title: 'ふだんの一日、誰が何をするか。',
    lead: 'セットアップは終わっています。このページは**そのあと使う全員のため**のものです。自分の役割を選び、いまの場面を見つけて、手順どおりに進めてください。どの手順にも、うまくいったときに見えるものを書いています。',
    setup: { label: 'まだセットアップしていない方は、セットアップガイドへ', href: '/ja/setup/' },
  },
  pick: {
    title: '役割を選ぶ',
    roles: [
      {
        id: 'qa',
        title: 'QA・テスター',
        who: '頼まれたテストを実行し、記録し、おかしいところを伝える',
        jobs: ['自分の担当を見つける', '頼まれたテストをする', 'チェックが通らないとき', '実行の確認とデータの用意'],
      },
      {
        id: 'engineer',
        title: 'エンジニア',
        who: '変更が何に触れるかを知り、自動化し、赤を直す',
        jobs: ['この PR は何に触れる？', 'テストケースを自動化する', 'CI が赤になった', 'テストの変更をレビューする'],
      },
      {
        id: 'pm',
        title: 'プロダクトマネージャー',
        who: 'テストを頼み、承認し、計画を立て、リリースを決める',
        jobs: ['テストを依頼する', 'テストケースを承認する', '誰が何をテストするか決める', '判断してリリースする'],
      },
    ],
  },
  cycle: {
    kicker: 'ひとつのリリース',
    title: '役割から役割へ、仕事が渡っていく。',
    lead: 'どの役割も**同じファイルと同じ結果**を見て働くので、ツールの間で状況を書き写す人はいません。ひとつのリリースはこう回ります。',
    flow: {
      nodes: [
        { title: 'プロダクトマネージャー', caption: '頼む・計画する', items: ['テストを依頼する', '下書きを承認する', 'テストの計画を立てる'] },
        { title: 'エンジニア', caption: '設計する・自動化する', items: ['依頼をテストにする', 'Playwright にタグを付ける', '失敗を直す'] },
        { title: 'QA', caption: '実行する・記録する', items: ['手動テストを実行する', 'スクリーンショットを付ける', '失敗を伝える'] },
        { title: 'プロダクトマネージャー', caption: '判断する', items: ['「リリースできる？」', '免除するか、待つか', 'レポートを共有する'] },
      ],
      edges: ['承認済みのテスト', 'テストできるビルド', '結果'],
      label: 'ひとつのリリースの流れ',
      play: '再生',
      pause: '一時停止',
      captions: [
        'PM がテストを依頼し、返ってきたテストケースを承認する。',
        'エンジニアが（多くはエージェントと）テストケースを書き、自動化できるものを自動化する。',
        'QA が残りを Web アプリで手動で実行する。結果は自動テストの結果と同じ場所に入る。',
        '判定はその結果から計算される。PM が判断し、待てるものは免除して、リリースする。',
      ],
    },
  },
  roles: [
    {
      id: 'qa',
      kicker: 'QA・テスター',
      title: '頼まれたものを実行し、おかしいところを伝える。',
      lead: '必要なのは**ブラウザだけ**です（チームのアプリか、自分の PC の `iw serve`）。エージェントは助けになりますが、なくても進められます。',
      steps: [
        {
          id: 'qa-mine',
          title: '自分の担当を見つける',
          who: '毎朝',
          body: 'アプリを開きます。**ホーム**はリリースできるかどうかに答え、**自分の担当**を並べます。計画で自分に割り当てられたテストケース、次に自分が担当する機能のテストケース。それぞれにボタンがひとつ（実行・レビュー・失敗を見る）付いています。',
          done: '自分の担当に、自分の項目が先頭から並んでいる。機能の担当者なら、ホームは**自分の機能**の表示で始まる。',
          note: 'エージェントに「自分の残タスクは？」と聞いても、同じ項目が返ってきます。',
          link: { label: 'Web アプリの使い方', href: DOCS.webApp },
          blocks: [{ kind: 'shot', image: 'home.png', alt: 'ホーム：v1.2.0 はまだリリースできない、要約カード、自分の担当、最近のアクティビティ' }],
        },
        {
          id: 'qa-run',
          title: '「チェックアウトをテストしてもらえる？」と頼まれた',
          who: '何かのテストを頼まれたとき',
          body: 'テストケースを開きます。アプリを初めて見る人にもわかるように、**何をテストするか、どこから始めるか、テストデータと、それぞれで何をするか**、そして手順が書いてあります。**手動で実行**を押し、1 手順ずつ進め、見えたチェックに印を付け、求められたらスクリーンショットを付けます。',
          done: '最後の手順のあと、結果があなたの名前・リリース・環境付きで合格か失敗になり、**アクティビティ**に実行が出る。',
          items: [
            'すべてのチェックに印を付けると合格が提案され、印のないチェックがあると、見えたことを一文で聞かれます',
            'どのテストケースかわからなければ、**テスト**の一覧で「チェックアウト」を探すか、エージェントに聞きます',
            'スマホでも同じ順番で表示されるので、そのままスマホでテストできます',
          ],
          blocks: [
            { kind: 'shot', image: 'manual-run.png', alt: 'TC-3 の手動実行：使うクーポンコードと、両方のチェックが付いた手順 1' },
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '/iw-test TC-3 を一緒にやって' },
                {
                  who: 'agent',
                  text: '**何を確かめるか：** 有効なクーポンでカートの合計が下がること（AC-2.1）。**どこから：** Canvas Tote（40.00）をひとつ入れた http://localhost:4173/cart、コードは FX-1 の SUMMER10。手順 1：コードを適用してください。**合計は 36.00 になりましたか？**',
                },
                { who: 'you', text: 'はい' },
              ],
            },
          ],
        },
        {
          id: 'qa-fail',
          title: 'チェックが通らない',
          who: 'アプリが手順のとおりに動かないとき',
          body: 'チェックの印を外し、**代わりに見えたことを一文**書き、スクリーンショットを付けます。それだけで完全なバグ報告になります。そのあと原因を聞くか、手順・期待した結果と実際の結果・実行・コミットが入った状態の issue を開きます。',
          done: 'テストケースが失敗になり、ホームの**要対応**に出て、issue から実行へリンクがつながる。',
          link: { label: 'iw-triage で失敗を調べる', href: `${DOCS.agents}#fix-failures-iw-triage` },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: 'TC-8 はなぜ失敗した？' },
                {
                  who: 'agent',
                  text: 'あなたの実行では手順 1 が失敗：「メッセージが出ず、ページが黙って再読み込みされた」。サーバーは「Email or password is incorrect」を返しているので、画面が表示していないか、別のことが起きたかです。**まだ断定できません（確信度 0.5）。** スクリーンショット付きでもう一度実行しますか？',
                },
              ],
            },
            { kind: 'terminal', title: '手でやるなら', code: '$ iw issue TC-8 --open      # 入力済みの GitHub issue がブラウザで開く' },
          ],
        },
        {
          id: 'qa-review',
          title: 'エージェントと進めた実行を確認する',
          who: 'エージェントとテストしたあと',
          body: 'エージェントが案内した実行は、**あなたが確認するまで「要レビュー」**のままです。手順を実際に行ったのはエージェントではなく、あなただからです。**アクティビティ → レビュー**を開き、証跡を見て、理由と一緒に判定を記録します。',
          done: '実行がレビュー待ちから外れ、リリースの判定に数えられる。',
          blocks: [{ kind: 'terminal', title: 'ターミナルでやるなら', code: '$ iw review 01JF3Q --verdict pass --reason "staging で確認、スクリーンショット添付"' }],
        },
        {
          id: 'qa-data',
          title: 'テストに必要なデータがない',
          who: 'クーポンコード・アカウント・ファイルが足りないとき',
          body: '**テストデータ**を開きます。**新しいテストデータ**で表・シードデータ・アカウント・ファイルを作れ、画面にファイルをドロップすれば下書きのフィクスチャになります。パスワードは**シークレット**タブへ。テストケースには書きません。',
          done: '新しいフィクスチャが、それを使うテストケースと一緒に出る。人が承認するまでは下書き。',
          link: { label: 'フィクスチャ', href: DOCS.fixtures },
          blocks: [{ kind: 'shot', image: 'test-data.png', alt: 'テストデータの画面：クーポンコード、カタログのシード、顧客アカウント、レビュー写真と、それぞれを使うテストケース' }],
        },
      ],
    },
    {
      id: 'engineer',
      kicker: 'エンジニア',
      title: '変更が何に触れるかを知り、緑を保つ。',
      lead: '仕事の場所は**エディタ、ターミナル、プルリクエスト**。テストケースはコードの隣にあるファイルで、コードと同じようにレビューされます。',
      steps: [
        {
          id: 'eng-impact',
          title: 'この PR は何に触れる？',
          who: 'レビューを頼む前に',
          body: 'PR のコメントに、**変更が触れるテストケース**（自動テストのファイル、定義、テストデータから判断）と、PR で追加・変更・削除されたテストケースが出ます。変更に足りないテストをエージェントに聞けば、何かを書く前に普通の言葉で提案してくれます。',
          done: 'PR のコメントが実行すべきテストケースを示し、新しいテストケースがコードと同じ PR に入っている。',
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '/iw-design この変更で何をテストすべき？' },
                {
                  who: 'agent',
                  text: 'この変更はクーポンの回数制限を加えています。**同じクーポンは 2 回使えない**（UC-2、P1）：SUMMER10 をもう一度適用するとエラーが出て、合計は 36.00 のまま。これは残しますか？',
                },
              ],
            },
            { kind: 'terminal', title: '~/shop', code: '$ iw impact --base origin/main   # このブランチが触れるテストケース\n$ iw diff --base origin/main     # 追加・変更・削除されたテストケース' },
          ],
        },
        {
          id: 'eng-automate',
          title: 'テストケースを自動化する',
          who: '手動のテストを PR ごとに回したいとき',
          body: 'Playwright のテストはいつもどおり書き、**対応するテストケースのタグを付けます**。テストケースに `mode = "playwright"` を付けると、合格した実行が人の確認待ちにならず、そのまま合格になります。レポーターが各結果をコミットとスクリーンショット付きで記録します。',
          done: 'レポーターがテストケースを pass と表示し、アプリのそのテストケースの結果に CI が実行者として出る。',
          link: { label: 'Playwright ガイド', href: DOCS.playwright },
          blocks: [
            { kind: 'file', file: PW_PATH, code: PW_TC3 },
            { kind: 'terminal', title: '~/shop', code: '$ npx playwright test\n[indx-watch] 7 run(s) to .indx-watch/runs: TC-1 pass, TC-2 pass, TC-3 pass, …' },
          ],
        },
        {
          id: 'eng-red',
          title: 'CI が赤になった',
          who: 'INDX Watch のチェックが失敗したとき',
          body: 'チェックが失敗するのは、判定が通らないときか、定義ファイルが読めないときです。まず PR のコメントを読みます。失敗したテストケースが書いてあります。次に原因を聞くと、エージェントが実行・証跡・アプリのコードを読み、**プロダクトのバグか、テストの問題か、環境・データの問題か**を確信度付きで答えます。',
          done: '3 つのどれかがわかり、次の push でチェックが緑になるか、残りが何かが示される。',
          blocks: [
            {
              kind: 'pr',
              title: 'github-actions · INDX Watch · v1.2.0',
              lines: [
                { tone: 'fail', text: 'まだリリースできません：合格 7 · 失敗 1 · 未テスト 0' },
                { tone: 'info', text: '失敗：TC-8 誤ったパスワードではサインインできない（P0）' },
              ],
            },
            { kind: 'terminal', title: '~/shop', code: '$ iw check          # スキーマ、参照、キー、秘密情報の検査\n$ iw show TC-8      # テストケースと最近の実行' },
          ],
        },
        {
          id: 'eng-review',
          title: 'PR のテストの変更をレビューする',
          who: '同僚やエージェントがテストケースを変えたとき',
          body: 'テストケースは短い TOML ファイルなので、差分はそのまま読めます。TOML を読まない人のために、PR のコメントが同じ内容を普通の言葉で繰り返します。エージェントが書いた下書きには `origin = "ai"` が付き、**人が承認するまで数えられません**。',
          done: '承認済みのテストケースで PR がマージされ、次のデプロイでアプリに公開される。',
          blocks: [{ kind: 'terminal', title: 'エージェントではなく、あなたが実行', code: '$ iw approve AC-2.3 && iw approve TC-11\n$ git commit -am "test: approve TC-11"' }],
        },
      ],
    },
    {
      id: 'pm',
      kicker: 'プロダクトマネージャー',
      title: '何が動くべきかを言い、動いたら決める。',
      lead: '必要なのは**アプリと GitHub**。TOML を手で書く必要はありません。issue で頼むか、エージェントに頼んで、承認するだけです。',
      steps: [
        {
          id: 'pm-ask',
          title: 'テストを依頼する',
          who: '機能やバグにテストが必要なとき',
          body: 'GitHub の issue を **「Ask for something to be tested」** のフォームで開きます。誰のためか、何ができるべきか、優先度（P0 はリリースを止める）、完了条件ごとのチェックボックス。誰かがコマンドひとつでユースケースにします。エージェントに直接テストケースを設計してもらってもかまいません。',
          done: 'issue が、チェックボックスひとつにつき完了条件ひとつの下書きユースケースになり、issue へのリンクが付く。',
          blocks: [
            {
              kind: 'pr',
              title: '新しい issue · Ask for something to be tested',
              lines: [
                { tone: 'info', text: '誰のため？ 買い物客' },
                { tone: 'info', text: '何ができるべき？ チェックアウトでギフトカードを使える' },
                { tone: 'info', text: '優先度：P1' },
                { tone: 'pass', text: 'ギフトカードの残高が合計から引かれる' },
              ],
            },
            { kind: 'terminal', title: '受け取った人が', code: '$ iw import github-issue 42' },
          ],
        },
        {
          id: 'pm-approve',
          title: 'テストケースを承認する',
          who: '下書きが待っているとき',
          body: '**テスト**を開くと、下書きには印が付いています。AI の下書きは上部にそう書かれ、承認のコマンドも出ます。プルリクエストのように読み、**利用者に必要なことを確かめているか**を見ます。そして承認するか、直してもらいます。',
          done: 'テストケースから下書きの印が消え、リリースの判定に数えられ始める。',
          blocks: [
            { kind: 'shot', image: 'spec-tree.png', alt: 'テストの一覧：機能ごとのユースケース、完了条件、テストケースと、それぞれのモードと状態' },
            { kind: 'terminal', title: 'エージェントではなく、あなたが実行', code: '$ iw approve AC-2.3 && iw approve TC-11' },
          ],
        },
        {
          id: 'pm-plan',
          title: '誰が何をテストするか決める',
          who: 'テストの回を始めるとき',
          body: '計画は、リリースのテストケースの一覧に担当（人、`ci`、エージェント）を付けたものです。**重みで振り分け**、書き込む前に結果を確認できます。各自は自分の担当で項目を見つけます。',
          done: '各テスターの自分の担当に、期限付きで項目が出る。',
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ iw new plan --title "v1.2.0 regression"\nCreated PLAN-1 in plans/PLAN-1-v1-2-0-regression.toml\n$ iw assign --plan PLAN-1 --split alex@shop.test:2,sam@shop.test:1 --dry-run\n$ iw assign --plan PLAN-1 --split alex@shop.test:2,sam@shop.test:1',
            },
            {
              kind: 'file',
              file: '.indx-watch/plans/PLAN-1-v1-2-0-regression.toml',
              code: 'key = "PLAN-1"\ntitle = "v1.2.0 regression"\nrelease = "v1.2.0"\nenvironment = "staging"\ndue = 2026-11-28\n\n[[items]]\ntest_case = "TC-6"\nassignee = "alex@shop.test"\n\n[[items]]\ntest_case = "TC-8"\nassignee = "sam@shop.test"',
            },
          ],
        },
        {
          id: 'pm-ship',
          title: '判断してリリースする',
          who: 'リリース日の前に',
          body: '「リリースできる？」と聞きます。答えは結果から計算され、次に動く人も添えられます。わかっている **P1〜P3 の失敗は理由を付けて免除**できますが、P0 はできません。レポートを共有し、リリースを released にします。**出荷を決めるのは人**で、エージェントがリリースの状態を変えることはありません。',
          done: 'ホームがリリースできると言い、レポートが共有され、`releases/v1.2.0.toml` が `state = "released"` になっている。',
          link: { label: 'レポート', href: DOCS.reports },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '1.2.0 はリリースできる？' },
                {
                  who: 'agent',
                  text: '**まだです。** 8 件中 7 件が合格。TC-8（Account、P0）が Sam の手動実行で失敗していて、P0 の失敗は免除できません。次に動くのは Sam です。',
                },
              ],
            },
            { kind: 'shot', image: 'report.png', alt: 'レポート画面：v1.2.0 の顧客向けレポートと判定のチェック' },
            {
              kind: 'terminal',
              title: 'エージェントではなく、あなたが実行',
              code: '$ iw waive TC-2 --release v1.2.0 --reason "検索が遅いのは staging だけ。1.2.1 で修正"\n$ iw report --format html --out v1.2.0.html',
            },
          ],
        },
      ],
    },
  ],
  matrix: {
    kicker: 'ひと目で',
    title: 'ふだん、誰が何をするか。',
    lead: 'ひとりが複数の役割を持ってもかまいません。はっきり分かれているのは、人とエージェントの間だけです。',
    cols: ['', 'QA', 'エンジニア', 'PM', 'エージェント'],
    yes: 'はい',
    rows: [
      { task: 'テストを依頼する', cells: ['✓', '✓', '✓', '–'] },
      { task: 'テストケースを書く', cells: ['✓', '✓', '✓', '下書き'] },
      { task: 'テストケースを承認する', cells: ['✓', '✓', '✓', '✗'] },
      { task: '手動テストを実行する', cells: ['✓', '–', '–', '案内する'] },
      { task: 'テストを自動化する', cells: ['–', '✓', '–', '✓'] },
      { task: '実行をレビューする', cells: ['✓', '✓', '✓', '✗'] },
      { task: '失敗を免除する（P0 以外）', cells: ['–', '–', '✓', '✗'] },
      { task: 'リリースする', cells: ['–', '–', '✓', '✗'] },
    ],
  },
  people: {
    kicker: '人だけが',
    title: 'エージェントが決して下さない、4 つの判断。',
    lead: 'エージェントは提案し、下書きを書き、実行し、説明します。リリースの判定に数えられるものは必ず人を通ります。エージェントが試みると終了コード 2 で止まります。',
    items: [
      { title: '承認', body: '下書きが ready になり、数えられ始める。', code: 'iw approve TC-11' },
      { title: 'レビュー', body: 'レビュー待ちの実行に判定を付ける。', code: 'iw review <run> --verdict pass --reason "…"' },
      { title: '免除', body: 'わかっている P1〜P3 の失敗を出荷してよいことにする。', code: 'iw waive TC-2 --release v1.2.0 --reason "…"' },
      { title: '出荷', body: 'リリースの状態を変える。', code: 'state = "released"' },
    ],
  },
  closing: {
    title: 'サンプルのショップで試す。',
    lead: 'ライブデモには、リリース v1.2.0、Alex と Sam、このページに出てくるすべての画面があります。',
    demo: 'ライブデモを開く',
    setup: 'セットアップガイド',
  },
  labels: { copy: 'コピー', copied: 'コピーしました', you: 'あなた', agent: 'エージェント', step: '手順', doneLabel: '成功の目印' },
};
