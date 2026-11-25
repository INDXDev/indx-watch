import { DOCS } from '@/lib/site';
import { PW_PATH, PW_TC3, TOML_PATH, TOML_TC3 } from './code';
import type { SetupContent } from './types';

/**
 * セットアップガイド（/ja/setup/）。コマンドと出力は CLI と docs/guides/ のガイドから写したもの。
 * setup-en.ts と同じ手順・同じ順番で、日本語として書く（翻訳調にしない）。
 */
export const setupJa: SetupContent = {
  locale: 'ja',
  path: '/ja/setup/',
  meta: {
    title: 'セットアップガイド — INDX Watch',
    description:
      'INDX Watch を最初から最後までセットアップする手順。リポジトリへのインストール、最初のテストの作成と実行、GitHub のワークフロー、自分の Cloudflare アカウントへの Access 付きデプロイ、チームの招待まで。',
  },
  hero: {
    kicker: 'エンジニアのためのセットアップガイド',
    title: 'npx から、自分の Cloudflare でチームがテストするまで。',
    lead: '上から順に進めるだけの 1 ページです。**手順は番号の順にやってください**。それぞれに、誰がやるか、打つコマンド、何が見えれば成功かを書いています。手元だけで十分なら手順 6 で終わり。CI とホスティングが必要なら、その先へ。',
    primary: { label: '手順 1 からはじめる', href: '#install' },
    secondary: { label: '全体の構成を見る', href: '#architecture' },
  },
  toc: 'このページの内容',
  needs: {
    title: 'はじめる前に',
    items: [
      '**Node 22.13 以上**と、アプリの git リポジトリ',
      '**Claude Code か Codex**（任意。どの手順もコマンドで実行できます）',
      'プルリクエストでのチェックには **GitHub**（フェーズ 2）',
      'ホスティングには **Cloudflare アカウント**と Zero Trust のチーム（フェーズ 3）。小さなチームなら無料プランで足ります',
    ],
  },
  paths: {
    title: 'どこまでやればいい？',
    lead: 'フェーズは前のフェーズの上に積み重なります。先のフェーズをやらなくても、手前のフェーズだけで役に立ちます。',
    items: [
      { title: '自分ひとり、手元で', steps: '手順 1〜6', body: 'テストケースは git に、Web アプリは localhost で、結果は自分のマシンに。' },
      { title: 'プルリクエストで回すチーム', steps: '＋ 手順 7', body: 'PR ごとにチェックと Playwright が走り、判定入りのコメントがひとつ付きます。' },
      { title: '自社の Cloudflare で使うチーム', steps: '＋ 手順 8〜11', body: 'アプリは Access の後ろの Worker で動き、マージのたびにデプロイ。テスターはブラウザだけ。' },
    ],
  },
  arch: {
    kicker: '構成',
    title: '何がどこで動くのか。',
    lead: '**INDX Watch のクラウドはありません**。定義はあなたのリポジトリに、アプリはあなたの Cloudflare アカウントに。その間の変更は GitHub Actions が運びます。',
    nodes: [
      { title: '手元の PC', caption: 'npx indx-watch', items: ['`.indx-watch/` の TOML ファイル', 'Claude Code / Codex とスキル', 'localhost の `iw serve`'] },
      { title: 'GitHub', caption: 'プルリクエスト + Actions', items: ['`iw check` と Playwright', 'PR コメントとチェック', 'main へのマージで `iw deploy`'] },
      { title: '自分の Cloudflare', caption: 'Workers · R2 · D1 · Access', items: ['Worker：Web アプリと API', 'R2：実行結果と証跡', 'D1：作り直せるインデックス'] },
      { title: 'チーム', caption: 'ブラウザ', items: ['Access でサインイン', '手動テストと証跡', '判定とレポート'] },
    ],
    edges: ['git push', 'マージでデプロイ', 'Access ログイン'],
    storesTitle: '何をどこに置くか',
    stores: [
      { what: 'テストケース・完了条件・テストデータ', where: 'git の `.indx-watch/`。プルリクエストでレビュー' },
      { what: '実行結果・スクリーンショット・アップロード', where: '自分の R2 バケット（フォルダや S3 でも可）。git には入れない' },
      { what: '検索用インデックス', where: 'D1。いつでもバケットから作り直せる' },
      { what: 'トークンとパスワード', where: 'GitHub のシークレットとシェルだけ。ファイルには `env:NAME` の参照だけ' },
    ],
  },
  phases: [
    {
      id: 'laptop',
      kicker: 'フェーズ 1',
      title: '手元の PC で',
      lead: 'インストールして、プロジェクトを説明し、テストを書いて実行し、いちばん大事な問いを投げる。アカウントは要りません。',
      steps: [
        {
          id: 'install',
          title: 'リポジトリにインストールする',
          who: '開発者 · リポジトリごとに 1 回',
          body: 'アプリのリポジトリの直下で実行し、**書き出されたファイルをコミット**します。クローンした全員が同じ状態から始められます。',
          done: '`.indx-watch/project.toml` があり、コミット後の `git status` に何も残っていない。',
          items: [
            '`.indx-watch/`：プロジェクト、環境 `local`、リリース `v0.1.0`、機能「General」（仮の値）',
            '`.claude/skills/` と `.mcp.json`：Claude Code 用のスキルと MCP サーバー',
            '`.agents/skills/` と `.codex/config.toml`：Codex 用の同じもの',
            '`AGENTS.md` の目印付きブロック：どの仕事にどのスキルを使うかをエージェントに伝える',
          ],
          note: 'ここから先の `iw` は `npx indx-watch` の略です（`npm install --global indx-watch` でも可）。`npx iw` は無関係なパッケージなので実行しないでください。',
          link: { label: 'クイックスタート', href: DOCS.quickstart },
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ npx indx-watch init\n$ git add -A\n$ git commit -m "chore: add INDX Watch"',
            },
          ],
        },
        {
          id: 'setup',
          title: 'エージェントにプロジェクトを説明させる',
          who: '開発者かリード · 1 回',
          body: 'リポジトリで `claude`（または `codex`）を起動して、普通の言葉で頼みます。エージェントは `package.json`、Playwright の設定、テスト、CI を読み、**おすすめの答え付きで 1 問ずつ**聞いてきます。プロジェクトキー、言語、テスト環境の URL、機能、担当者、リリース、レポーター、CI ワークフロー。',
          done: '`iw check` がエラーを出さず、承認後の Web アプリで機能に「下書き」が付いていない。',
          note: '初回だけ、エージェントに聞かれたら `indx-watch` の MCP サーバーを承認します。エージェントが書くのは下書きまで。**承認するのは人**で、エージェントが示す 1 行を自分で実行します。',
          link: { label: 'Claude Code や Codex でテストする', href: DOCS.agents },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: 'このリポジトリにテスト管理をセットアップして' },
                {
                  who: 'agent',
                  text: 'http://localhost:4173 のアプリ、Playwright のテスト、CI のワークフローが見つかりました。最初の質問はプロジェクトキーです。**SHOP** でどうでしょう？',
                },
                { who: 'you', text: 'それで。残りはおまかせ' },
                {
                  who: 'agent',
                  text: '機能 Catalog・Checkout・Account、環境 `staging`、リリース `v1.2.0` を下書きで書きました。`iw check` も通っています。差分を確認してコミットし、下の 1 行で承認してください。',
                },
              ],
            },
            {
              kind: 'terminal',
              title: 'エージェントではなく、あなたが実行',
              code: '$ iw approve FEAT-1 && iw approve FEAT-2 && iw approve FEAT-3 \\\n    && iw approve staging && iw approve v1.2.0',
            },
          ],
        },
        {
          id: 'serve',
          title: 'Web アプリを開く',
          who: '誰でも · いつでも',
          body: 'あとでチームが使うのと同じアプリが、**手元のファイルを相手にオフラインで**動きます。作業中は別のターミナルで開いたままにしておきます。',
          done: 'ブラウザで http://127.0.0.1:4321 が開き、ホームにリリースが表示される。',
          note: '結果は `.indx-watch/runs/` に入り、git には入りません。定義は git で、結果はストアで運びます（フェーズ 3）。',
          link: { label: 'Web アプリの使い方', href: DOCS.webApp },
          blocks: [
            { kind: 'terminal', title: '~/shop', code: '$ iw serve --open\n# ダッシュボードと手動実行の画面が http://127.0.0.1:4321 で開く' },
            { kind: 'shot', image: 'home.png', alt: 'ホーム：リリース v1.2.0 の判定、自分の担当、最近のアクティビティ' },
          ],
        },
        {
          id: 'design',
          title: '最初のテストケースを書く',
          who: 'テスター・開発者・PM',
          body: '何をテストすべきか聞きます。エージェントは機能、アプリのソース、既存のテストを読み、**何も書く前に、足りないものを普通の言葉で提案**します。残すと決めたものだけが、目的・開始ページ・はい/いいえで答えるチェック付きの完了条件とテストケースの下書きになります。',
          done: '**テスト**画面の機能の下に新しいテストケースが出る。承認するまでは下書きの印付き。',
          note: 'ファイルで書きたい人へ：テストケースはただの TOML ファイルです。`#:schema` の行があるのでエディタで補完が効きます。`iw new tc` でも作れます。',
          link: { label: '良いテストケースの書き方', href: DOCS.writing },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '/iw-design チェックアウトで何をテストすべき？' },
                {
                  who: 'agent',
                  text: '**存在しないクーポンは拒否される**（P0）：存在しないコードを入れると「This coupon is not valid」と表示され、合計は 40.00 のまま。これは残しますか？',
                },
                { who: 'you', text: '残して' },
                { who: 'agent', text: 'AC-2.3 と TC-11 を下書きで書きました。`iw approve AC-2.3 && iw approve TC-11` で承認できます。' },
              ],
            },
            { kind: 'file', file: TOML_PATH, code: TOML_TC3 },
          ],
        },
        {
          id: 'run',
          title: '最初の結果を記録する',
          who: '手動はテスター、Playwright は開発者',
          body: '**手動：** Web アプリでテストケースを開いて「手動で実行」を押すか、エージェントに「TC-3 を一緒にやって」と頼みます。**Playwright：** レポーターを追加し、各テストに対応するテストケースのタグを付けます。どちらの結果も同じ場所に入り、同じように数えられます。',
          done: '**アクティビティ**に実行が出て、テストケースが「未テスト」から合格か失敗に変わる。',
          note: 'Playwright で自動化したテストケースには `mode = "playwright"` を付けます。付けないと、合格しても人の確認待ち（要レビュー）になります。',
          link: { label: 'Playwright ガイド', href: DOCS.playwright },
          blocks: [
            { kind: 'shot', image: 'manual-run.png', alt: 'TC-3 の手動実行：使うクーポンコードと、両方のチェックが付いた手順 1' },
            { kind: 'file', file: PW_PATH, code: PW_TC3 },
            { kind: 'terminal', title: '~/shop', code: '$ npx playwright test\n[indx-watch] 7 run(s) to .indx-watch/runs: TC-1 pass, TC-2 pass, TC-3 pass, …' },
          ],
        },
        {
          id: 'status',
          title: '「リリースできる？」と聞く',
          who: 'リード · リリースのたびに',
          body: 'リリースできるかどうかは**結果から計算され**、誰かが入力するものではありません。P0 がすべて合格か、カバレッジ、未テストがないか。エージェントに聞くか、`iw status` を実行するか、ホームを開きます。出荷を決めるのは人です。',
          done: 'できる・できないの答えと理由が返り、ホームにも同じ答えが出る。',
          link: { label: 'リリース判定のしくみ', href: DOCS.concepts },
          blocks: [
            {
              kind: 'chat',
              lines: [
                { who: 'you', text: '1.2.0 はリリースできる？' },
                {
                  who: 'agent',
                  text: '**まだです。** 8 件中 7 件が合格。TC-8「誤ったパスワードではサインインできない」（Account、P0）が Sam の手動実行で失敗していて、P0 の失敗は免除できません。次に動くのは Sam です。',
                },
              ],
            },
            { kind: 'shot', image: 'readiness.png', alt: '判定のチェック：TC-8 のため「P0 のテストがすべて合格」が 5/6 で不合格。ほかは合格' },
          ],
        },
      ],
    },
    {
      id: 'github',
      kicker: 'フェーズ 2',
      title: 'GitHub で',
      lead: 'テストの変更をコードと同じようにレビューし、プルリクエストごとにリリースの状態がわかるようにします。',
      steps: [
        {
          id: 'workflows',
          title: 'ワークフローを追加してプルリクエストを出す',
          who: '開発者 · 1 回',
          body: 'コマンドひとつで、まだないワークフローを 2 つ書き出します。**`indx-watch.yml`** はプルリクエストごとに `iw check`、Playwright、INDX Watch のアクションを実行。**`indx-watch-deploy.yml`** はマージ時にアプリをデプロイします（フェーズ 3）。ブランチを push すると 1〜2 分で PR にコメントがひとつ付き、push のたびに更新されます。',
          done: 'プルリクエストに **INDX Watch** のチェックと、github-actions のコメントがひとつ付く。',
          items: [
            '判定の行：合格か不合格か、合格・失敗・未テストの件数',
            'この PR で追加・変更・削除されたテストケース',
            'PR が触ったファイルから選んだ、実行すべきテストケース',
          ],
          note: 'ブランチ保護で **INDX Watch** のチェックを必須にすると、準備のできていないリリースはマージできなくなります。フォークからの PR にはジョブのサマリーだけが付きます。',
          link: { label: 'GitHub Actions ガイド', href: DOCS.githubActions },
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ git switch -c ci/indx-watch\n$ iw init --github\nWrote: .github/workflows/indx-watch.yml .github/workflows/indx-watch-deploy.yml …\nAdd these repository secrets: CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET\n$ git add -A && git commit -m "ci: add INDX Watch" && git push -u origin HEAD\n$ gh pr create --fill',
            },
            {
              kind: 'pr',
              title: 'github-actions · INDX Watch · v1.2.0',
              lines: [
                { tone: 'fail', text: 'まだリリースできません：合格 7 · 失敗 1 · 未テスト 0' },
                { tone: 'info', text: 'この PR で変わったテストケース：+ TC-11 存在しないクーポンは拒否される' },
                { tone: 'info', text: '実行をおすすめするテストケース：TC-11 TC-3 TC-4' },
                { tone: 'pass', text: 'チェック INDX Watch · iw check 合格' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'cloudflare',
      kicker: 'フェーズ 3',
      title: '自分の Cloudflare アカウントで',
      lead: '最初のデプロイは手で行い、各部分を自分の目で確かめてから GitHub に任せます。そのあとチームに要るのはブラウザだけです。',
      steps: [
        {
          id: 'deploy',
          title: 'アプリを初めてデプロイする',
          who: 'Cloudflare にログインできる人 · 1 回',
          body: '`[hosting]` を書き、API トークンを作り、計画を読んでからデプロイします。`iw deploy` は **R2 バケットと D1 データベースがなければ作り**、Worker をデプロイして URL を表示します。2 回目以降は新しいバージョンをデプロイするだけです。',
          done: '`iw deploy` が Worker の URL を表示する。開くとまだ 403 になるが、手順 9 までは正常。',
          items: [
            'API トークン：My Profile → API Tokens → **Edit Cloudflare Workers** テンプレートに **D1 Edit** と **Workers R2 Storage Edit** を追加',
            'アカウント ID：ダッシュボード → Workers & Pages',
            'Zero Trust のチーム名：`<team>.cloudflareaccess.com` の `<team>` の部分',
          ],
          note: '`[hosting]` に秘密の値はありません。トークンはシェルに貼るだけで、ファイルには書かないでください。',
          link: { label: 'Cloudflare にセルフホストする', href: DOCS.selfHost },
          blocks: [
            {
              kind: 'file',
              file: '.indx-watch/project.toml',
              code: '[hosting]\nprovider = "cloudflare"\nname = "shop-watch"        # → https://shop-watch.<subdomain>.workers.dev\naccess_team = "example"    # Zero Trust のチーム名\n# access_aud = "…"         # 手順 9 で入れる',
            },
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ export CLOUDFLARE_API_TOKEN=…     # 貼るだけ。コミットしない\n$ export CLOUDFLARE_ACCOUNT_ID=…\n$ iw deploy --dry-run\nDry run: nothing was changed. Commands:\n  wrangler r2 bucket create shop-watch\n  wrangler d1 create shop-watch\n  wrangler deploy --config …/cache/deploy/wrangler.jsonc\n$ iw deploy',
            },
          ],
        },
        {
          id: 'access',
          title: 'Cloudflare Access を前に置く',
          who: 'Cloudflare の管理者 · 1 回',
          body: 'INDX Watch には独自のログインがありません。**誰が入れるかは Cloudflare Access が決め**、Worker はリクエストごとに Access のトークンを確かめます。`access_aud` を入れるまで、Worker は全員を拒否します。',
          done: 'URL を開くと Access のサインインが出て、その後に手元と同じホームが表示される。',
          items: [
            'Zero Trust → Access → Applications → **Add an application → Self-hosted**',
            'ドメイン：`shop-watch.<subdomain>.workers.dev`（または独自ドメイン）',
            'ポリシー：**Allow** → Emails ending in `@your-company.com`（またはグループ）',
            '**Application Audience (AUD) Tag** をコピーして `project.toml` に入れ、コミットしてもう一度デプロイ',
          ],
          link: { label: 'Cloudflare Access を前に置く', href: `${DOCS.selfHost}#3-put-cloudflare-access-in-front` },
          blocks: [
            { kind: 'file', file: '.indx-watch/project.toml', code: '[hosting]\n# …\naccess_aud = "<AUD タグ>"' },
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ iw deploy\nCloudflare Access: team example.cloudflareaccess.com, audience set. Requests without a valid Access token get 401.',
            },
          ],
        },
        {
          id: 'ci-deploy',
          title: 'マージのたびに GitHub がデプロイするようにする',
          who: 'リポジトリの管理者 · 1 回',
          body: 'デプロイのワークフローにシークレットを渡します。**CI はサービストークンで Access にサインイン**し、テストケースの公開と結果のアップロードを行います。最後に、プロジェクトのストアをアプリに向けて、CI の結果がアプリに出るようにします。',
          done: '**indx-watch-deploy** の実行が緑になり、アプリの**アップロード → 同期の状態**にマージしたコミットが出る。',
          items: [
            'Zero Trust → Access → Service credentials → Service Tokens → **Create**（シークレットは一度しか表示されません）',
            'アプリに、アクションが **Service Auth** でそのトークンを含むポリシーを追加',
            'リポジトリのシークレットを 4 つ追加。`gh secret set` は値を聞いてくるので、シェルの履歴に残りません',
          ],
          note: 'まず **Actions → indx-watch-deploy → Run workflow** で確認します。以後は `.indx-watch/` の変更をマージするたびに、アプリが再デプロイされテストケースが公開されます。',
          link: { label: 'GitHub から Cloudflare にセルフホストする', href: DOCS.selfHostGithub },
          blocks: [
            {
              kind: 'terminal',
              title: '~/shop',
              code: '$ gh secret set CLOUDFLARE_API_TOKEN\n$ gh secret set CLOUDFLARE_ACCOUNT_ID\n$ gh secret set CF_ACCESS_CLIENT_ID\n$ gh secret set CF_ACCESS_CLIENT_SECRET',
            },
            { kind: 'file', file: '.indx-watch/project.toml', code: '[store]\nurl = "https://shop-watch.example.workers.dev"' },
          ],
        },
        {
          id: 'team',
          title: 'チームを招く',
          who: 'リード · 1 人ずつ',
          body: 'アプリの Access ポリシーに、メンバーかグループを一度追加するだけ。**テスターは URL を開くだけです。** 開発者はブランチでテストケースを編集し、Cloudflare のアカウントなしで公開できます。Cloudflare にログインしていない `iw deploy` は定義だけを、アプリ側の内容とマージして公開します。',
          done: 'メンバーがサインインし、自分の担当のテストケースを見て、記録した実行があなたにも見える。',
          items: [
            'ロールで各自ができることを絞れます。`[hosting.roles]` がなければ、Access を通った全員がリードです',
            '同じファイルを誰かが変えていたら、`iw deploy` は止まってファイル名を示します。`iw pull` がアプリ側の版を `.conflict` ファイルとして隣に置きます',
            'アプリで行った編集も同じ道で git に戻ります。`iw pull`、レビュー、コミット、push',
          ],
          blocks: [
            {
              kind: 'terminal',
              title: 'メンバーの PC',
              code: '$ iw login https://shop-watch.example.workers.dev   # 初回だけ。Access のログインが開く\n$ git switch -c tests/coupon-limits\n$ iw check\n$ git commit -am "test: coupon limits" && git push -u origin HEAD\n$ iw deploy        # Cloudflare ログインなし：定義だけを公開',
            },
            {
              kind: 'file',
              file: '.indx-watch/project.toml',
              code: '[hosting.roles]\nlead = ["qa-leads@shop.test"]\ntester = ["qa@shop.test"]\ncustomer = ["uat@shop.test"]',
            },
          ],
        },
      ],
    },
  ],
  daily: {
    kicker: 'そのあとの毎日',
    title: 'チームが回すループ。',
    lead: 'セットアップが終われば、デプロイのコマンドを手で打つ人はいません。テストの変更はプルリクエストで、マージすればアプリが更新されます。',
    steps: [
      { title: 'ブランチ', body: 'テストケースやアプリを変える。エージェントに頼んでもいい。' },
      { title: 'プルリクエスト', body: '`iw check`、Playwright、コメントがひとつ。' },
      { title: 'マージ', body: 'デプロイのワークフローが `iw deploy` を実行。' },
      { title: 'テスト', body: 'チームがアプリで手動テスト。' },
      { title: '判断', body: '「リリースできる？」とレポート。' },
    ],
  },
  recipes: {
    kicker: 'レシピ',
    title: 'こんなことをしたいときは',
    lead: 'よくある次の一歩。どれもコマンドひとつか、設定ひとつです。',
    items: [
      {
        title: '自分のアプリに入れる前に触ってみたい',
        body: 'サンプルのショップ一式と、その結果が入ったフォルダを作ります。',
        code: 'npx indx-watch init demo --example\ncd demo && npx indx-watch serve --open',
      },
      {
        title: 'アプリをホストせずに結果を共有したい',
        body: 'S3 互換のバケットか共有フォルダをストアにします。`iw sync` と `iw serve` が結果をやり取りします。',
        code: '[store]\nurl = "s3://shop-watch-results/shop"\nregion = "eu-central-1"',
        link: { label: 'S3 で同期する', href: DOCS.s3 },
      },
      {
        title: '自社サーバーや Docker で動かしたい',
        body: 'ユーザーのメールアドレスをヘッダーで渡す SSO プロキシの後ろに置きます。',
        code: 'iw serve --host 0.0.0.0 \\\n  --identity-header X-Forwarded-Email',
        link: { label: 'Node / Docker でホストする', href: DOCS.selfHostNode },
      },
      {
        title: 'お客様に受け入れテストをしてもらいたい',
        body: '計画の項目を割り当て、お客様用の Access ポリシーにメールアドレスを追加します。',
        code: 'iw invite pat@client.test --plan PLAN-1 --items TC-8,TC-9',
      },
      {
        title: '関係者にレポートを送りたい',
        body: '単体で開ける HTML ファイルをひとつ。`md`・`pdf`・`json` も出せます。',
        code: 'iw report --format html --out report.html',
        link: { label: 'レポート', href: DOCS.reports },
      },
      {
        title: 'Claude にブラウザでテストさせたい',
        body: '`mode = "agent"` のテストケースが対象で、`ANTHROPIC_API_KEY` が必要です。結果は人のレビュー待ちになります。',
        code: 'iw run TC-10',
      },
      {
        title: 'テストデータやアカウントを用意したい',
        body: '行データ・シード・ファイル・アカウントをフィクスチャに。パスワードは `env:` の参照のまま。',
        code: '/iw-data レビュー写真のテストにデータを用意して',
        link: { label: 'フィクスチャ', href: DOCS.fixtures },
      },
      {
        title: 'ブランチで何が変わったか知りたい',
        body: '指定した ref 以降に追加・変更・削除されたユースケース、完了条件、テストケース。',
        code: 'iw diff --base origin/main',
      },
      {
        title: 'INDX Watch を更新したい',
        body: '古くなっているものを確認してから、パッケージ・スキル・MCP・ワークフローをひとつのバージョンに揃えます。',
        code: 'iw doctor\nnpx indx-watch@latest update',
        link: { label: '変更履歴', href: DOCS.changelog },
      },
    ],
  },
  trouble: {
    kicker: 'トラブルシューティング',
    title: 'うまくいかないとき',
    head: ['起きていること', 'やること'],
    rows: [
      { symptom: '`iw approve` が終了コード 2 で終わる', fix: 'エージェントが承認しようとしています。承認・レビュー・免除は人の仕事なので、その行を自分で実行してください。' },
      { symptom: 'Worker が全員に 403 を返す', fix: '`[hosting].access_aud` が空のままです。手順 9 を終えて、もう一度デプロイします。' },
      { symptom: 'デプロイのジョブが「nothing to deploy」と言う', fix: '`project.toml` に `[hosting]` がありません（手順 8）。' },
      { symptom: 'プルリクエストにコメントが付かない', fix: 'ワークフローに `pull-requests: write` が必要です。フォークからの PR には付きません。ジョブのログを見てください。' },
      { symptom: '`iw deploy` が「Commit your changes」「Push your commit first」と言う', fix: '公開は git の履歴とマージして行うので、ブランチをコミットして push してから、もう一度デプロイします。' },
      { symptom: '`iw deploy` がファイル名を示して止まる', fix: 'ほかの人も同じファイルを変えています。`iw pull` で `.conflict` ファイルをマージし、コミット、push してもう一度デプロイします。' },
      { symptom: '「The hosted app runs INDX Watch 0.x」と出る', fix: 'Worker がプロジェクトの指定バージョンより古いままです。Cloudflare にログインできる人（または main のワークフロー）が先に Worker をデプロイします。' },
    ],
  },
  closing: {
    title: 'まずは、コマンドひとつから。',
    lead: 'このページのほかの手順は、すべてその上に一歩ずつ積み上がります。',
    demo: 'ライブデモを開く',
  },
  doneLabel: '成功の目印',
  flow: {
    label: '変更が流れていく様子',
    play: '再生',
    pause: '一時停止',
    captions: [
      'ブランチでテストケースを変える。エージェントに頼んでも、手で書いてもいい。',
      'プルリクエストがチェックされ、Playwright が走り、リリースできるかをコメントがひとつで伝える。',
      'マージすると、GitHub があなたの Cloudflare にアプリをデプロイし、テストケースを公開する。',
      'チームは Access でサインインしてテストし、その結果が次の PR にも返ってくる。',
    ],
  },
  copy: 'コピー',
  copied: 'コピーしました',
  you: 'あなた',
  agent: 'エージェント',
  step: '手順',
};
