# AGENTS.md — INDX Watch 開発エージェント向けガイド

このファイルは Claude Code などのコーディングエージェントが **最初に読む** 前提で書かれています。
プロジェクトの背景・決定事項・用語・フォルダ構成・作業ルールをここに集約し、詳細は `docs/` の HTML ドキュメントを参照します。

> 言語ルール: `README.md` のみ英語。それ以外（このファイル、`docs/`、コードコメント、コミットメッセージ本文）は日本語を基本とします。識別子（変数名・テーブル名・API パス）は英語。
> **プロダクト自体は日本語・英語の両方に対応します**（UI 文言はメッセージファイル、利用者が書く中身は原文 + 翻訳。`docs/spec/i18n.html`）。

> Cloudflare は変化が速い。Cloudflare の機能・上限・料金を前提にするときは、記憶ではなく developers.cloudflare.com と changelog を Web で確認し、`docs/spec/architecture.html` の「最新仕様の確認メモ」を更新すること。

---

## 1. プロジェクトの背景

INDX Watch は **AI ネイティブな E2E テスト / QA 管理プラットフォーム** です。Cloudflare 上でセルフホストし、社内（と招待した顧客）だけが使います。

解決したい課題:

- テスト仕様がスプレッドシートや Slack に散らばり、「どこが・どうなれば完了か」が分からない。
- テスト環境への入り方、テストアカウント、テストデータ（フィクスチャ）が属人化している。
- 誰が何をテストするのか（アサイン）と、その結果・証拠（スクリーンショット）が追えない。
- ビジネス職・エンジニア・QA で使う道具がバラバラで、顧客受け入れテスト（UAT）も別運用。
- AI（ブラウザエージェント・LLM 判定）を使いたいが、判定の根拠と人のレビューをどう組み込むか決まっていない。

INDX Watch はこれを **1 つのデータモデル** で解決します。仕様（ユースケース・完了条件・テストケース）、フィクスチャ、環境、リリース／デプロイメント、アサイン、実行結果、証拠、AI の判定がすべて同じモデルでつながります。

**単一の情報源は「Watch Bundle 形式」（型が決まったディレクトリ構成のファイル群）とその中身です。** Cloudflare（D1 + R2）は共有・同期・画面・AI 実行の中心ですが、あくまで置き場所の 1 つで、ロックインしません。`indx-watch/` フォルダに `watch.toml` を置けば、npx の CLI `iw` で一瞬で取り出し・同期・フル書き出し・別アカウントへのデプロイ（`iw deploy`）ができます（`docs/spec/portability.html`）。

## 2. 大事にしていること（設計原則）

1. **迷わない** — どの画面でも「次にやること」が 1 つはっきり見える。テスターは「マイタスク」を開けば、環境 URL・ログイン情報・手順・必要データがそろっている。
2. **誰でも QA できる** — 手順は平易な日本語。専門用語やセレクタを書かなくてもテストケースが作れ、実行できる。
3. **完了の定義が明確** — すべてのユースケースは完了条件（受け入れ基準 / AC）を持ち、AC はテストケースで網羅される。「完了」は計算で決まる。
4. **証拠ベース** — すべての判定にスクリーンショットなどの証拠と判定理由が付く。
5. **AI は提案、人が承認** — AI が作った仕様は `draft` で入り、人が承認して `ready` になる。AI の判定は信頼度付きで、閾値未満は人のレビューキューへ。
6. **すべて履歴が残る** — テストケースとフィクスチャはバージョン管理。実行は「どのバージョンの仕様・データで、どのデプロイに対して」行ったかを必ず記録。
7. **コードは少なく** — Next.js 1 アプリ + ランナー Worker 1 つ。Cloudflare のマネージド機能（D1 / R2 / Browser Run / Workflows / Queues / Access）に任せ、自前実装を増やさない。
8. **日本語と英語の両方で使える** — 外国籍のテスターもいる。仕様・手順は原文 + 翻訳（AI 翻訳 → 人が確認）で持ち、実行時にどの言語で読んだかを記録する。
9. **誰が・いつ・どこで・どう作業したかを残す** — Cloudflare Access の ID とリクエスト情報で、ログイン（失敗含む）・場所・端末・操作・作業時間を記録する。目的と閲覧権限を決めて告知する。
10. **ロックインしない** — 形式が正。いつでも失うものなく書き出し・取り込みでき、手元（ローカル専用モード）でも使える。Cloudflare 固有の部品は `ports.ts` の差し替え口の向こうに置く。

## 3. 用語とドメインモデル（要約）

詳細・状態遷移図は `docs/spec/domain.html`、テーブル定義は `docs/spec/data-model.html` が正。

| 用語 | 英語 / テーブル | 表示キー例 | 説明 |
|---|---|---|---|
| プロジェクト | Project / `projects` | `SHOP` | テスト対象アプリ 1 つ = GitHub リポジトリ 1 つ |
| 環境 | Environment / `environments` | `staging` | テストする場所。ベース URL・入り方・テストアカウント・リセット手順を持つ |
| リリース | Release / `releases` | `v2.4.0` | テスト対象のバージョン（Git タグ / マイルストーン） |
| デプロイメント | Deployment / `deployments` | `staging@a1b2c3d` | 特定コミットが特定環境に載ったもの。GitHub の deployment_status から自動作成 |
| 機能 | Feature / `features` | `FEAT-3` | 仕様ツリーの大分類（例: カート・決済） |
| ユースケース | Use case / `use_cases` | `UC-12` | ユーザーの目的単位（例: ゲストがクーポンを使って購入する） |
| 完了条件 | Acceptance criterion / `acceptance_criteria` | `AC-12.2` | ユースケースが「完了」と言える条件。UC 内連番 |
| テストケース | Test case / `test_cases` + `test_case_versions` | `TC-128` | AC を検証する具体的な手順と期待結果。バージョン管理 |
| フィクスチャ | Fixture / `fixtures` + `fixture_versions` | `FX-7` | テストの前提データ。種類: `dataset` / `seed` / `file` / `account` |
| テスト計画 | Test plan / `test_plans` | `PLAN-4` | リリースに対して「どのテストを誰がどの環境で」をまとめたもの |
| 計画アイテム（アサイン） | Plan item / `plan_items` | — | TC × 環境 × 担当者（人 or AI エージェント）× 期限 × 優先度 |
| 実行 | Run / `runs` | `RUN-1032` | TC の特定バージョンを特定デプロイに対して 1 回実行したもの |
| ステップ結果 | Step result / `run_steps` | — | 実行中の各ステップの結果と証拠 |
| 証拠 | Evidence / `evidence` | — | スクリーンショット・DOM / a11y スナップショット・コンソールログ・トレース（R2 に保存） |
| 判定 | Judgement / `judgements` | — | ジャッジ（assert / visual / llm / human）ごとの判定結果と理由・信頼度 |
| AI 提案 | AI suggestion / `ai_suggestions` | — | AI が生成した仕様・フィクスチャ・トリアージ案。人が承認 / 却下 |

ID 規約:
- 内部 ID: `{prefix}_{ULID}`（例: `tc_01JD8Z...`）。主キーはすべてこれ。
- 表示キー: プロジェクト内連番（`TC-128`）。プロジェクト横断では `SHOP-TC-128`。
- AC は UC 内連番で `AC-{UC番号}.{n}`（例: `AC-12.2`）。

優先度: `P0`（リリースブロッカー: ログイン・決済など）/ `P1`（高）/ `P2`（中）/ `P3`（低）。

実行モード（TC 単位）: `manual`（人が手順通りに実行）/ `agent`（AI ブラウザエージェントが自然言語手順を実行）/ `script`（Playwright スクリプト）/ `hybrid`（AI が実行し、人が確認）。

ジャッジ: `assert`（決定的チェック: URL・テキスト・要素・HTTP）/ `visual`（ベースライン画像との差分）/ `llm`（ルーブリックに基づく LLM 判定・信頼度付き）/ `human`（人の判定）。
複数ジャッジの結果は **判定ポリシー（Decision policy）** で 1 つの最終判定に集約する（`docs/spec/ai.html`）。

最終判定（verdict）: `pass` / `fail` / `blocked`（前提が崩れて実行不能）/ `skipped` / `needs_review`（人の確認待ち）。
実行状態（run state）: `queued` → `running` → `judging` → `completed` / `error`。
テストケースの状態: `draft` → `ready` → `deprecated`。
計画アイテムの状態: `todo` / `in_progress` / `done` / `blocked`。

翻訳: 翻訳対象のエンティティは `source_locale`（`ja` / `en`）と原文を持ち、もう一方の言語は `translations`（状態 `machine` / `reviewed` / `stale`）。表示は `localize()` に集約。テスト対象画面の文言（「」で囲む）は翻訳しない。

ログ・作業記録: `login_sessions`（Access のセッション）、`access_events`（Access の認証ログ。拒否も含む）、`activity_log`（変更と重要な閲覧。Ray ID・IP・国・都市・セッション付き）、`page_views`（閲覧と表示時間）、`work_sessions`（15 分の空白で区切った作業のまとまり）。

ロール: `admin` / `manager`（QA リード・PM）/ `tester`（QA・エンジニア・ビジネス職）/ `guest`（顧客。自分にアサインされた項目のみ見える）。AI エージェントは `kind = 'agent'` のシステムユーザー。

## 4. 技術スタックと構成

詳細は `docs/spec/architecture.html`。

- **言語**: TypeScript（strict）。パッケージ管理は pnpm workspaces。
- **apps/web**: Next.js（App Router）を **vinext**（Cloudflare 推奨・Vite ベース）で Cloudflare Workers にデプロイ。互換性問題が出たら `@opennextjs/cloudflare` にフォールバック。UI は Tailwind CSS + shadcn/ui、多言語は `next-intl`。データ取得は Server Components、更新は Server Actions。外部向けは Route Handlers（`/api/github/webhook`、`/api/runner/*`、`/mcp`）。
- **apps/runner**: 素の Worker。Cloudflare Workflows（実行の各ステップを耐久的に処理。人のレビュー待ちは `step.waitForEvent`、定期実行は Workflow の `schedules`）、Queues（実行・翻訳・ログ取り込みのジョブ）、Browser Run（旧 Browser Rendering。`@cloudflare/playwright`、録画、Live View、Human in the Loop）、Email Worker（テストメールの受信）、Access ログの取り込み。
- **packages/db**: Drizzle ORM のスキーマとマイグレーション（D1）。
- **packages/core**: ドメイン型（zod）、判定ポリシー、ジャッジ、LLM クライアント、ID 生成、外部への差し替え口（`ports.ts`）。web・runner・CLI から使う。
- **packages/bundle**: Watch Bundle 形式（zod の型・JSON Schema・正規化した TOML・D1 の行との変換・3 方向マージ・フル書き出し）。web・runner・CLI 共通。
- **apps/cli**: CLI `iw`（npx で配布。`indx-watch/iw` 起動スクリプトが版を固定）。clone / pull / push / sync / check / report / export / import / deploy / dev。認証は Cloudflare 公式ツールを包むだけ: データは `cloudflared access`（`iw login`、`cf-access-token` ヘッダ）、デプロイは `wrangler`（`wrangler login` / `CLOUDFLARE_API_TOKEN`）。CLI のコードは公開してよい（秘密を含まない）。
- **データ**: D1（メタデータ全部）、R2（証拠ファイル・フィクスチャ本体・ベースライン画像）。
- **認証**: Cloudflare Access（Zero Trust）を Worker 単位で付ける。Worker は `jose` で `Cf-Access-Jwt-Assertion` を検証し（`ctx.access` は Static Assets のある Worker では使えない）、`sub` / `identity_nonce` でユーザーとセッションを特定、新しいセッションでは `get-identity` を 1 回呼ぶ。顧客（guest）は One-time PIN + Independent MFA で個別招待。`/api/github/webhook` だけ Access をバイパスし HMAC 署名で検証。失敗・拒否ログインは Logpush（`access_requests` → R2）と REST で取り込む（`docs/spec/identity-audit.html`）。
- **LLM**: Anthropic Claude を Cloudflare AI Gateway 経由で呼ぶ（BYOK、spend limits、`cf-aig-metadata` に project_key / run_id、秘密を含む本文はログに残さない）。翻訳も Claude。既定モデル: ブラウザエージェント・仕様生成 = `claude-opus-5-5`、LLM ジャッジ・分類 = `claude-sonnet-5-5`、大量の軽い処理 = `claude-haiku-5-5`。プロジェクト設定で変更可能。判定は構造化出力（`output_config.format`）で JSON を受け取る。
- **GitHub 連携**: GitHub App。`pull_request`（影響テストの提案）、`deployment_status`（デプロイメント作成とスモーク自動実行）、`release`（リリース作成）を受信。結果は Check Run と PR コメント、失敗時は Issue 作成。
- **MCP**: `/mcp` に MCP サーバーを公開し、Claude Code から仕様の参照・ドラフト作成・実行開始ができる。

## 5. フォルダ構成

```
.
├── AGENTS.md               # このファイル（エージェント向けの正）
├── CLAUDE.md               # Claude Code 用。AGENTS.md を読み込む
├── README.md               # 英語の概要
├── docs/                   # 単一の情報源（Single Source of Truth）。HTML
│   ├── index.html          # ドキュメントの入口
│   ├── assets/             # 共有 CSS / JS（docs.css, docs.js）
│   ├── spec/               # 第 1 層: 仕様（何を・なぜ）
│   │   ├── prd.html            # PRD
│   │   ├── domain.html         # ドメインモデル・用語・状態遷移
│   │   ├── ux.html             # UX 原則・情報設計・ユーザーフロー
│   │   ├── data-model.html     # D1 / R2 設計
│   │   ├── architecture.html   # Cloudflare 構成・認証・GitHub 連携・最新仕様の確認メモ
│   │   ├── ai.html             # AI ネイティブ設計（実行モード・ジャッジ・判定ポリシー・MCP）
│   │   ├── interactions.html   # ER 図（全テーブル）・コンポーネント間通信・アクター別シーケンス・CRUD
│   │   ├── i18n.html           # 多言語（日本語・英語）設計
│   │   ├── identity-audit.html # 認証・ログイン・行動ログ（Cloudflare Access の ID と各種ログ）
│   │   └── portability.html    # ポータビリティ: Watch Bundle 形式・iw CLI・同期・書き出し・iw deploy
│   ├── screens/            # 第 2 層: 画面ごとの UX アーティファクト（モック + 画面仕様）
│   ├── prompts/            # Claude Code に貼るプロンプト（implement-all.md: 一括実装）
│   └── guides/             # 第 2 層: どう作るか / どう使うか
│       ├── implementation.html     # 実装ガイド・規約・コード例
│       ├── target-onboarding.html  # テスト対象アプリ・環境の登録ガイド
│       └── dev-plan.html           # 開発プラン: ドキュメント運用・コンポーネント / ファイル構成の正・タスク T-xxx
├── apps/
│   ├── cli/                # iw CLI（npx: @indx/watch）。同期・書き出し・iw deploy
│   ├── web/                # Next.js（UI + API）→ Worker: indx-watch-web
│   └── runner/             # 実行基盤（Workflows / Queues / Browser Run / Email）→ Worker: indx-watch-runner
└── packages/
    ├── bundle/             # Watch Bundle 形式（型・正規化・変換・マージ・アーカイブ）
    ├── core/               # ドメイン型・判定ポリシー・ジャッジ・LLM クライアント・ports
    └── db/                 # Drizzle スキーマ・D1 マイグレーション
```

ファイル単位の構成（全ファイルと作成タスク）は `docs/guides/dev-plan.html#tree` が正。

画面 ID とルート（`docs/screens/`）:

| ID | 画面 | ルート |
|---|---|---|
| S01 | マイタスク | `/` |
| S02 | リリース準備状況 | `/p/[key]/releases/[version]` |
| S03 | 仕様ツリー | `/p/[key]/specs` |
| S04 | テストケース詳細・編集 | `/p/[key]/tc/[n]` |
| S05 | テスト実行（手動ランナー） | `/p/[key]/runs/[n]/execute` |
| S06 | AI 実行ビューア・レビューキュー | `/p/[key]/runs/[n]`、`/review` |
| S07 | フィクスチャ管理 | `/p/[key]/fixtures` |
| S08 | テスト計画・アサイン | `/p/[key]/plans/[n]` |
| S09 | 環境・アクセス | `/p/[key]/environments` |
| S10 | AI 仕様取り込み | `/p/[key]/specs/import` |
| S11 | GitHub・デプロイメント | `/p/[key]/deployments` |
| S12 | ログイン・作業履歴（admin） | `/admin/activity` |
| S13 | データの持ち出し（書き出し・取り込み・CLI） | `/p/[key]/data` |

## 6. 作業ルール（エージェント向け）

1. **ドキュメントが正**。仕様と実装が食い違ったら、まず `docs/` を更新する PR にするか、ユーザーに確認する。実装だけ先に変えない。
2. スキーマを変えるときは `packages/db` のスキーマとマイグレーション、`docs/spec/data-model.html` を **同じコミットで** 更新する。
3. 新しい画面・大きな UI 変更は、先に `docs/screens/` に HTML モックを追加・更新する。
4. コード量を増やさない。Cloudflare のマネージド機能や既存ライブラリで済むなら自前で書かない。新しい依存を足すときは理由をコミットメッセージに書く。
5. **ユーザーが書く文字列を表示するときは必ず `localize()` を通す**。UI 文言は `messages/{ja,en}.json` に足し、両方のキーをそろえる。
6. **書き込みは `withAudit()` を通す**。`activity_log` にログインセッション・Ray ID・IP・場所を付けて記録する。重要な閲覧（秘密情報のコピー、S12 の閲覧、書き出し）も記録する。
7. 秘密情報（テストアカウントのパスワード、API キー）を D1 やリポジトリに平文で置かない。D1 には参照名だけを保存し、値は Workers Secrets / Secrets Store に置く。
8. AI が生成・変更したデータは `origin = 'ai'` と生成元（モデル・プロンプトバージョン）を記録し、人の承認なしに `ready` にしない。
9. UI 文言は平易な日本語（英語も平易に）。ビジネス職が読んで分かる言葉にする（例: 「Webhook 設定」ではなく「GitHub 通知」）。
10. ドキュメント HTML は `docs/assets/docs.css` の共有スタイルを使う。色はトークン（CSS 変数）経由のみ。
11. **Bundle の型を先に**。新しい項目は `packages/bundle` の zod の型と対応表（`portability.html#mapping`）に足してから使う。ファイルの書き出しは必ず正規化関数を通す。

## 7. 現在のフェーズ

- **M0（完了）**: ドキュメント整備。コードはまだない。`apps/` と `packages/` は README のみ。
- **次にやること**: `docs/guides/dev-plan.html` の M0.5（人の準備 H-01〜H-07）と T-101 から。タスクは 1 タスク = 1 PR、依頼テンプレートは同ページの「Claude Code への依頼の仕方」。全タスクを 1 本の PR にまとめる場合は `docs/prompts/implement-all.md`（worktree × Workflow）。
- M1: 認証とログイン記録・プロジェクト / 環境 / リリース・仕様ツリー・手動ランナー・マイタスク・フィクスチャ・リリース準備状況・日英 UI と翻訳。
- M2: AI 仕様取り込み・ブラウザエージェント実行・LLM ジャッジ・レビューキュー。
- M3: GitHub App 連携・定期実行・ビジュアル差分・MCP サーバー。
- M4: 顧客 UAT（guest）・分析・不安定テスト検出。

タスク分解・依存関係・完了条件は `docs/guides/dev-plan.html`。

確定した決定（2026-11-19）: 社員の IdP は Google Workspace、顧客は One-time PIN + Independent MFA。ログの目的は「すべての作業と判定を ID に対応づける」ことと不正アクセスの検知で、人事評価には使わない。

## 8. よく使うコマンド（M1 以降で有効）

```bash
pnpm install
pnpm dev                    # apps/web をローカル起動（wrangler の D1/R2 ローカルエミュレーション）
pnpm db:generate            # Drizzle からマイグレーション SQL を生成
pnpm db:migrate:local       # ローカル D1 に適用
pnpm db:migrate:remote      # 本番 D1 に適用（要確認）
pnpm deploy                 # web と runner を Cloudflare にデプロイ
pnpm test                   # ユニットテスト（vitest）
```
