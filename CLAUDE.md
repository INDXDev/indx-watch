# CLAUDE.md

@AGENTS.md

## Claude Code 向けの補足

- このリポジトリの正は `AGENTS.md` と `docs/`。作業前に `AGENTS.md` を読み、触る領域の `docs/spec/*.html` / `docs/screens/*.html` を確認する。
- 仕様の判断に迷ったら、推測で実装せずユーザーに日本語で質問する（AskUserQuestion）。
- スキーマ変更・画面追加では「docs 更新 → 実装」の順。docs とコードを同じ PR に含める。
- 返答・コミットメッセージ・PR 説明は日本語。README.md だけ英語で保つ。
- 秘密情報（テストアカウントの値、API キー）を出力・コミットしない。
