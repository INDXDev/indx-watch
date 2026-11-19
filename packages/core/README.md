# packages/core — ドメインロジック

web と runner の両方から使う純粋な TypeScript。M1 で実装開始。

- `domain/`: zod スキーマ（steps_json、judges_json、decision_policy_json など）
- `policy/`: 判定ポリシー `decide()`、完了計算（AC / UC 状態、網羅率、Go / No-Go）
- `judges/`: assert / visual / llm ジャッジ
- `llm/`: Anthropic SDK クライアント（AI Gateway 経由）、プロンプトとバージョン
- `ids/`: `{prefix}_{ULID}` の生成
- ユニットテスト必須（vitest）
- 仕様: `docs/spec/domain.html`、`docs/spec/ai.html`
