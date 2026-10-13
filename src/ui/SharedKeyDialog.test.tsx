import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import { LAYER_MODES, type Action } from '../model/action.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { placeKeys } from '../model/layout.ts'
import { editKey, editKeysTogether, loadSnapshot } from '../session/editState.ts'
import { KeyEditor } from './KeyEditor.tsx'
import { behaviorView } from './keyView.ts'
import { decideSharedEdit, sharedKeyList, type SharedAnswer } from './sharedKey.ts'
import { SharedKeyDialog } from './SharedKeyDialog.tsx'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const SPACE: Action = { kind: 'key', code: 0x2c, mods: [] }
const ESC: Action = { kind: 'key', code: 0x29, mods: [] }
const CTRL: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] }
const GUI: Action = { kind: 'key', mods: [{ kind: 'gui', side: 'left' }] }
const A_ESC: KeyBehavior = { tap: A, doubleTap: ESC }
const SPACE_GUI_ESC: KeyBehavior = { tap: SPACE, hold: GUI, doubleTap: ESC }
const SPACE_CTRL: KeyBehavior = { tap: SPACE, hold: CTRL }

/** 実機の設定で、Tap Dance の枠 0（タップ Space ／ 長押し 左 GUI）を指している、レイヤー 0・1・2 のキー */
const SLOT0 = [
  { layer: 0, key: 26 },
  { layer: 1, key: 26 },
  { layer: 1, key: 54 },
  { layer: 2, key: 26 },
]
const HERE = SLOT0[0]

const count = (html: string, needle: string) => html.split(needle).length - 1

/** 空いている枠がない設定。枠 2〜31 に別々の中身を入れ、レイヤー 9 のキーから1つずつ指す */
function full(): KeyboardSnapshot {
  const snapshot = cornixSnapshot()
  for (let slot = 2; slot < 32; slot++) {
    snapshot.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
    snapshot.keymap[9][slot] = 0x5700 + slot
  }
  return snapshot
}

test('確認が要るか: 同じ枠を指すキーがほかにあれば確認し、なければ、このキーだけを変える', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  expect(decideSharedEdit(loaded, HERE, null)).toEqual({ kind: 'ask', keys: SLOT0 })
  // 枠 1 を指すキーは1つだけ。枠を使わないキーも、確認しない
  expect(decideSharedEdit(loaded, { layer: 0, key: 54 }, null)).toEqual({ kind: 'only' })
  expect(decideSharedEdit(loaded, { layer: 0, key: 1 }, null)).toEqual({ kind: 'only' })
  // MT で同じ内容になっているキーは、共有ではないので、確認しない
  const mt = editKey(editKey(loaded, 0, 1, SPACE_CTRL), 0, 2, SPACE_CTRL)
  expect(decideSharedEdit(mt, { layer: 0, key: 1 }, null)).toEqual({ kind: 'only' })
  // この画面の編集で、同じ枠を使うことになったキーは、確認する
  const made = editKey(editKey(loaded, 0, 1, A_ESC), 0, 2, A_ESC)
  expect(decideSharedEdit(made, { layer: 0, key: 1 }, null)).toEqual({
    kind: 'ask',
    keys: [
      { layer: 0, key: 1 },
      { layer: 0, key: 2 },
    ],
  })
})

test('確認が要るか: そのキーを選んでいる間は、最初の答えで進める。別のキーと、出発点が替わった後には使わない', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const only: SharedAnswer = { ...HERE, source: loaded.source, together: null }
  const together: SharedAnswer = { ...HERE, source: loaded.source, together: SLOT0 }
  expect(decideSharedEdit(loaded, HERE, only)).toEqual({ kind: 'only' })
  expect(decideSharedEdit(loaded, HERE, together)).toEqual({ kind: 'together', keys: SLOT0 })
  // 連動して変えた後も、同じ4つを連動して変え続ける。MT になって枠を使わなくなっても続ける
  const tapDance = editKeysTogether(loaded, SLOT0, SPACE_GUI_ESC)
  expect(decideSharedEdit(tapDance, HERE, together)).toEqual({ kind: 'together', keys: SLOT0 })
  const mt = editKeysTogether(loaded, SLOT0, SPACE_CTRL)
  expect(decideSharedEdit(mt, HERE, together)).toEqual({ kind: 'together', keys: SLOT0 })
  // 答えがなければ、MT になったキーは共有ではないので、このキーだけを変える
  expect(decideSharedEdit(mt, HERE, null)).toEqual({ kind: 'only' })
  // 別のキーの答えと、前の出発点での答えは使わない
  expect(decideSharedEdit(loaded, SLOT0[1], together)).toEqual({ kind: 'ask', keys: SLOT0 })
  expect(decideSharedEdit(loadSnapshot(cornixSnapshot()), HERE, only)).toEqual({ kind: 'ask', keys: SLOT0 })
})

test('確認が要るか: 連動して変えた先が、ほかのキーの枠と同じ内容になったら、そのキーも見せて、もう一度確認する', () => {
  // 枠 2（タップ A ／ 2回タップ Esc）を、レイヤー 9 のキーが使っている
  const snapshot = cornixSnapshot()
  snapshot.tapDances[2] = { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 }
  snapshot.keymap[9][2] = 0x5702
  const loaded = loadSnapshot(snapshot)
  const together: SharedAnswer = { ...HERE, source: loaded.source, together: SLOT0 }
  const joined = editKeysTogether(loaded, SLOT0, A_ESC)
  expect(decideSharedEdit(joined, HERE, together)).toEqual({ kind: 'ask', keys: [...SLOT0, { layer: 9, key: 2 }] })
})

test('確認の内容: いまの内容、変えた後の内容、同じ枠を指すキーの場所、「このキーだけ変更」で枠を使うか', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  expect(sharedKeyList(loaded, HERE, SLOT0, SPACE_GUI_ESC, 'us')).toEqual({
    name: 'タップ: Space ／ 長押し: 左 GUI（Cmd / Win）',
    next: 'タップ: Space ／ 長押し: 左 GUI（Cmd / Win） ／ 2回タップ: Escape',
    keys: [
      { layer: 0, key: 26, place: 'レイヤー 0 ・ 行 3 列 5', current: true },
      { layer: 1, key: 26, place: 'レイヤー 1 ・ 行 3 列 5', current: false },
      { layer: 1, key: 54, place: 'レイヤー 1 ・ 行 7 列 5', current: false },
      { layer: 2, key: 26, place: 'レイヤー 2 ・ 行 3 列 5', current: false },
    ],
    only: 'new',
    free: 30,
  })
  // 枠を使わない内容（MT、通常のキー）にするなら、「このキーだけ変更」でも枠は増えない
  expect(sharedKeyList(loaded, HERE, SLOT0, SPACE_CTRL, 'us')).toMatchObject({ next: 'タップ: Space ／ 長押し: 左 Ctrl', only: 'none' })
  expect(sharedKeyList(loaded, HERE, SLOT0, {}, 'us')).toMatchObject({ next: '何もしない', only: 'none' })
  // 空いている枠がなければ、「このキーだけ変更」は、枠が足りない
  expect(sharedKeyList(loadSnapshot(full()), HERE, SLOT0, SPACE_GUI_ESC, 'us')).toMatchObject({ only: 'short', free: 0 })
})

test('確認のダイアログ: 同じ枠を指すキーの場所の一覧と、レイヤーごとの図、「4 つとも変更」「このキーだけ変更」「やめる」を出す', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const places = placeKeys(loaded.source.layout)
  const dialog = (state = loaded) =>
    renderToStaticMarkup(
      <SharedKeyDialog
        list={sharedKeyList(state, HERE, SLOT0, SPACE_GUI_ESC, 'us')}
        places={places}
        onTogether={() => {}}
        onOnly={() => {}}
        onClose={() => {}}
      />,
    )
  const html = dialog()
  expect(html).toContain('このキーと同じ内容のキーが、ほかに 3 つあります')
  expect(html).toContain('「タップ: Space ／ 長押し: 左 GUI（Cmd / Win）」のキーは、次の 4 か所にあり、本体の中で1つの枠を共有しています。')
  expect(html).toContain('<li>レイヤー 0 ・ 行 3 列 5<span class="plain-list-note">（いま変えようとしているキー）</span></li>')
  expect(html).toContain('<li>レイヤー 1 ・ 行 7 列 5</li>')
  expect(count(html, '<li>')).toBe(4)
  // 図は、同じ枠を指すキーがあるレイヤー（0・1・2）ぶん。キー 50 個とエンコーダーの 4 つを並べ、対象のキーに印を付ける
  expect(count(html, '<figure class="mini-figure">')).toBe(3)
  expect(html).toContain('<figcaption>レイヤー 1</figcaption>')
  expect(count(html, 'class="mini-key')).toBe(54 * 3)
  expect(count(html, 'class="mini-key shared')).toBe(4)
  expect(count(html, 'class="mini-key shared current"')).toBe(1)
  expect(html).toContain('aria-label="同じ内容のキーの位置: レイヤー 0 ・ 行 3 列 5（いま変えようとしているキー）"')
  expect(html).toContain('aria-label="同じ内容のキーの位置: レイヤー 1 ・ 行 3 列 5、レイヤー 1 ・ 行 7 列 5"')
  expect(html).toContain('「このキーだけ変更」を選ぶと、枠を1つ新しく使います（残り 30）。')
  expect(html).toMatch(/やめる<\/button>.*このキーだけ変更<\/button>.*class="primary">4 つとも変更<\/button>/)
  // 番号は出さない
  expect(html).not.toContain('Tap Dance')

  expect(dialog(loadSnapshot(full()))).toContain('「このキーだけ変更」には枠が1つ要りますが、空いている枠がありません。')
})

test('編集欄: 連動して変えたキーの「変更を取り消す」には、まとめて戻るキーの数を出す', () => {
  const editor = (linked?: number) =>
    renderToStaticMarkup(
      <KeyEditor
        layer={0}
        place={{ row: 3, col: 5 }}
        behavior={SPACE_GUI_ESC}
        view={behaviorView(SPACE_GUI_ESC, 'us')}
        changed
        linked={linked}
        legend="us"
        layerCount={10}
        layerModes={LAYER_MODES}
        onChange={() => {}}
        onRevert={() => {}}
      />,
    )
  expect(editor(4)).toContain('>変更を取り消す（連動して変えた 4 つとも）</button>')
  expect(editor(1)).toContain('>変更を取り消す</button>')
  expect(editor()).toContain('>変更を取り消す</button>')
})
