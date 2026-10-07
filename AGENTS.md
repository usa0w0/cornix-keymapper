# cornix-keymapper

Cornix LP（分割キーボード、RMK + Vial）のカスタムキーマッピングサイト。

## 仕様

- 仕様の正は [docs/spec.md](docs/spec.md)。実装・レビューの判断はこのファイルに従う
- 設計は [docs/design.md](docs/design.md)。設計を変える時は docs/design.md も同じ PR で直す
- 元の issue は usa0w0/workbench#3。引き継ぎ時点の記録であり、以後の正ではない
  - 読み方: `gh issue view 3 -R usa0w0/workbench --comments`

## 仕様を変える時

- docs/spec.md を PR で変更する
- 完了条件を変える場合は、PR に変更前後と理由を書き、マージ後に同じ内容を元の issue（usa0w0/workbench#3）にコメントする

## 進め方

- 作業はこのリポジトリの issue に1作業1件で切り、1件につき1つの PR で、小さい単位で実装する
- 進捗はこのリポジトリで管理する。workbench の issue には進捗を書かない
- ブランチは `main` と `feature/<内容を表す短い英語>` だけで運用し、`main` に直接コミット・push しない。マージ後、feature ブランチは削除する

## 開発

- Node.js 24（`.nvmrc`）。`nvm use` してから `npm install`
- PR を出す前に `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` を通す（CI も同じものを実行する）
- `main` にマージすると GitHub Actions（`.github/workflows/deploy.yml`）が GitHub Pages へデプロイする
- 実機（Cornix LP）が要る確認は AI にはできない。ユーザーに手順を示して確かめてもらう

## リリース時

1. docs/spec.md の完了条件を1つずつ実際に確かめる
2. 元の issue（usa0w0/workbench#3）本文の完了条件を docs/spec.md の内容に合わせる
3. 満たしているものにチェックを付け、確認方法をコメントする。満たしていないものがあれば、チェックを付けずにその旨をコメントする
4. close と shipped はユーザーが行う
