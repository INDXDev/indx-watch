# apps/web — UI + API（Worker: `indx-watch-web`）

Next.js（App Router）を `@opennextjs/cloudflare` で Cloudflare Workers にデプロイするアプリ。M1 で実装開始。

- 画面: `docs/screens/` の S01〜S11（ルートは `AGENTS.md` の画面一覧）
- データ取得は Server Components、更新は Server Actions
- 外部向け Route Handlers: `/api/github/webhook`、`/api/runner/*`、`/mcp`
- 認証: Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion`）を検証
- 詳細: `docs/guides/implementation.html`、`docs/spec/architecture.html`
