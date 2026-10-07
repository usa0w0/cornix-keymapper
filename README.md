# cornix-keymapper

Cornix LP（分割キーボード、RMK + Vial）のカスタムキーマッピングサイト。
Vial の機能名を知らなくても、キーを選んで「どう押したら何が起きるか」を入れるだけで設定と書き込みができることを目指す。

- 公開先: https://usa0w0.github.io/cornix-keymapper/ （リリース版。`main` の内容）
- 開発版: https://usa0w0.github.io/cornix-keymapper/dev/ （`develop` の内容）
- 仕様: [docs/spec.md](docs/spec.md)
- 設計: [docs/design.md](docs/design.md)

## 開発

Node.js 24 が必要（`nvm use` で `.nvmrc` の版に切り替わる）。

```sh
npm install
npm run dev        # 開発サーバー
npm test           # 単体テスト
npm run lint       # oxlint
npm run typecheck  # 型検査
npm run build      # dist/ に本番ビルド
```

本体との通信には WebHID を使うため、動作確認はデスクトップ版の Chrome か Edge で行う。
