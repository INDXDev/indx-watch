# AGENTS.md — INDX Watch 開発エージェント向けガイド

このファイルは Claude Code などのコーディングエージェントが **最初に読む** 前提で書かれています。
プロジェクトの背景・決定事項・用語・フォルダ構成・作業ルールをここに集約し、詳細は `docs/` の HTML ドキュメントを参照します。

> 言語ルール: `README.md` のみ英語。それ以外（このファイル、`docs/`、コードコメント、コミットメッセージ本文、UI 文言）は日本語を基本とします。識別子（変数名・テーブル名・API パス）は英語。

---

## 1. プロジェクトの背景

INDX Watch は **AI ネイティブな E2E テスト / QA 管理プラットフォーム** です。Cloudflare 上でセルフホストし、社内（と招待した顧客）だけが使います。

解決したい課題:

- テスト仕様がスプレッドシートや Slack に散らばり、「どこが・どうなれば完了か」が分からない。
- テスト環境への入り方、テストアカウント、テストデータ（フィクスチャ）が属人化している。
- 誰が何をテストするのか（アサイン）と、その結果・証拠（スクリーンショット）が追えない。
- ビジネス職・エンジニア・QA で使う道具がバラバラで、顧客受け入れテスト（UAT）も別運用。
- AI（ブラウザエージェント・LLM 判定）を使いたいが、判定の根拠と人のレビューをどう組み込むか決まっていない。

INDX Watch はこれを **1 つのデータベース（D1）を単一の情報源** として解決します。仕様（ユースケース・完了条件・テストケース）、フィクスチャ、環境、リリース／デプロイメント、アサイン、実行結果、証拠、AI の判定がすべて同じモデルでつながります。

## 2. 大事にしていること（設計原則）

1. **迷わない** — どの画面でも「次にやること」が 1 つはっきり見える。テスターは「マイタスク」を開けば、環境 URL・ログイン情報・手順・必要データがそろっている。
2. **誰でも QA できる** — 手順は平易な日本語。専門用語やセレクタを書かなくてもテストケースが作れ、実行できる。
3. **完了の定義が明確** — すべてのユースケースは完了条件（受け入れ基準 / AC）を持ち、AC はテストケースで網羅される。「完了」は計算で決まる。
4. **証拠ベース** — すべての判定にスクリーンショットなどの証拠と判定理由が付く。
5. **AI は提案、人が承認** — AI が作った仕様は `draft` で入り、人が承認して `ready` になる。AI の判定は信頼度付きで、閾値未満は人のレビューキューへ。
6. **すべて履歴が残る** — テストケースとフィクスチャはバージョン管理。実行は「どのバージョンの仕様・データで、どのデプロイに対して」行ったかを必ず記録。
7. **コードは少なく** — Next.js 1 アプリ + ランナー Worker 1 つ。Cloudflare のマネージド機能（D1 / R2 / Browser Rendering / Workflows / Queues / Access）に任せ、自前実装を増やさない。

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

ロール: `admin` / `manager`（QA リード・PM）/ `tester`（QA・エンジニア・ビジネス職）/ `guest`（顧客。自分にアサインされた項目のみ見える）。AI エージェントは `kind = 'agent'` のシステムユーザー。

## 4. 技術スタックと構成

詳細は `docs/spec/architecture.html`。

- **言語**: TypeScript（strict）。パッケージ管理は pnpm workspaces。
- **apps/web**: Next.js（App Router）を `@opennextjs/cloudflare` で Cloudflare Workers にデプロイ。UI は Tailwind CSS + shadcn/ui。データ取得は Server Components、更新は Server Actions。外部向けは Route Handlers（`/api/github/webhook`、`/api/runner/*`、`/mcp`）。
- **apps/runner**: 素の Worker。Cloudflare Workflows（実行の各ステップを耐久的に処理）、Queues（実行ジョブの投入）、Browser Rendering（`@cloudflare/playwright`）、Cron Triggers（定期実行）。
- **packages/db**: Drizzle ORM のスキーマとマイグレーション（D1）。
- **packages/core**: ドメイン型（zod）、判定ポリシー、ジャッジ、LLM クライアント、ID 生成。web と runner の両方から使う。
- **データ**: D1（メタデータ全部）、R2（証拠ファイル・フィクスチャ本体・ベースライン画像）。
- **認証**: Cloudflare Access（Zero Trust）をアプリの前段に置く。Worker は `Cf-Access-Jwt-Assertion` を検証し、メールアドレスで `users` と突き合わせる。顧客（guest）は Access のワンタイム PIN で個別招待。`/api/github/webhook` だけ Access をバイパスし HMAC 署名で検証。
- **LLM**: Anthropic Claude を Cloudflare AI Gateway 経由で呼ぶ（ログ・レート制御・コスト可視化）。既定モデル: ブラウザエージェント・仕様生成 = `claude-opus-5-5`、LLM ジャッジ・分類 = `claude-sonnet-5-5`、大量の軽い処理 = `claude-haiku-5-5`。プロジェクト設定で変更可能。判定は構造化出力（`output_config.format`）で JSON を受け取る。
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
│   │   ├── architecture.html   # Cloudflare 構成・認証・GitHub 連携
│   │   └── ai.html             # AI ネイティブ設計（実行モード・ジャッジ・判定ポリシー・MCP）
│   ├── screens/            # 第 2 層: 画面ごとの UX アーティファクト（モック + 画面仕様）
│   └── guides/             # 第 2 層: どう作るか / どう使うか
│       ├── implementation.html     # 実装ガイド・規約・ロードマップ
│       └── target-onboarding.html  # テスト対象アプリ・環境の登録ガイド
├── apps/
│   ├── web/                # Next.js（UI + API）→ Worker: indx-watch-web
│   └── runner/             # 実行基盤（Workflows / Queues / Browser Rendering）→ Worker: indx-watch-runner
└── packages/
    ├── core/               # ドメイン型・判定ポリシー・ジャッジ・LLM クライアント
    └── db/                 # Drizzle スキーマ・D1 マイグレーション
```

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

## 6. 作業ルール（エージェント向け）

1. **ドキュメントが正**。仕様と実装が食い違ったら、まず `docs/` を更新する PR にするか、ユーザーに確認する。実装だけ先に変えない。
2. スキーマを変えるときは `packages/db` のスキーマとマイグレーション、`docs/spec/data-model.html` を **同じコミットで** 更新する。
3. 新しい画面・大きな UI 変更は、先に `docs/screens/` に HTML モックを追加・更新する。
4. コード量を増やさない。Cloudflare のマネージド機能や既存ライブラリで済むなら自前で書かない。新しい依存を足すときは理由をコミットメッセージに書く。
5. 秘密情報（テストアカウントのパスワード、API キー）を D1 やリポジトリに平文で置かない。D1 には参照名だけを保存し、値は Workers Secrets / Secrets Store に置く。
6. AI が生成・変更したデータは `origin = 'ai'` と生成元（モデル・プロンプトバージョン）を記録し、人の承認なしに `ready` にしない。
7. UI 文言は平易な日本語。ビジネス職が読んで分かる言葉にする（例: 「Webhook 設定」ではなく「GitHub 通知」）。
8. ドキュメント HTML は `docs/assets/docs.css` の共有スタイルを使う。色はトークン（CSS 変数）経由のみ。

## 7. 現在のフェーズ

- **M0（現在）**: ドキュメント整備。コードはまだない。`apps/` と `packages/` は README のみ。
- M1: 認証・プロジェクト / 環境 / リリース・仕様ツリー・手動ランナー・マイタスク・フィクスチャ・リリース準備状況。
- M2: AI 仕様取り込み・ブラウザエージェント実行・LLM ジャッジ・レビューキュー。
- M3: GitHub App 連携・定期実行・ビジュアル差分・MCP サーバー。
- M4: 顧客 UAT（guest）・分析・不安定テスト検出。

ロードマップの詳細は `docs/guides/implementation.html`。

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
