import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import type { Action } from '../model/action.ts'
import { listChanges } from '../model/diff.ts'
import {
  addCombo,
  editEncoder,
  editKey,
  editKeysTogether,
  loadSnapshot,
  replaceSource,
  sharedKeys,
  type EditState,
} from '../session/editState.ts'
import { ChangeListDialog } from './ChangeListDialog.tsx'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const B: Action = { kind: 'key', code: 0x05, mods: [] }

const render = (state: EditState, options: { confirmAll?: boolean; refused?: string } = {}) =>
  renderToStaticMarkup(
    <ChangeListDialog
      state={state}
      changes={listChanges(state)}
      onAction={() => {}}
      onClose={() => {}}
      initialConfirmAll={options.confirmAll}
      initialRefused={options.refused}
    />,
  )

const count = (html: string, needle: string) => html.split(needle).length - 1

/** キー、連動して変えたキーの組、エンコーダー、コンボを変えた状態 */
function edited(): EditState {
  let state = loadSnapshot(cornixSnapshot())
  state = editKey(state, 0, 8, { tap: B })
  state = editKeysTogether(state, sharedKeys(state, { layer: 0, key: 26 }), { tap: A, doubleTap: B })
  state = editEncoder(state, 0, 0, 'left', A)
  return addCombo(state, { keys: [0x04, 0x05], output: B })
}

test('変更点の確認: 件数と、「場所 / いま → 書き込む内容」の表を出す。行ごとに「取り消す」を置く', () => {
  const html = render(edited())
  expect(html).toContain('<h2 id="changes-title">変更点の確認（4 件）</h2>')
  expect(html).toContain('<th scope="col">場所</th><th scope="col">いま</th><th></th><th scope="col">書き込む内容</th>')
  expect(html).toContain(
    '<tr><th scope="row">レイヤー 0 ・ 行 1 列 1</th><td>A</td><td class="changes-arrow">→</td><td>B</td>' +
      '<td><button type="button" aria-label="レイヤー 0 ・ 行 1 列 1 の変更を取り消す">取り消す</button></td></tr>',
  )
  expect(html).toContain('<th scope="row">レイヤー 0 ・ エンコーダー 1 の左回し</th><td>マウスのホイールを上へ</td>')
  expect(html).toContain('<th scope="row">コンボ（追加）</th><td>（なし）</td><td class="changes-arrow">→</td><td>「A」と「B」を同時に押す → B</td>')
  // 取り消しの単位ごとに、ボタンは1つ
  expect(count(html, '>取り消す</button>')).toBe(4)
  expect(count(html, '<tbody')).toBe(4)
})

test('連動して変えたキーの組は、見出しの下にキーを並べた1件として出し、「取り消す」は1つだけ置く', () => {
  const html = render(edited())
  expect(html).toContain(
    '<tbody class="changes-group"><tr class="changes-title"><th scope="rowgroup" colSpan="4">連動して変えたキー（4 つ）</th>' +
      '<td><button type="button" aria-label="連動して変えたキー（4 つ） の変更を取り消す">取り消す</button></td></tr>',
  )
  const group = html.slice(html.indexOf('<tbody class="changes-group">')).split('</tbody>')[0]
  expect(count(group, '<th scope="row">')).toBe(4)
  expect(count(group, '<button')).toBe(1)
  // その変更のために本体の中で起きることは、行の下に添える。Tap Dance の番号は出さない
  expect(group).toContain(
    '<tr class="changes-notes"><td colSpan="5"><span>本体の Tap Dance の枠を 1つ使います。</span><span>使っていた Tap Dance の枠が 1つ空きます。</span></td></tr>',
  )
  expect(html).not.toMatch(/Tap Dance \d|TD\(/)
})

test('「本体に書き込む」は置き場所だけで、押せない。「すべて取り消す」は、確かめてから行う', () => {
  const html = render(edited())
  expect(html).toContain('<button type="button" class="primary" disabled="" title="準備中">本体に書き込む</button>')
  expect(html).toContain('<span class="changes-all"><button type="button">すべて取り消す…</button></span>')
  expect(html).toContain('<button type="button" class="changes-close">閉じる</button>')
  const confirming = render(edited(), { confirmAll: true })
  expect(confirming).toContain('4 件の変更をすべて取り消して、本体から読み込んだ内容に戻します。元には戻せません。')
  expect(confirming).toContain('<button type="button">すべて取り消す</button><button type="button">やめる</button>')
})

test('変更がない時は、その旨を出し、「すべて取り消す」は押せない', () => {
  const html = render(loadSnapshot(cornixSnapshot()))
  expect(html).toContain('変更点の確認（0 件）')
  expect(html).toContain('<p class="changes-empty">変更はありません。</p>')
  expect(html).not.toContain('<table')
  expect(html).toContain('<button type="button" disabled="">すべて取り消す…</button>')
})

test('取り消すと枠が足りなくなる変更は、取り消さずに、その行に理由を出す', () => {
  const html = render(edited(), { refused: 'key-0-26' })
  expect(html).toContain('<tr class="changes-refused"><td colSpan="5" role="alert">この変更を取り消すと、Tap Dance の枠が足りなくなるので、取り消せません。')
  expect(count(html, 'changes-refused')).toBe(1)
})

test('読み込んだ設定（出発点の入れ替え）は、全体を1件として出し、「読み込みを取り消す」を置く', () => {
  const source = cornixSnapshot()
  source.keymap[0][8] = 0x05
  source.keymap[0][9] = 0x06
  const html = render(replaceSource(editKey(loadSnapshot(cornixSnapshot()), 1, 8, { tap: A }), source))
  expect(html).toContain('変更点の確認（2 件）')
  expect(html).toContain('<th scope="rowgroup" colSpan="4">読み込んだ設定（.vil、バックアップ）</th>')
  expect(html).toContain('<button type="button" aria-label="読み込みを取り消す">読み込みを取り消す</button>')
  expect(count(html, '<button type="button" aria-label=')).toBe(2)
})
