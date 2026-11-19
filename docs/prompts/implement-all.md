# INDX Watch 一括実装プロンプト（Claude Code 用）

INDX Watch を M1〜M4 まで一気に実装し、**1 つのプルリクエスト**にまとめるためのプロンプトです。
git worktree で並列に作業し、Claude Code の Workflow（マルチエージェント）でまとめて進めます。

## 人が読む部分（貼らない）

- **使い方**: リポジトリ `indxdev/indx-watch` を開いた新しい Claude Code セッションに、下の「ここから貼る」以降をそのまま貼ります。
- **前提**:
  - `main` をチェックアウトしておく（ドキュメント一式が入っている）。
  - Cloudflare の実アカウント設定（開発プランの H-01〜H-07）は終わっていなくても進められます。実アカウントが必要な部分はローカルの模擬環境とフェイクで作り、PR に「要実機確認」として残します。
- **規模**: 数時間〜十数時間かかり、多数のサブエージェントを使います（トークンを多く使います）。進み具合は `/workflows` とタスク一覧で見られます。
- **成果物**:
  - 統合ブランチと PR 1 本。M1 が終わった時点で draft PR を作り、以降は同じ PR に追加します。
  - PR 説明に、タスク（T-xxx）ごとの完了状況と、実機で確認が必要な項目の一覧が入ります。
- **開発プランとの関係**: 開発プラン（`docs/guides/dev-plan.html`）は「1 タスク = 1 PR」が基本です。このプロンプトはそれをまとめて行う一括実装モードです。タスクの中身・完了条件・ファイル構成は開発プランをそのまま使います。

---- ここから貼る ----

# 依頼: INDX Watch を開発プランどおりに一括実装し、PR を 1 本作る

このリポジトリには、INDX Watch の設計ドキュメント一式（単一の情報源）があります。コードはまだありません。
ドキュメントに従って M1〜M4 の全タスクを実装し、1 本のプルリクエストにまとめてください。
**git worktree と Workflow ツール（マルチエージェントのワークフロー）を使って並列に進めてください。** 以下は、そのための背景・ルール・進め方です。

## 1. 背景（なぜ作るのか）

INDX Watch は、社内（と招待した顧客）だけが使う、AI ネイティブな E2E テスト / QA 管理プラットフォームです。Cloudflare 上でセルフホストします。

解決したい課題:

- テスト仕様がスプレッドシートや Slack に散らばり、「どこが・どうなれば完了か」が分からない。
- テスト環境への入り方、テストアカウント、テストデータ（フィクスチャ）が属人化している。
- 誰が何をテストするのか、その結果と証拠が追えない。
- AI（ブラウザエージェント・LLM 判定）を使いたいが、判定の根拠と人のレビューをどう組み込むか決まっていない。

中心となる考え方:

- **形式が正（ロックインしない）**: 単一の情報源は Watch Bundle 形式（型が決まったディレクトリ構成の TOML などのファイル群）とその中身。Cloudflare の D1 + R2 は共有・同期・画面・AI 実行の中心として全データを持つが、置き場所の 1 つにすぎない。`indx-watch/` に `watch.toml` を置けば、npx の CLI `iw` で一瞬で取り出し・同期・フル書き出し・別アカウントへのデプロイ（`iw deploy`）ができる。
- **完了は計算で決まる**: ユースケースはすべての完了条件（AC）が合格で完了。リリースは Go / No-Go の条件で判定。
- **AI は提案、人が承認**: AI の生成物は `draft` で入る。AI の判定は信頼度付きで、足りなければ人のレビューへ。
- **すべて版で残す**: テストケースとフィクスチャは不変の版を積み上げる。実行は使った版を記録する。
- **日本語と英語**: テスターに外国籍の人もいる。UI も、利用者が書く中身も日英対応。中身は「原文 + AI 翻訳 + 人の確認」で持つ。
- **ID と記録**: すべての作業と判定が、誰がやったか（社員は Google Workspace、顧客は招待メール）と確実に対応する。目的は「誰がやったかの対応づけ」と不正アクセスの検知で、人事評価には使わない。
- **コードは少なく**: Next.js 1 アプリ + runner Worker 1 つ。Cloudflare のマネージド機能に任せる。

## 2. 最初に読むもの（この順で）

1. `AGENTS.md`（用語・ID・スタック・作業ルールの要約。最優先の正）
2. `docs/guides/dev-plan.html`（タスク T-101〜T-406、依存、完了条件、**ファイル構成の正**、ID と記録の QA、リスク）
3. `docs/spec/domain.html`、`docs/spec/data-model.html`、`docs/spec/interactions.html`（ドメイン、DDL、ER、シーケンス、CRUD）
4. `docs/spec/architecture.html`（Cloudflare 構成と「最新仕様の確認メモ」）、`docs/spec/portability.html`（Watch Bundle・CLI・同期・書き出し・デプロイ）、`docs/spec/identity-audit.html`、`docs/spec/i18n.html`、`docs/spec/ai.html`
5. `docs/spec/ux.html` と `docs/screens/s01〜s13-*.html`（各画面のモックと「この画面の完了条件」）
6. `docs/guides/implementation.html`（規約・コード例）、`docs/guides/target-onboarding.html`

HTML は `<main>` 内のテキストと表、`<pre>` の図とコードを読めば十分です。画面モックは、実装後にスクリーンショットと見比べるためにブラウザでも開いてください。

## 3. 確定している決定（変えない）

- **Next.js の動かし方**: vinext で Workers にデプロイ。CI で `npx vinext check` を実行し、致命的な非互換があれば `@opennextjs/cloudflare` に切り替え、ADR を更新する。`"use cache"` は使わない。
- **認証**: Cloudflare Access（Worker 単位）。JWT（`Cf-Access-Jwt-Assertion`）を jose で検証する。`ctx.access` は使わない。新しい `identity_nonce` のときだけ `get-identity` を 1 回呼ぶ。社員の IdP は Google Workspace、顧客は One-time PIN + Independent MFA。
- **実行基盤**: Workflows（人の確認待ちは `step.waitForEvent`、定期実行は Workflow の `schedules`）、Queues、Browser Run（`@cloudflare/playwright`）、Email Routing → runner の `email()`。
- **LLM**: Claude を AI Gateway 経由で呼ぶ（BYOK、`cf-aig-metadata`、秘密を含む本文はログに残さない）。既定モデルは、エージェントと仕様生成が `claude-opus-5-5`、ジャッジと分類が `claude-sonnet-5-5`、軽い大量処理が `claude-haiku-5-5`。
  - 判定は構造化出力（`output_config.format`）で受け取る。
  - forced `tool_choice` は使わず、`auto` と `strict: true` にする。
  - `stop_reason: "refusal"` を確認し、fallbacks を設定する。
  - Anthropic SDK の使い方は推測せず、`claude-api` スキルか公式ドキュメントで確認する。
- **形式と CLI**: `packages/bundle`（zod の型が正、JSON Schema を生成、正規化した TOML と content_hash、行 ↔ Bundle の変換、3 方向マージ、アーカイブ）。CLI `apps/cli` は npx（`@indx/watch`）で配布し、`indx-watch/iw` 起動スクリプトが版を固定する。CLI のコードは公開してよい。認証は Cloudflare 公式ツールを包むだけにする（独自の認証は作らない）。データの読み書きは `cloudflared access login` / `cloudflared access token` を呼んで `cf-access-token` ヘッダで送り、デプロイは `wrangler`（`wrangler login` か `CLOUDFLARE_API_TOKEN`）を呼ぶ。`cloudflared` が無ければ公式の配布元から取得する。Bypass や共有の鍵は使わない。
- **ツール**: pnpm workspaces、TypeScript strict、Biome、vitest、`@cloudflare/vitest-pool-workers`、Drizzle（D1）、Tailwind + shadcn/ui、next-intl。
- **Cloudflare の確認**: Cloudflare の機能・上限・API を前提にするときは、developers.cloudflare.com と changelog を Web で確認する。ドキュメントと食い違ったら `architecture.html` の確認メモを更新する。

## 4. 守るルール

1. **ドキュメントが正**。
   - 実装中に仕様を変える必要が出たら、同じ PR の中で先に `docs/` を直す（docs のコミットとコードのコミットを分ける）。
   - ファイル構成を変えるときは `dev-plan.html#tree` を直す。
   - テーブルを変えるときは `schema`・マイグレーション・`data-model.html`（と ER 図）を同時に直す。
2. **書き込みはすべて `withAudit()` を通す**。ユーザーが書いた文字列の表示はすべて `localize()` を通す。UI 文言は ja / en の両方に足す。
3. **秘密を置かない**。秘密の値をコード・D1・ログ・PR に書かない。D1 には参照名だけを置く。
4. **AI の生成物の扱い**。`origin = 'ai'`・モデル名・プロンプト版を記録し、人の承認なしに `ready` にしない。
5. **依存を増やさない**。dev-plan の主要パッケージ以外を足すときは、理由をコミットメッセージに書く。
6. **言語**。コミットメッセージ・コメント・PR 説明は日本語。README.md だけ英語。
7. **確認の仕方**。仕様の判断に本当に迷ったときだけ、AskUserQuestion で日本語で質問する。それ以外はドキュメントと既定値で進め、判断したことを PR に書く。

## 5. 外部サービスがなくても完結させる

実アカウント（Cloudflare・Google Workspace・GitHub App・Anthropic）がこのセッションにない前提で作ります。

- **ポートとフェイク**:
  - 外部への依存は `packages/core/src/ports.ts` にインターフェースとして定義する。対象は `LlmClient`、`BrowserProvider`、`CloudflareApi`（Access のログ・ユーザー・失効）、`GitHubApi`、`SecretStore`、`MailStore`、`Clock`。
  - 本番実装と、テスト用のフェイク（`packages/core/src/testing/`）を両方作る。
  - フェイクの LLM は、構造化出力のスキーマに沿った決まった値を返す。
- **ローカルの Access 模擬**:
  - 開発時だけ、ローカルの鍵で署名した JWT と JWKS を使う。
  - 開発用ユーザー: 佐藤（manager）、田中（tester）、Alex Kim（tester・英語）、山本 様（guest）、admin。
  - **本番では絶対に有効にならない**作りにする（環境変数とビルド時の両方で止め、テストで確認する）。
- **D1・R2・Queues・Workflows**: wrangler / vitest-pool-workers のローカル環境で動かす。
- **ブラウザ**:
  - ローカルでは、このマシンの Playwright + Chromium を使う `BrowserProvider` を用意する。本番は Browser Run を使う。
  - 実行対象として、小さな静的サンプルサイト `tests/sample-shop/` を作る。カート、クーポン、期限切れエラー、注文確認メールの送信を含める。これは本番コードではなく、テスト用の対象アプリ。
- **Anthropic の実キーがある場合**: `ANTHROPIC_API_KEY` がある場合だけ、実モデルでのスモークテストを 1 本走らせる（無ければスキップ）。
- **実機でしか確かめられないもの**: 実際の Access、Logpush、Browser Run、AI Gateway、Email Routing、GitHub App などは、コードと設定ファイルまで作る。確認していない項目は PR の「要実機確認」に、確認方法と一緒に書く。

## 6. 進め方（worktree × Workflow）

### 6.0 準備

- **統合ブランチ**:
  - `feat/indx-watch-v1` を作る。
  - このセッションに使うブランチの指定があれば、それを統合ブランチにする。
  - 作成元は `main` の最新（ドキュメント一式が入っている）。
- **計画をタスクにする**: dev-plan のタスクと、下のウェーブ表を TaskCreate でタスクにし、進み具合を更新し続ける。
- **Workflow スクリプトを書く前に**: `workflow-authoring` スキルを読む。
- **エージェント数**: 1 ウェーブあたり 6 以内を目安にする。

### 6.1 ウェーブ 0: 基盤と「契約」（あなた自身が順番に実装。並列にしない）

全員が依存する部分なので、1 か所で一貫して作ります。

1. **T-101**: モノレポ、CI、Issue / PR テンプレート、docs のリンク検査。
2. **T-102**: data-model.html の**全テーブル**（35 + FTS5）のスキーマ、マイグレーション、シード。シードには SHOP のサンプルと WATCH プロジェクト（dev-plan の「ID と記録の QA」の WATCH-TC-1〜10）を入れる。
3. **T-103**: core（ID、zod ドメイン型、完了計算、Go / No-Go、`decide()`、`localize()`）と、`ports.ts` とフェイク。
4. **T-104**: web の雛形と、全画面の土台。
   - S01〜S13 の**全ルートを空ページで作る**。
   - app-shell（左ナビは全項目入り）、共通 UI 部品、色トークン。
   - next-intl。メッセージは**画面ごとのファイル**（`messages/{ja,en}/S05.json` など）に分け、読み込み時にまとめる。並列作業での衝突を避けるため。
5. **T-105**: 認証・ログインセッション・`withAudit()`・閲覧ビーコン・告知と同意・`requireRole()`・guest の絞り込み・Access 模擬。
5b. **T-119**: `packages/bundle`（全エンティティの型・正規化・変換・検証）と、`withAudit()` 内での `sync_changes` 記録。SHOP のシードで往復テスト（変換 → 読み込み → 再変換でハッシュ一致）を通す。
6. **T-106**: runner の雛形、Queue と RPC のメッセージ型、Workflows の骨組み。
7. **テスト基盤**: vitest-pool-workers の設定、ローカル E2E（Playwright で `pnpm dev` を叩く。ユーザーは Access 模擬で切り替える）、`tests/sample-shop/`。

ウェーブ 0 の最後に CI 相当（`pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`）を通し、統合ブランチにコミットする。
**ここで次の「契約」を凍結する**。以降のウェーブでは、統合を担うあなた以外は変更しない。

- `packages/db/schema/**` とマイグレーション
- `packages/core/src/{ports,messages}.ts` と `domain/**`
- `packages/bundle/src/schema/**` と `canonical.ts`
- ルートの `package.json` と各 `package.json` の依存
- app-shell とナビ
- 共通 UI 部品

### 6.2 並列ウェーブ（Workflow でエージェントを起動し、各エージェントは自分の worktree で作業）

| ウェーブ | エージェント（担当タスク） | 主に触る場所 |
|---|---|---|
| 1 | A: T-107 Access ログ取り込み | `apps/runner/src/{queues/log-ingest,workflows/ingest}.ts` |
| 1 | B: T-108 プロジェクト・環境（S09） | `app/(app)/admin/projects`、`p/[key]/environments`、`lib/secrets.ts` |
| 1 | C: T-109 + T-111 仕様ツリー・テストケース（S03・S04） | `p/[key]/specs`、`p/[key]/tc` |
| 1 | D: T-110 翻訳基盤 | `core/{llm,i18n/translate}`、`runner/queues/translate.ts`、用語集の設定画面 |
| 1 | E: T-112 フィクスチャ（S07） | `p/[key]/fixtures`、`api/{upload-url,files}`、`lib/r2.ts` |
| 2 | F: T-113 + T-114 計画・マイタスク（S08・S01） | `p/[key]/plans`、`(app)/page.tsx` |
| 2 | G: T-115 手動ランナー（S05、S06 の手動実行表示） | `p/[key]/runs` |
| 2 | H: T-117 ログイン・作業履歴（S12） | `admin/activity`、`lib/cf-api.ts` |
| 2 | H2: T-120 フル書き出し・取り込み（S13 の書き出し部分） | `bundle/src/archive.ts`、`runner/workflows/{export,import}.ts`、`p/[key]/data` |
| 3 | あなた: T-116 リリース準備状況（S02）→ **T-118 M1 受け入れ** → **draft PR を作成** | `p/[key]/releases` |
| 4 | I: T-201→T-205 実行 Workflow・エージェント・ジャッジ・レビュー待ち・Human in the Loop（S06）を順番に | `runner/{workflows/run,agent,browser,fixtures}`、`core/judges`、`(app)/review` |
| 4 | J: T-206 テストメール | `runner/email.ts` |
| 4 | K: T-207 + T-208 AI 仕様取り込み（S10）と各画面の AI ボタン | `p/[key]/specs/import`、`runner/workflows/ai-import.ts` |
| 4 | K2: T-211 CLI `iw` と同期 API（`cloudflared` は実機の Access がないので、ローカルでは Access 模擬のトークンを返すフェイクに差し替えて通す） | `apps/cli`、`app/api/sync/v1`、`bundle/src/merge.ts`、S13 の CLI 部分 |
| 4 | L: T-209 AI 要約 | S02 の要約部分、`core/llm/prompts` |
| 5 | M: T-301→T-303 GitHub 連携（S11） | `api/github`、`lib/github.ts`、`p/[key]/deployments` |
| 5 | N: T-304 + T-305 定期実行・script・visual | `runner/workflows/dispatch.ts`、`runner/browser/script.ts`、`core/judges/visual.ts` |
| 5 | O: T-306 MCP サーバー | `app/mcp` |
| 5 | O2: T-308 + T-309 常時同期・`iw run`・`iw serve`・`iw deploy`・`iw dev`（deploy は `--dry-run` と wrangler のローカル環境で確認） | `apps/cli/src/commands/{run,serve,deploy,dev}.ts`、`apps/cli/src/sync/watch.ts` |
| 6 | P: T-401 顧客 UAT、Q: T-402 + T-403 分析・flaky、R: T-404 + T-405 作業セッション・異常検知 | 各画面・`core/audit` |
| 最後 | あなた: T-210 / T-307 / T-406 の受け入れ（ローカル + フェイク）→ 検証ウェーブ → PR を ready に | — |

**エージェントを起動するときの決まり:**

- **worktree**: 各エージェントは自分専用の git worktree とブランチ（`wip/T-xxx-短い名前`、統合ブランチの最新から作成）で作業する。Agent / Workflow の worktree 分離（`isolation: "worktree"`）が使えるならそれを使う。使えない場合は `git worktree add ../iw-<id> -b wip/<id>` で作る。
- **ブリーフ**: エージェントは会話の文脈を持たない。下の「エージェント用ブリーフ」を、担当タスクで埋めて渡す。
- **ウェーブの順序**: 同じウェーブ内のエージェントは並列に動かす。前のウェーブの統合と CI が通ってから次のウェーブを起動する。

### 6.3 統合（ウェーブごとにあなたが行う）

1. 各ブランチを `git merge --no-ff wip/T-xxx` で統合ブランチに入れる。
2. 衝突したら、両方の意図を残して直す。直し方が仕様に関わる場合は docs に合わせる。
3. エージェントから来た「契約の変更依頼」（スキーマ、依存、共通部品など）は、あなたが統合ブランチで反映する。必要なら docs も更新する。
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` を通す。落ちたら直してから次へ進む。
5. 使い終わった worktree を `git worktree remove` で片付ける。
6. TaskUpdate で進み具合を更新する。

### 6.4 検証ウェーブ（最後に Workflow で）

領域ごとの検証エージェントを、**実装したエージェントとは別に**起動する。領域は次の 6 つ。

- 認証と記録
- 仕様・TC・フィクスチャ
- 計画・実行・判定
- AI
- GitHub・MCP・UAT
- ポータビリティ（Bundle・CLI・書き出し・デプロイ）

検証エージェントには結論ではなくコードとドキュメントを渡し、次を確認させる。

- 担当画面の「この画面の完了条件」と、dev-plan の各タスクの完了条件を 1 つずつ確認し、満たしていない項目を挙げる。
- ポータビリティの領域では、SPEC-10 の完了条件を実際に試す。具体的には、`iw clone` → 無変更の push で差分 0 になること、フル書き出し → 取り込み → 再書き出しでハッシュが一致すること、ローカル専用モードで動くこと。
- `AGENTS.md` の作業ルール 1〜10 に違反していないか（`withAudit` / `localize` の通し忘れ、秘密の扱い、AI の draft）。
- 画面のスクリーンショット（Playwright、ja と en、ライト / ダーク）を `docs/screens/` のモックと見比べ、大きな違いを挙げる。
- dev-plan の「ID と記録の QA」（WATCH-TC-1〜10）を、ローカルで手順どおりに確認する。

指摘は、あなたが直すか、直さない理由を PR に書く。

### 6.5 時間や文脈が足りなくなったら

- ウェーブの途中ではなく、**ウェーブの区切り**で止める。統合ブランチは常に CI が通る状態に保つ。
- 未着手・途中のタスクは、PR の表に「未」「一部」と正直に書く。M1（T-101〜T-118）の完了は最低条件。
- 長い作業でも、PR が 1 本にまとまっていることを優先する（PR を分けない）。

## 7. エージェント用ブリーフ（起動のたびに埋めて渡す）

```
あなたは INDX Watch（AI ネイティブな E2E テスト / QA 管理プラットフォーム、Cloudflare 上）の実装担当です。
担当: {T-xxx と名前}。作業場所: worktree {パス}、ブランチ wip/{T-xxx-名前}（統合ブランチ {名前} の最新から作成済み）。

最初に読む:
- AGENTS.md
- docs/guides/dev-plan.html の {T-xxx} 節とファイル構成（#tree）
- 参照ドキュメント: {該当する spec と screens のファイル}

作るもの: {dev-plan のタスクの「作るもの」}
完了条件: {dev-plan のタスクの完了条件 + 該当画面の「この画面の完了条件」をそのまま貼る}

触ってよい場所: {パスの一覧}
触ってはいけない（凍結）:
- packages/db/schema とマイグレーション
- packages/core の ports.ts / messages.ts / domain
- すべての package.json の依存
- app-shell・ナビ・共通 UI 部品
- ほかのエージェントの担当パス
→ 変更が必要なら実装せず、最終報告の「契約の変更依頼」に、何をなぜ変えたいかを書く。

ルール:
- 書き込みは withAudit()、利用者の文字列の表示は localize()
- UI 文言は messages/{ja,en}/{画面 ID}.json の両方に足す
- 秘密の値を書かない
- AI の生成物は origin='ai' の draft
- 外部サービスは ports のインターフェース経由。テストではフェイクを使う
- 仕様と食い違う点は docs の該当箇所を直すコミットを先に作り、理由を報告に書く
- テスト: ロジックはユニットテスト、Worker / D1 は vitest-pool-workers、画面は Playwright E2E（Access 模擬で各ロール、ja と en）
- 終わる前に、自分の worktree で pnpm typecheck && pnpm lint && pnpm test && pnpm e2e が通ること
- コミットは日本語で、タスク ID から始める（例: "T-112: フィクスチャの版作成と差分表示"）

最終報告（日本語、短く）:
- 完了条件ごとの ○ / × と、× の理由
- 追加・変更したファイル
- 変えた docs
- 契約の変更依頼（Bundle の型の変更を含む）
- 要実機確認の項目
```

## 8. PR

- **作るタイミングとベース**:
  - M1 受け入れ（T-118）が通った時点で、統合ブランチから **draft PR** を作る。
  - ベースは `main`。
- **以降の扱い**: 以降のウェーブは同じブランチに push して PR を更新する。最後の検証が終わったら ready にする。**マージはしない**。
- **PR タイトル**: `INDX Watch v1: M1〜M4 の一括実装`（実装できた範囲に合わせて直す）。
- **PR 説明**（日本語。`.github/pull_request_template.md` の見出しに合わせる）:
  1. **概要と背景**: 2〜3 行。
  2. **タスク表**: T-101〜T-406 の全行。状態（完了 / 一部 / 未）と、一部・未の理由。
  3. **確認したこと**: 実行したコマンド、E2E の件数、受け入れシナリオ（T-118 / T-210 / T-307 / T-406）の結果、WATCH-TC-1〜10 の結果、スクリーンショット（ja / en）。
  4. **要実機確認**: H-01〜H-07 の設定後に確かめる項目と、確かめ方。最低限、次を含める。
     - 実際の Access の JWT と get-identity
     - Logpush の取り込み
     - Worker 単位の Access と Webhook Bypass の優先関係
     - Browser Run と、対象ホストだけに認証ヘッダを付ける動作
     - AI Gateway の BYOK と `cf.user_id`
     - Email Routing
     - GitHub App
     - vinext でのデプロイ
     - CLI の `cloudflared access` 経由の本人確認（オリジンに届く JWT、`get-identity`、OTP の顧客）
     - 空の Cloudflare アカウントへの `iw deploy`
  5. **docs の変更**: どのページの何をなぜ変えたか。
  6. **判断したこと**: ドキュメントに無く、自分で決めたこと。
  7. **既知の問題**。

## 9. 終わったら

最後に、次の 4 点を日本語で短く報告してください。

- PR の URL
- 実装できた範囲（タスクの完了数。ポータビリティ関連の T-119 / T-120 / T-211 / T-308 / T-309 を含む）
- 要実機確認の項目数と主なもの
- 人が次にやること（H-01〜H-07 の設定と実機確認）
