import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import vilText from '../device/fixtures/cornix/cornix.vil?raw'
import { candidates, KEY_CODES, labelOf, LAYER_MODES, type Action, type Mod } from './action.ts'
import { actionToKeycode, customKeycodesOf, keycodeToAction, modsFromBits, modsToBits } from './keycodes.ts'

// JSON の型では、エンコーダーとコンボのキーが、決まった長さの組にならない
const snapshot = recorded.snapshot as unknown as KeyboardSnapshot
const custom = customKeycodesOf(snapshot.layout)

const left = (...kinds: Mod['kind'][]): Mod[] => kinds.map((kind) => ({ kind, side: 'left' }))
const right = (...kinds: Mod['kind'][]): Mod[] => kinds.map((kind) => ({ kind, side: 'right' }))

test('すべてのキーコード（0x0000〜0xFFFF）で、数値 → Action → 数値 が元に戻る', () => {
  let supported = 0
  for (let keycode = 0; keycode <= 0xffff; keycode++) {
    const action = keycodeToAction(keycode)
    if (action.kind === 'unsupported') expect(action.raw).toBe(keycode)
    else supported++
    if (actionToKeycode(action) !== keycode) expect.fail(`0x${keycode.toString(16)} が元に戻らない`)
  }
  // 「何もしない」と透過、基本キー、修飾キー 8 つ、修飾キー付きのキー（左右 × 15 通り）、修飾キー 2 つ以上だけ（左右 × 11 通り）、レイヤー切り替え
  expect(supported).toBe(2 + KEY_CODES.length + 8 + KEY_CODES.length * 30 + 22 + 4 * 32)
})

test('動作を選ぶ部品に出す候補は、すべてキーコードに直せて、Action に戻る', () => {
  for (const slot of ['tap', 'hold', 'doubleTap', 'tapHold', 'encoder', 'combo'] as const) {
    for (const { action } of candidates({ slot, layerCount: 32, layerModes: LAYER_MODES })) {
      const keycode = actionToKeycode(action)
      expect(keycode, labelOf(action).full).toBeDefined()
      expect(keycodeToAction(keycode!)).toEqual(action)
    }
  }
})

test('実機で確かめた種類のキーコードを、動作に直す', () => {
  expect(keycodeToAction(0x0000)).toEqual({ kind: 'none' })
  expect(keycodeToAction(0x0001)).toEqual({ kind: 'transparent' })
  expect(keycodeToAction(0x0004)).toEqual({ kind: 'key', code: 0x04, mods: [] })
  expect(keycodeToAction(0x00a8)).toEqual({ kind: 'key', code: 0xa8, mods: [] })
  expect(keycodeToAction(0x00d9)).toEqual({ kind: 'key', code: 0xd9, mods: [] })
  // 修飾キーだけの動作は、code を持たない
  expect(keycodeToAction(0x00e0)).toEqual({ kind: 'key', mods: left('ctrl') })
  expect(keycodeToAction(0x00e7)).toEqual({ kind: 'key', mods: right('gui') })
  // 修飾キー付きのキー（左 Shift 0x02xx、左 GUI 0x08xx、右 Ctrl 0x11xx、右 GUI 0x18xx）
  expect(keycodeToAction(0x0233)).toEqual({ kind: 'key', code: 0x33, mods: left('shift') })
  expect(keycodeToAction(0x0820)).toEqual({ kind: 'key', code: 0x20, mods: left('gui') })
  expect(keycodeToAction(0x1109)).toEqual({ kind: 'key', code: 0x09, mods: right('ctrl') })
  expect(keycodeToAction(0x1828)).toEqual({ kind: 'key', code: 0x28, mods: right('gui') })
  expect(keycodeToAction(0x0506)).toEqual({ kind: 'key', code: 0x06, mods: left('ctrl', 'alt') })
  // レイヤー切り替え（TO 0x5200、MO 0x5220、TG 0x5260、OSL 0x5280 + レイヤー）
  expect(keycodeToAction(0x5203)).toEqual({ kind: 'layer', mode: 'to', layer: 3 })
  expect(keycodeToAction(0x5222)).toEqual({ kind: 'layer', mode: 'momentary', layer: 2 })
  expect(keycodeToAction(0x5261)).toEqual({ kind: 'layer', mode: 'toggle', layer: 1 })
  expect(keycodeToAction(0x5281)).toEqual({ kind: 'layer', mode: 'oneShot', layer: 1 })
})

test('修飾キーだけの動作は、1つなら修飾キーのキーコード、2つ以上ならキーの部分が 0 の形にする', () => {
  expect(actionToKeycode({ kind: 'key', mods: left('shift') })).toBe(0x00e1)
  expect(actionToKeycode({ kind: 'key', mods: right('alt') })).toBe(0x00e6)
  expect(actionToKeycode({ kind: 'key', mods: left('ctrl', 'shift') })).toBe(0x0300)
  expect(actionToKeycode({ kind: 'key', mods: right('ctrl', 'shift', 'alt', 'gui') })).toBe(0x1f00)
  expect(keycodeToAction(0x0300)).toEqual({ kind: 'key', mods: left('ctrl', 'shift') })
  // 修飾キーの順が違っても、同じキーコードになる
  expect(actionToKeycode({ kind: 'key', code: 0x06, mods: left('alt', 'ctrl') })).toBe(0x0506)
})

test('同じ動作を表す別の形のキーコードは、unsupported として元の値を保つ', () => {
  // 修飾キー1つだけで、キーの部分が 0（0x00E0 と同じ動作）
  expect(keycodeToAction(0x0100)).toEqual({ kind: 'unsupported', raw: 0x0100, label: '0x0100' })
  // 修飾キーに修飾キーを重ねた形（LCTL(KC_LSHIFT)）
  expect(keycodeToAction(0x01e1)).toMatchObject({ kind: 'unsupported', raw: 0x01e1 })
  // 修飾の種類がなく、右側の印だけ
  expect(keycodeToAction(0x1004)).toMatchObject({ kind: 'unsupported', raw: 0x1004 })
})

test('対象外の機能は、名前を付けた unsupported になる', () => {
  expect(keycodeToAction(0x2204)).toEqual({ kind: 'unsupported', raw: 0x2204, label: '0x2204' }) // MT
  expect(keycodeToAction(0x4104)).toEqual({ kind: 'unsupported', raw: 0x4104, label: '0x4104' }) // LT
  expect(keycodeToAction(0x5241)).toEqual({ kind: 'unsupported', raw: 0x5241, label: 'DF(1)' })
  expect(keycodeToAction(0x52c1)).toEqual({ kind: 'unsupported', raw: 0x52c1, label: 'TT(1)' })
  expect(keycodeToAction(0x5703)).toEqual({ kind: 'unsupported', raw: 0x5703, label: 'Tap Dance 3' })
  expect(keycodeToAction(0x7702)).toEqual({ kind: 'unsupported', raw: 0x7702, label: 'マクロ 2' })
  // 独自のキーは、レイアウト定義の名前を使う。定義になければ Vial と同じ USERnn
  expect(keycodeToAction(0x7e07, custom)).toEqual({ kind: 'unsupported', raw: 0x7e07, label: 'CLR_PEER' })
  expect(keycodeToAction(0x7e07)).toEqual({ kind: 'unsupported', raw: 0x7e07, label: 'USER07' })
  expect(keycodeToAction(0x7e08, custom)).toEqual({ kind: 'unsupported', raw: 0x7e08, label: 'USER08' })
  // 表にない基本キー
  expect(keycodeToAction(0x0003)).toMatchObject({ kind: 'unsupported', raw: 0x0003 })
  expect(keycodeToAction(0x00c5)).toMatchObject({ kind: 'unsupported', raw: 0x00c5 })
})

test('キーコード1つで表せない動作は、undefined になる', () => {
  const mixed: Mod[] = [...left('ctrl'), ...right('shift')]
  expect(actionToKeycode({ kind: 'key', code: 0x04, mods: mixed })).toBeUndefined()
  expect(actionToKeycode({ kind: 'key', mods: mixed })).toBeUndefined()
  expect(actionToKeycode({ kind: 'key', mods: left('ctrl', 'ctrl') })).toBeUndefined()
  expect(actionToKeycode({ kind: 'key', mods: [] })).toBeUndefined()
  // code に修飾キーや、表にない番号は入れられない
  expect(actionToKeycode({ kind: 'key', code: 0xe1, mods: left('ctrl') })).toBeUndefined()
  expect(actionToKeycode({ kind: 'key', code: 0x03, mods: [] })).toBeUndefined()
  expect(actionToKeycode({ kind: 'layer', mode: 'momentary', layer: 32 })).toBeUndefined()
  expect(actionToKeycode({ kind: 'layer', mode: 'to', layer: -1 })).toBeUndefined()
  expect(actionToKeycode({ kind: 'layer', mode: 'to', layer: 1.5 })).toBeUndefined()
})

test('修飾のビットと修飾キーの組を、相互に直す', () => {
  for (let bits = 0; bits < 0x20; bits++) {
    // 修飾の種類がなければ、左右の区別もない
    expect(modsToBits(modsFromBits(bits))).toBe(bits & 0x0f ? bits : 0)
  }
  expect(modsFromBits(0x16)).toEqual(right('shift', 'alt'))
})

test('レイアウト定義の形が違っても、独自のキーの取り出しで落ちない', () => {
  const layout = (raw: unknown) => ({ ...snapshot.layout, raw })
  expect(custom.map((entry) => entry.name)).toEqual(['BT0', 'BT1', 'BT2', 'NEXT_BT', 'PREV_BT', 'CLR_BT', 'SWITCH', 'CLR_PEER'])
  expect(customKeycodesOf(layout(null))).toEqual([])
  expect(customKeycodesOf(layout({ customKeycodes: 'x' }))).toEqual([])
  expect(customKeycodesOf(layout({ customKeycodes: [null, { name: 1 }, { name: 'A' }] }))).toEqual([{}, {}, { name: 'A' }])
})

// ---- 実機（Cornix LP）から取ったキーマップ ----

/** スナップショットに含まれるキーコードと、同じ時に Vial で保存した .vil の名前の組 */
function recordedKeycodes(): { keycode: number; name: string }[] {
  // uid は JavaScript の数値では正確に表せないが、ここでは使わない
  const vil = JSON.parse(vilText) as {
    layout: (string | number)[][][]
    encoder_layout: string[][][]
    tap_dance: (string | number)[][]
    combo: string[][]
  }
  // .vil では、キーのない位置が -1（本体から読んだ値では 0）
  const name = (value: string | number) => (value === -1 ? 'KC_NO' : String(value))
  const pairs = (keycodes: number[], names: (string | number)[]) => {
    expect(names).toHaveLength(keycodes.length)
    return keycodes.map((keycode, i) => ({ keycode, name: name(names[i]) }))
  }
  return [
    ...pairs(snapshot.keymap.flat(), vil.layout.flat(2)),
    ...pairs(snapshot.encoders.flat(2), vil.encoder_layout.flat(2)),
    ...pairs(
      snapshot.tapDances.flatMap((entry) => [entry.onTap, entry.onHold, entry.onDoubleTap, entry.onTapHold]),
      vil.tap_dance.flatMap((entry) => entry.slice(0, 4)),
    ),
    ...pairs(
      snapshot.combos.flatMap((entry) => [...entry.keys, entry.output]),
      vil.combo.flat(),
    ),
  ]
}

const MOD_NAMES: Record<string, Mod> = {
  LCTL: { kind: 'ctrl', side: 'left' },
  LSFT: { kind: 'shift', side: 'left' },
  LGUI: { kind: 'gui', side: 'left' },
  RCTL: { kind: 'ctrl', side: 'right' },
  RGUI: { kind: 'gui', side: 'right' },
  KC_LCTRL: { kind: 'ctrl', side: 'left' },
  KC_LSHIFT: { kind: 'shift', side: 'left' },
  KC_LALT: { kind: 'alt', side: 'left' },
  KC_LGUI: { kind: 'gui', side: 'left' },
  KC_RSHIFT: { kind: 'shift', side: 'right' },
  KC_RGUI: { kind: 'gui', side: 'right' },
}

/** .vil の名前から分かる、動作の形（キーの番号は見ない） */
function expectedShape(name: string): Partial<Action> {
  if (name === 'KC_NO') return { kind: 'none' }
  if (MOD_NAMES[name]) return { kind: 'key', mods: [MOD_NAMES[name]] }
  if (/^KC_\w+$/.test(name)) return { kind: 'key', mods: [] }
  const call = /^(\w+)\((\w+)\)$/.exec(name)
  if (call?.[1] === 'MO') return { kind: 'layer', mode: 'momentary', layer: Number(call[2]) }
  if (call?.[1] === 'OSL') return { kind: 'layer', mode: 'oneShot', layer: Number(call[2]) }
  if (call?.[1] === 'TD' || /^USER\d\d$/.test(name)) return { kind: 'unsupported' }
  if (call && MOD_NAMES[call[1]]) return { kind: 'key', mods: [MOD_NAMES[call[1]]] }
  throw new Error(`テストが知らない名前: ${name}`)
}

test('実機から取ったキーマップのキーコードは、すべて .vil の名前どおりの動作に直り、キーコードに戻る', () => {
  const all = recordedKeycodes()
  // キーマップ 10 × 56、エンコーダー 10 × 2 × 2、Tap Dance 32 × 4、コンボ 32 × 5
  expect(all).toHaveLength(560 + 40 + 128 + 160)

  for (const { keycode, name } of all) {
    const action = keycodeToAction(keycode, custom)
    expect(action, name).toMatchObject(expectedShape(name))
    expect(actionToKeycode(action), name).toBe(keycode)
    if (action.kind === 'key' && action.code !== undefined) expect(action.code, name).toBe(keycode & 0xff)
  }
})

test('実機のキーマップで unsupported になるのは、Tap Dance と独自のキーだけで、元の値を保つ', () => {
  const unsupported = new Map<number, string>()
  for (const { keycode } of recordedKeycodes()) {
    const action = keycodeToAction(keycode, custom)
    if (action.kind === 'unsupported') {
      expect(action.raw).toBe(keycode)
      unsupported.set(keycode, action.label)
    }
  }
  expect([...unsupported].sort(([a], [b]) => a - b)).toEqual([
    [0x5700, 'Tap Dance 0'],
    [0x5701, 'Tap Dance 1'],
    [0x7e00, 'BT0'],
    [0x7e01, 'BT1'],
    [0x7e02, 'BT2'],
    [0x7e07, 'CLR_PEER'],
  ])
})

test('実機のキーマップにある動作は、どれも 16 進の表記ではない名前で表示できる', () => {
  for (const { keycode, name } of recordedKeycodes()) {
    const label = labelOf(keycodeToAction(keycode, custom))
    expect(label.full, name).not.toMatch(/0x/)
    expect(label.short, name).not.toMatch(/0x/)
  }
})
