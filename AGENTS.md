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

## ブランチ運用（git flow）

`~/dev/AGENTS.md` の「`main` と feature ブランチだけ」とは違い、このリポジトリは `develop` を挟む。このリポジトリではこの節に従う。

| ブランチ | 役割 |
| --- | --- |
| `main` | リリース済みの状態。ここへのマージで GitHub Pages に公開される |
| `develop` | 開発の本線。リポジトリの既定のブランチ。次のリリースに入る変更を集める |
| `feature/<内容を表す短い英語>` | 1つの作業。`develop` から切り、`develop` へ戻す |

- `main` と `develop` に直接コミット・push しない。変更は必ず PR を通す（GitHub のルールセットでも止めている）
- 作業は、最新の `develop` から feature ブランチを切って始める（例: `feature/webhid-transport`）。修正や文書だけの変更でも接頭辞は `feature/` にそろえる
- PR は `develop` に向け、[.github/pull_request_template.md](.github/pull_request_template.md) の見出しに沿って書く。対応する issue を `Closes #NN` で結び付ける
- feature → `develop` は squash でマージする（1つの PR が `develop` の1コミットになり、PR のタイトルがコミットメッセージになる）
- リリースは `develop` → `main` の PR で行い、マージコミットでマージする（squash すると `main` と `develop` の履歴が分かれ、次のリリースで衝突する）
- `main` に直接入れる変更は作らない。急ぎの修正も feature → `develop` → `main` の順に通す
- CI が通り、ユーザーがレビューしてからマージする。マージはユーザーが行う
- マージ後、feature ブランチは削除する（GitHub 側は自動で削除される。手元は `git branch -d`）
- 作業中に `develop` が進んだら、`develop` を feature ブランチにマージして取り込む（push 済みのブランチを rebase しない）

## 開発

- Node.js 24（`.nvmrc`）。`nvm use` してから `npm install`
- PR を出す前に `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` を通す（CI も同じものを実行する）
- `main` か `develop` に push されると GitHub Actions（`.github/workflows/deploy.yml`）が GitHub Pages へデプロイする。リリース版（`main`）は https://usa0w0.github.io/cornix-keymapper/ 、開発版（`develop`）は https://usa0w0.github.io/cornix-keymapper/dev/
- 実機（Cornix LP）が要る確認は AI にはできない。ユーザーに手順を示して確かめてもらう

## リリース時

1. `develop` から `main` への PR を出す。マージすると公開される
2. 公開されたサイトで、docs/spec.md の完了条件を1つずつ実際に確かめる
3. 元の issue（usa0w0/workbench#3）本文の完了条件を docs/spec.md の内容に合わせる
4. 満たしているものにチェックを付け、確認方法をコメントする。満たしていないものがあれば、チェックを付けずにその旨をコメントする
5. close と shipped はユーザーが行う
