import { expect, test } from 'vitest'
import { candidates, labelOf, LAYER_MODES, type Action, type ActionSlot, type PickerContext } from '../model/action.ts'
import { actionToKeycode } from '../model/keycodes.ts'
import {
  actionId,
  BOARD_BLOCKS,
  BOARD_MAIN,
  BOARD_NAVIGATION,
  boardAction,
  boardFace,
  cellWidth,
  isCurrent,
  layerChoices,
  pickerStartId,
  startCategory,
  startLayerMode,
  startTogether,
  type BoardCell,
} from './pickerBoard.ts'

type Pressable = Exclude<BoardCell, { kind: 'gap' }>

const context = (slot: ActionSlot, extra: Partial<PickerContext> = {}): PickerContext => ({
  slot,
  layerCount: 10,
  layerModes: LAYER_MODES,
  ...extra,
})

const pressable = BOARD_BLOCKS.flat(2).filter((cell): cell is Pressable => cell.kind !== 'gap')
const keyCell = (code: number) => pressable.find((cell) => cell.kind === 'key' && cell.code === code)!
const shorts = (row: readonly BoardCell[]) =>
  row.filter((cell): cell is Pressable => cell.kind !== 'gap').map((cell) => labelOf(boardAction(cell, [])).short)

test('図は US 配列の並びで、右に Ins / Del などと矢印のかたまりを持つ', () => {
  expect(BOARD_MAIN.map((row) => shorts(row).join(' '))).toEqual([
    'Esc F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12',
    '` 1 2 3 4 5 6 7 8 9 0 - = BS',
    'Tab Q W E R T Y U I O P [ ] \\',
    "Caps A S D F G H J K L ; ' Enter",
    'Shift Z X C V B N M , . / Shift',
    'Ctrl GUI Alt 英数 Space かな Alt GUI Ctrl',
  ])
  expect(BOARD_NAVIGATION.map((row) => shorts(row).join(' '))).toEqual(['', 'Ins Home PgUp', 'Del End PgDn', '', '↑', '← ↓ →'])
})

test('文字の行は、どれもキー 15 個ぶんの幅で、行ごとにずれて並ぶ', () => {
  const width = (row: readonly BoardCell[]) => row.reduce((sum, cell) => sum + cell.width, 0)
  expect(BOARD_MAIN.map(width)).toEqual([15, 15, 15, 15, 15, 15])
  // Tab、Caps、Shift の幅のぶんだけ、下の行ほど右にずれる
  expect(BOARD_MAIN.slice(1, 5).map((row) => row[0].width)).toEqual([1, 1.5, 1.75, 2.25])
  // キー1つぶんは 44px で、すき間が 4px
  expect(cellWidth({ kind: 'key', code: 0x04, width: 1 })).toBe(40)
  expect(cellWidth({ kind: 'key', code: 0x2c, width: 5 })).toBe(216)
  expect(cellWidth({ kind: 'gap', width: 0.5 })).toBe(22)
})

test('図のキーは、どの欄にも入れられる候補で、同じキーを2つ持たない', () => {
  const offered = new Set(candidates(context('tap')).map(({ action }) => actionId(action)))
  const ids = pressable.map((cell) => actionId(boardAction(cell, [])))
  for (const id of ids) expect(offered).toContain(id)
  expect(new Set(ids).size).toBe(ids.length)
  // 左右の修飾キー 8 つを、すべて持つ
  expect(pressable.filter((cell) => cell.kind === 'mod')).toHaveLength(8)
})

test('修飾キーを選ばずに押すと、そのキーだけの動作になる', () => {
  expect(boardAction(keyCell(0x06), [])).toEqual({ kind: 'key', code: 0x06, mods: [] })
  expect(boardFace(keyCell(0x06), [], 'us')).toEqual({ text: 'C', shifted: undefined })
  // 数字と記号のキーは、Shift で出る字を左上に添える
  expect(boardFace(keyCell(0x1e), [], 'us')).toEqual({ text: '1', shifted: '!' })
  expect(boardFace(keyCell(0x33), [], 'us')).toEqual({ text: ';', shifted: ':' })
})

test('「一緒に押す修飾キー」を選んで押すと、左側の修飾キーを付けたショートカットになる', () => {
  const copy = boardAction(keyCell(0x06), ['ctrl'])
  expect(labelOf(copy).full).toBe('Ctrl + C')
  expect(actionToKeycode(copy)).toBe(0x0106)
  // 選んだ順によらず、Ctrl、Shift、Alt、GUI の順に並べる
  const many = boardAction(keyCell(0x2b), ['gui', 'shift', 'ctrl'])
  expect(labelOf(many).full).toBe('Ctrl + Shift + GUI + Tab')
  expect(actionToKeycode(many)).toBe(0x0b2b)
  // キーの上の字は変えず、Shift で出る字も添えない
  expect(boardFace(keyCell(0x1e), ['ctrl'], 'us')).toEqual({ text: '1' })
  expect(boardFace(keyCell(0x1e), ['ctrl', 'shift'], 'us')).toEqual({ text: '1' })
})

test('Shift だけを選んで数字と記号を押すと、Shift で出る記号になる', () => {
  const bang = boardAction(keyCell(0x1e), ['shift'])
  expect(labelOf(bang)).toMatchObject({ short: '!', full: '!（Shift + 1）' })
  expect(actionToKeycode(bang)).toBe(0x021e)
  expect(boardFace(keyCell(0x1e), ['shift'], 'us')).toEqual({ text: '!' })
  // Shift で字が変わらないキーは、そのまま
  expect(boardFace(keyCell(0x28), ['shift'], 'us')).toEqual({ text: 'Enter' })
})

test('刻印が JIS の時は、図の字と Shift で出る字が JIS 配列になる', () => {
  expect(boardFace(keyCell(0x1f), [], 'jis')).toEqual({ text: '2', shifted: '"' })
  expect(boardFace(keyCell(0x1f), ['shift'], 'jis')).toEqual({ text: '"' })
  expect(boardFace(keyCell(0x35), [], 'jis')).toEqual({ text: '半/全', shifted: undefined })
  // 入る動作は、刻印によらない
  expect(actionToKeycode(boardAction(keyCell(0x1f), ['shift']))).toBe(0x021f)
})

test('修飾キーそのものは、「一緒に押す修飾キー」を選んでいても単体で入る', () => {
  const [leftShift, rightShift] = pressable.filter((cell) => cell.kind === 'mod' && cell.mod.kind === 'shift')
  expect(boardAction(leftShift, ['ctrl', 'alt'])).toEqual({ kind: 'key', mods: [{ kind: 'shift', side: 'left' }] })
  expect(labelOf(boardAction(leftShift, [])).full).toBe('左 Shift')
  expect(labelOf(boardAction(rightShift, [])).full).toBe('右 Shift')
  expect(actionToKeycode(boardAction(rightShift, ['ctrl']))).toBe(0x00e5)
  expect(boardFace(rightShift, ['shift'], 'us')).toEqual({ text: 'Shift' })
})

test('同じ動作かは、修飾キーの並び順によらずに比べる', () => {
  const a: Action = { kind: 'key', code: 0x06, mods: [{ kind: 'ctrl', side: 'left' }, { kind: 'shift', side: 'left' }] }
  const b: Action = { kind: 'key', code: 0x06, mods: [{ kind: 'shift', side: 'left' }, { kind: 'ctrl', side: 'left' }] }
  expect(isCurrent(a, b)).toBe(true)
  expect(isCurrent(a, { kind: 'key', code: 0x06, mods: [{ kind: 'ctrl', side: 'left' }] })).toBe(false)
  expect(isCurrent(a, { ...a, mods: [{ kind: 'ctrl', side: 'right' }, { kind: 'shift', side: 'left' }] })).toBe(false)
  // 修飾キーだけの動作と、キーの動作を取り違えない
  expect(isCurrent({ kind: 'key', mods: [{ kind: 'shift', side: 'left' }] }, { kind: 'key', code: 0, mods: [{ kind: 'shift', side: 'left' }] })).toBe(false)
  expect(isCurrent({ kind: 'layer', mode: 'toggle', layer: 1 }, { kind: 'layer', mode: 'toggle', layer: 1 })).toBe(true)
  expect(isCurrent({ kind: 'layer', mode: 'toggle', layer: 1 }, { kind: 'layer', mode: 'to', layer: 1 })).toBe(false)
  // 何も入っていない欄は、どれとも同じでない
  expect(isCurrent(undefined, { kind: 'none' })).toBe(false)
})

test('「押している間だけ」は長押しの欄とタップ後長押しの欄にだけ、ほかの3つはそれ以外の欄に出す', () => {
  for (const slot of ['hold', 'tapHold'] as const) expect(layerChoices(context(slot)).modes).toEqual(['momentary'])
  for (const slot of ['tap', 'doubleTap', 'encoder', 'combo'] as const) {
    expect(layerChoices(context(slot)).modes).toEqual(['toggle', 'to', 'oneShot'])
  }
})

test('存在しないレイヤーと、使えない方式は、選択肢に出さない', () => {
  expect(layerChoices(context('tap', { layerCount: 4 })).layers).toEqual([0, 1, 2, 3])
  expect(layerChoices(context('tap', { layerModes: ['momentary', 'oneShot'] })).modes).toEqual(['oneShot'])
  expect(layerChoices(context('hold', { layerModes: ['toggle', 'to', 'oneShot'] }))).toEqual({ modes: [], layers: [] })
  expect(layerChoices(context('tap', { layerCount: 0 }))).toEqual({ modes: [], layers: [] })
})

const ctrl = { kind: 'ctrl', side: 'left' } as const
const shift = { kind: 'shift', side: 'left' } as const
const toggle1: Action = { kind: 'layer', mode: 'toggle', layer: 1 }

test('最初に開く分類は、いま入っている動作の分類にする', () => {
  expect(startCategory(undefined, context('tap'))).toBe('keyboard')
  expect(startCategory({ kind: 'key', code: 0x04, mods: [] }, context('tap'))).toBe('keyboard')
  expect(startCategory(toggle1, context('tap'))).toBe('layer')
  expect(startCategory({ kind: 'layer', mode: 'momentary', layer: 2 }, context('hold'))).toBe('layer')
  // 音量、マウス、テンキーは「メディア・その他」
  for (const code of [0xa9, 0xd9, 0x59]) expect(startCategory({ kind: 'key', code, mods: [] }, context('tap'))).toBe('other')
  // ショートカット、Shift で出る記号、修飾キーだけの動作は「キーボード」
  expect(startCategory({ kind: 'key', code: 0x06, mods: [ctrl] }, context('tap'))).toBe('keyboard')
  expect(startCategory({ kind: 'key', code: 0x1e, mods: [shift] }, context('tap'))).toBe('keyboard')
  expect(startCategory({ kind: 'key', mods: [ctrl, shift] }, context('hold'))).toBe('keyboard')
  // 修飾キーを付けたメディアのキーは、キーの分類にする
  expect(startCategory({ kind: 'key', code: 0xa9, mods: [ctrl] }, context('tap'))).toBe('other')
  // 選択肢にない動作（透過、何もしない、編集不可、選択肢に出さないキー）は「キーボード」
  expect(startCategory({ kind: 'transparent' }, context('tap'))).toBe('keyboard')
  expect(startCategory({ kind: 'none' }, context('tap'))).toBe('keyboard')
  expect(startCategory({ kind: 'unsupported', raw: 0x7e00, label: 'BT0' }, context('tap'))).toBe('keyboard')
  expect(startCategory({ kind: 'key', code: 0xb2, mods: [] }, context('tap'))).toBe('keyboard')
})

test('「一緒に押す修飾キー」は、いま入っているショートカットや記号の修飾キーから始める', () => {
  expect(startTogether(undefined)).toEqual([])
  expect(startTogether({ kind: 'key', code: 0x04, mods: [] })).toEqual([])
  expect(startTogether({ kind: 'key', code: 0x06, mods: [ctrl] })).toEqual(['ctrl'])
  expect(startTogether({ kind: 'key', code: 0x1e, mods: [shift] })).toEqual(['shift'])
  // 並び順は、Ctrl、Shift、Alt、GUI の順にそろえる
  expect(startTogether({ kind: 'key', code: 0x2b, mods: [{ kind: 'gui', side: 'left' }, shift, ctrl] })).toEqual(['ctrl', 'shift', 'gui'])
  // 修飾キーだけの動作は、図の修飾キーそのものが選択中に見えるので、何も選ばない
  expect(startTogether({ kind: 'key', mods: [ctrl, shift] })).toEqual([])
  // 右側の修飾キーの組は図から作れないので、何も選ばない
  expect(startTogether({ kind: 'key', code: 0x06, mods: [{ kind: 'ctrl', side: 'right' }] })).toEqual([])
  expect(startTogether(toggle1)).toEqual([])
})

test('復元した修飾キーで図を出すと、いま入っている動作のキーが、同じ動作として当たる', () => {
  const currents: Action[] = [
    { kind: 'key', code: 0x06, mods: [ctrl] },
    { kind: 'key', code: 0x1e, mods: [shift] },
    { kind: 'key', code: 0x2b, mods: [{ kind: 'gui', side: 'left' }, shift, ctrl] },
    { kind: 'key', code: 0x04, mods: [] },
    { kind: 'key', mods: [{ kind: 'alt', side: 'right' }] },
  ]
  for (const current of currents) {
    const hits = pressable.filter((cell) => isCurrent(current, boardAction(cell, startTogether(current))))
    expect(hits).toHaveLength(1)
  }
})

test('切り替え方は、いま入っている切り替え方から始め、この欄で選べない時は最初のものにする', () => {
  const tapModes = layerChoices(context('tap')).modes
  expect(startLayerMode({ kind: 'layer', mode: 'oneShot', layer: 1 }, tapModes)).toBe('oneShot')
  expect(startLayerMode(undefined, tapModes)).toBe('toggle')
  expect(startLayerMode({ kind: 'key', code: 0x04, mods: [] }, tapModes)).toBe('toggle')
  expect(startLayerMode({ kind: 'layer', mode: 'oneShot', layer: 1 }, layerChoices(context('hold')).modes)).toBe('momentary')
  expect(startLayerMode(toggle1, [])).toBeUndefined()
})

test('利用者が切り替えた分類や修飾キーは、欄か、いま入っている動作が変わった時に捨てる', () => {
  const copy: Action = { kind: 'key', code: 0x06, mods: [ctrl] }
  expect(pickerStartId('tap', copy)).not.toBe(pickerStartId('doubleTap', copy))
  expect(pickerStartId('tap', copy)).not.toBe(pickerStartId('tap', { ...copy, code: 0x19 }))
  expect(pickerStartId('tap', copy)).not.toBe(pickerStartId('tap', { ...copy, mods: [] }))
  expect(pickerStartId('tap', toggle1)).not.toBe(pickerStartId('tap', { ...toggle1, layer: 2 }))
  expect(pickerStartId('tap', copy)).not.toBe(pickerStartId('tap', undefined))
  // 同じ欄の同じ動作なら、作り直した値でも変わらない（切り替えた分類などを保つ）
  expect(pickerStartId('tap', copy)).toBe(pickerStartId('tap', { kind: 'key', code: 0x06, mods: [{ ...ctrl }] }))
  expect(pickerStartId('tap', undefined)).toBe(pickerStartId('tap', undefined))
})
