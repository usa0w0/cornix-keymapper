# cornix-keymapper

Cornix LP（分割キーボード、RMK + Vial）のカスタムキーマッピングサイト。
Vial の機能名を知らなくても、キーを選んで「どう押したら何が起きるか」を入れるだけで設定と書き込みができることを目指す。

- 公開先: https://usa0w0.github.io/cornix-keymapper/ （リリース版。`main` の内容）
- 開発版: https://usa0w0.github.io/cornix-keymapper/dev/ （`develop` の内容）
- 仕様: [docs/spec.md](docs/spec.md)
- 設計: [docs/design.md](docs/design.md)

## 使い方

- 対応ブラウザーは、デスクトップ版の Chrome か Edge（本体との通信に WebHID を使うため）。ほかのブラウザーでは、画面の上に警告が出て、接続できない
- 接続の前に、Vial など、キーボードの設定を開いているアプリやタブを閉じる。Cornix を USB か Bluetooth でパソコンにつなぎ、「接続」を押して、出てきた一覧から Cornix を選ぶ
- キーを選び、タップ・長押し・2回タップ・タップ後長押しの欄に動作を入れる。編集は画面に溜まり、「書き込み」で変更点を確かめてから、まとめて本体に書く
- 実機なしで試す時は、URL に `?fake` を付ける（例: https://usa0w0.github.io/cornix-keymapper/?fake ）。実機の代わりに、偽の機器につながる
- 設定の保存先は、次の3つだけ。サーバーには保存しない
  - 本体: 「書き込み」で書く。書いた後に読み直して、内容が合っているかを確かめる
  - `.vil` ファイル: 「.vil に保存」「.vil を読み込む」。Vial と同じ形式。マクロなど、このサイトで扱わない設定は含まれない
  - ブラウザー内の自動バックアップ: 書き込むたびに、直前の本体の設定を保存する（直近 5 回ぶん）。「バックアップ」から、その状態に戻せる。リリース版と開発版で別々に保存され、ブラウザーでサイトのデータを消すと消える

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
