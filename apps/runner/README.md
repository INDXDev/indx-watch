# apps/runner — 実行基盤（Worker: `indx-watch-runner`）

テスト実行を担う素の Worker。M1（手動実行の補助）〜 M2（エージェント実行）で実装。

- Cloudflare Workflows: 1 実行 = 1 Workflow インスタンス（準備 → ブラウザ → ステップ → 証拠 → ジャッジ → 判定 → 通知）
- Queues: 実行ジョブの投入と並列度制御
- Browser Rendering: `@cloudflare/playwright`
- Cron Triggers: `schedules` の定期実行
- 詳細: `docs/spec/architecture.html`、`docs/spec/ai.html`
