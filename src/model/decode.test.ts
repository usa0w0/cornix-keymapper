import { expect, test } from 'vitest'
import type { KeyboardSnapshot, TapDanceEntry } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import type { Action } from './action.ts'
import { filledSlots, isNone, isTransparent, isUnsupported } from './behavior.ts'
import { decodeKey } from './decode.ts'
import { customKeycodesOf } from './keycodes.ts'

// 実機（Cornix LP）から読んだ設定
const cornix = recorded.snapshot as unknown as KeyboardSnapshot

const key = (code: number): Action => ({ kind: 'key', code, mods: [] })
const momentary = (layer: number): Action => ({ kind: 'layer', mode: 'momentary', layer })
const KC_A = 0x04
const KC_ESC = 0x29
const KC_SPACE = 0x2c

const tapDance = (onTap: number, onHold = 0, onDoubleTap = 0, onTapHold = 0): TapDanceEntry => ({
  onTap,
  onHold,
  onDoubleTap,
  onTapHold,
  tappingTerm: 250,
})

test('ふつうのキーは、タップ欄だけになる', () => {
  expect(decodeKey(KC_A, [])).toEqual({ tap: key(KC_A) })
  // Ctrl + C、修飾キーだけ
  expect(decodeKey(0x0106, [])).toEqual({ tap: { kind: 'key', code: 0x06, mods: [{ kind: 'ctrl', side: 'left' }] } })
  expect(decodeKey(0x00e1, [])).toEqual({ tap: { kind: 'key', mods: [{ kind: 'shift', side: 'left' }] } })
})

test('「何もしない」と透過は、タップ欄に入る', () => {
  expect(decodeKey(0x0000, [])).toEqual({ tap: { kind: 'none' } })
  expect(decodeKey(0x0001, [])).toEqual({ tap: { kind: 'transparent' } })
  expect(isNone(decodeKey(0x0000, []))).toBe(true)
  expect(isTransparent(decodeKey(0x0001, []))).toBe(true)
  expect(isTransparent(decodeKey(KC_A, []))).toBe(false)
})

test('MO は、長押し欄の「押している間だけレイヤー N」になり、タップ欄は空', () => {
  const behavior = decodeKey(0x5222, [])
  expect(behavior).toEqual({ hold: momentary(2) })
  expect(filledSlots(behavior)).toEqual(['hold'])
})

test('TG・TO・OSL は、タップ欄のレイヤー切り替えになる', () => {
  expect(decodeKey(0x5263, [])).toEqual({ tap: { kind: 'layer', mode: 'toggle', layer: 3 } })
  expect(decodeKey(0x5201, [])).toEqual({ tap: { kind: 'layer', mode: 'to', layer: 1 } })
  expect(decodeKey(0x5281, [])).toEqual({ tap: { kind: 'layer', mode: 'oneShot', layer: 1 } })
})

test('LT は、タップ欄のキーと、長押し欄の「押している間だけレイヤー N」になる', () => {
  // LT(2, Space)、LT(15, A)
  expect(decodeKey(0x4000 + 2 * 256 + KC_SPACE, [])).toEqual({ tap: key(KC_SPACE), hold: momentary(2) })
  expect(decodeKey(0x4f04, [])).toEqual({ tap: key(KC_A), hold: momentary(15) })
  expect(decodeKey(0x4004, [])).toEqual({ tap: key(KC_A), hold: momentary(0) })
})

test('MT は、タップ欄のキーと、長押し欄の修飾キーになる', () => {
  // LSft_T(V)（実機で確かめた形）
  expect(decodeKey(0x2219, [])).toEqual({
    tap: key(0x19),
    hold: { kind: 'key', mods: [{ kind: 'shift', side: 'left' }] },
  })
  // 右の Ctrl + GUI を長押しに持つ A
  expect(decodeKey(0x2000 + 0x19 * 256 + KC_A, [])).toEqual({
    tap: key(KC_A),
    hold: { kind: 'key', mods: [{ kind: 'ctrl', side: 'right' }, { kind: 'gui', side: 'right' }] },
  })
})

test('タップ側が表にないキーの LT・MT と、修飾のない MT は、元の値を持った unsupported にする', () => {
  for (const keycode of [0x4200, 0x42e0, 0x2200, 0x22ff, 0x2004]) {
    const behavior = decodeKey(keycode, [])
    expect(behavior).toEqual({ tap: { kind: 'unsupported', raw: keycode, label: expect.any(String) } })
    expect(isUnsupported(behavior)).toBe(true)
  }
})

test('Tap Dance は、指している枠の4つの値を4欄に展開する', () => {
  const tapDances = [tapDance(KC_A), tapDance(KC_A, 0x00e0, KC_ESC, 0x5221)]
  expect(decodeKey(0x5701, tapDances)).toEqual({
    tap: key(KC_A),
    hold: { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] },
    doubleTap: key(KC_ESC),
    tapHold: momentary(1),
  })
  expect(filledSlots(decodeKey(0x5701, tapDances))).toEqual(['tap', 'hold', 'doubleTap', 'tapHold'])
})

test('Tap Dance の枠で値が 0 の欄は、空にする', () => {
  expect(decodeKey(0x5700, [tapDance(0, 0x5222)])).toEqual({ hold: momentary(2) })
  expect(decodeKey(0x5700, [tapDance(0, 0, KC_ESC)])).toEqual({ doubleTap: key(KC_ESC) })
  // 欄の値は、キーコード1つを動作1つに直す。タップ欄の TG はそのまま
  expect(decodeKey(0x5700, [tapDance(0x5261, 0, 0, KC_A)])).toEqual({
    tap: { kind: 'layer', mode: 'toggle', layer: 1 },
    tapHold: key(KC_A),
  })
})

test('4つとも空の枠を指す Tap Dance は、何もしないキーになる', () => {
  expect(decodeKey(0x5700, [tapDance(0)])).toEqual({ tap: { kind: 'none' } })
})

test('Tap Dance の枠に、このサイトで扱わない値があれば、その欄を unsupported にする', () => {
  // 長押しがマクロ 0、2回タップが MT、タップ後長押しが透過
  const behavior = decodeKey(0x5700, [tapDance(KC_A, 0x7700, 0x2219, 0x0001)])
  expect(behavior).toEqual({
    tap: key(KC_A),
    hold: { kind: 'unsupported', raw: 0x7700, label: 'マクロ 0' },
    doubleTap: { kind: 'unsupported', raw: 0x2219, label: '0x2219' },
    tapHold: { kind: 'unsupported', raw: 0x0001, label: '0x0001' },
  })
  expect(isUnsupported(behavior)).toBe(true)
  expect(isTransparent(decodeKey(0x5700, [tapDance(0x0001)]))).toBe(false)
})

test('本体にない枠を指す Tap Dance は、番号を持った unsupported にする', () => {
  expect(decodeKey(0x5702, [tapDance(KC_A)])).toEqual({ tap: { kind: 'unsupported', raw: 0x5702, label: 'Tap Dance 2' } })
})

test('対象外の機能のキーは、タップ欄の unsupported として元の値を保つ', () => {
  const custom = customKeycodesOf(cornix.layout)
  expect(decodeKey(0x7e00, [], custom)).toEqual({ tap: { kind: 'unsupported', raw: 0x7e00, label: 'BT0' } })
  expect(decodeKey(0x5241, [])).toEqual({ tap: { kind: 'unsupported', raw: 0x5241, label: 'DF(1)' } })
  expect(decodeKey(0x52c1, [])).toEqual({ tap: { kind: 'unsupported', raw: 0x52c1, label: 'TT(1)' } })
  expect(decodeKey(0x7703, [])).toEqual({ tap: { kind: 'unsupported', raw: 0x7703, label: 'マクロ 3' } })
})

test('実機の設定: レイヤー 0 の親指の Tap Dance とレイヤー切り替えが、同じ4欄の形になる', () => {
  const custom = customKeycodesOf(cornix.layout)
  const at = (layer: number, index: number) => decodeKey(cornix.keymap[layer][index], cornix.tapDances, custom)
  // 左の親指: MO(2)、Tap Dance 0（タップ Space ／ 長押し 左 GUI）
  expect(at(0, 24)).toEqual({ hold: momentary(2) })
  expect(at(0, 26)).toEqual({ tap: key(KC_SPACE), hold: { kind: 'key', mods: [{ kind: 'gui', side: 'left' }] } })
  // 右の親指: OSL(1)、Tap Dance 1（タップ B ／ 長押し 右 GUI）
  expect(at(0, 53)).toEqual({ tap: { kind: 'layer', mode: 'oneShot', layer: 1 } })
  expect(at(0, 54)).toEqual({ tap: key(0x05), hold: { kind: 'key', mods: [{ kind: 'gui', side: 'right' }] } })
})

test('実機の設定: 編集不可になるのは、独自のキーだけ', () => {
  const custom = customKeycodesOf(cornix.layout)
  const locked = new Set<number>()
  for (const layer of cornix.keymap) {
    for (const keycode of layer) {
      if (isUnsupported(decodeKey(keycode, cornix.tapDances, custom))) locked.add(keycode)
    }
  }
  expect(locked.size).toBeGreaterThan(0)
  for (const keycode of locked) expect(keycode & 0xff00).toBe(0x7e00)
})
