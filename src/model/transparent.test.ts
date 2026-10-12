import { expect, test } from 'vitest'
import { effectiveBelow, firstBelow } from './transparent.ts'

const KC_TRNS = 0x0001
const KC_A = 0x0004
const KC_B = 0x0005

/** レイヤー 0 から順に並べた、同じ場所のキーコード */
const column = (...keycodes: number[]) => (layer: number) => keycodes[layer]

test('1つ下のレイヤーが透過でなければ、その動作が効く', () => {
  expect(effectiveBelow(2, column(KC_A, KC_B, KC_TRNS))).toEqual({ layer: 1, keycode: KC_B })
})

test('下のレイヤーも透過なら、透過でないキーが見つかるまで下へたどる', () => {
  expect(effectiveBelow(3, column(KC_A, KC_TRNS, KC_TRNS, KC_TRNS))).toEqual({ layer: 0, keycode: KC_A })
})

test('途中に「何もしない」があれば、そこで止まる（何もしないが効く）', () => {
  expect(effectiveBelow(2, column(KC_A, 0x0000, KC_TRNS))).toEqual({ layer: 1, keycode: 0x0000 })
})

test('上のレイヤーと、そのレイヤー自身は見ない', () => {
  expect(effectiveBelow(1, column(KC_A, KC_B, KC_B))).toEqual({ layer: 0, keycode: KC_A })
})

test('レイヤー 0 まですべて透過なら、効く動作はない', () => {
  expect(effectiveBelow(2, column(KC_TRNS, KC_TRNS, KC_TRNS))).toBeUndefined()
  expect(effectiveBelow(0, column(KC_TRNS))).toBeUndefined()
})

test('本体から読んだ設定にないレイヤーは飛ばす', () => {
  expect(effectiveBelow(3, (layer) => (layer === 0 ? KC_A : undefined))).toEqual({ layer: 0, keycode: KC_A })
})

test('キーコード以外の値でも、同じたどり方ができる（編集を当てはめた後の動作など）', () => {
  const at = (layer: number) => ['a', undefined, '透過', '透過'][layer]
  expect(firstBelow(3, at, (value) => value === '透過')).toEqual({ layer: 0, value: 'a' })
  expect(firstBelow(0, at, (value) => value === '透過')).toBeUndefined()
})
