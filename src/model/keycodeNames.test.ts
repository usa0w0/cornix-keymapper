import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import vilText from '../device/fixtures/cornix/cornix.vil?raw'
import { candidates, KEY_CODES, labelOf, LAYER_MODES, type Mod } from './action.ts'
import { encodeBehavior } from './encode.ts'
import { keycodeToName, nameToKeycode } from './keycodeNames.ts'
import { actionToKeycode } from './keycodes.ts'

// JSON の型では、エンコーダーとコンボのキーが、決まった長さの組にならない
const snapshot = recorded.snapshot as unknown as KeyboardSnapshot

test('すべてのキーコード（0x0000〜0xFFFF）で、数値 → 名前 → 数値 が元に戻る', () => {
  const seen = new Map<string, number>()
  for (let keycode = 0; keycode <= 0xffff; keycode++) {
    const name = keycodeToName(keycode)
    if (nameToKeycode(name) !== keycode) expect.fail(`0x${keycode.toString(16)}（${name}）が元に戻らない`)
    // 同じ名前を、2つの数値に付けていない
    if (seen.has(name)) expect.fail(`${name} が 0x${seen.get(name)!.toString(16)} と 0x${keycode.toString(16)} の両方に付いている`)
    seen.set(name, keycode)
  }
})

test('実物の .vil に出る名前は、すべて、同じ時に本体から読んだ数値に当たり、その数値から同じ名前に戻る', () => {
  const vil = JSON.parse(vilText) as {
    layout: (string | number)[][][]
    encoder_layout: string[][][]
    tap_dance: (string | number)[][]
    combo: string[][]
  }
  const pairs: [string | number, number][] = []
  vil.layout.forEach((layer, i) => layer.flat().forEach((name, key) => pairs.push([name, snapshot.keymap[i][key]])))
  vil.encoder_layout.forEach((layer, i) => layer.flat().forEach((name, n) => pairs.push([name, snapshot.encoders[i].flat()[n]])))
  vil.tap_dance.forEach((entry, i) => {
    const { onTap, onHold, onDoubleTap, onTapHold } = snapshot.tapDances[i]
    ;[onTap, onHold, onDoubleTap, onTapHold].forEach((keycode, n) => pairs.push([entry[n], keycode]))
  })
  vil.combo.forEach((entry, i) => {
    ;[...snapshot.combos[i].keys, snapshot.combos[i].output].forEach((keycode, n) => pairs.push([entry[n], keycode]))
  })

  const names = new Set<string>()
  for (const [name, keycode] of pairs) {
    // キーのない位置（-1）は、名前ではない
    if (typeof name !== 'string') continue
    names.add(name)
    expect(nameToKeycode(name), name).toBe(keycode)
    expect(keycodeToName(keycode), name).toBe(name)
  }
  // 実物に出る名前の形: QMK の古い名前、レイヤー切り替え、Tap Dance、修飾キー付きのキー、独自のキー、マウス
  for (const name of ['KC_BSPACE', 'KC_LCTRL', 'KC_LANG1', 'MO(2)', 'OSL(1)', 'TD(0)', 'LSFT(KC_COMMA)', 'RCTL(KC_F)', 'USER00', 'KC_WH_U']) {
    expect(names, name).toContain(name)
  }
  expect(names.size).toBe(102)
})

test('Vial が書く名前の形にする', () => {
  const cases: [number, string][] = [
    [0x0000, 'KC_NO'],
    [0x0001, 'KC_TRNS'],
    [0x002a, 'KC_BSPACE'],
    [0x0059, 'KC_KP_1'],
    [0x0062, 'KC_KP_0'],
    [0x00a9, 'KC_VOLU'],
    [0x00d1, 'KC_BTN1'],
    [0x00e0, 'KC_LCTRL'],
    [0x00e7, 'KC_RGUI'],
    // 修飾キー付きのキー
    [0x0204, 'LSFT(KC_A)'],
    [0x0304, 'C_S(KC_A)'],
    [0x0a04, 'SGUI(KC_A)'],
    [0x1104, 'RCTL(KC_A)'],
    // 修飾キー2つ以上だけ（キーの部分が 0）
    [0x0300, 'C_S(KC_NO)'],
    [0x0700, 'MEH(KC_NO)'],
    // レイヤー切り替え
    [0x5203, 'TO(3)'],
    [0x5222, 'MO(2)'],
    [0x5241, 'DF(1)'],
    [0x5261, 'TG(1)'],
    [0x5281, 'OSL(1)'],
    [0x52c1, 'TT(1)'],
    // タップと長押し
    [0x2204, 'LSFT_T(KC_A)'],
    [0x2819, 'LGUI_T(KC_V)'],
    [0x3104, 'RCTL_T(KC_A)'],
    [0x422c, 'LT2(KC_SPACE)'],
    [0x4f04, 'LT15(KC_A)'],
    // そのほか
    [0x52a2, 'OSM(MOD_LSFT)'],
    [0x5705, 'TD(5)'],
    [0x7703, 'M3'],
    [0x7e07, 'USER07'],
  ]
  for (const [keycode, name] of cases) {
    expect(keycodeToName(keycode), name).toBe(name)
    expect(nameToKeycode(name), name).toBe(keycode)
  }
})

test('名前のない数値は、Vial と同じく 16 進の文字列にし、読む時も数値に戻す', () => {
  // 名前のない修飾の組（右 Ctrl + 右 Shift）、表にない基本キー、表にない範囲
  expect(keycodeToName(0x1304)).toBe('0x1304')
  expect(keycodeToName(0x3304)).toBe('0x3304')
  expect(keycodeToName(0x0066)).toBe('0x66')
  expect(keycodeToName(0x7c00)).toBe('0x7c00')
  expect(keycodeToName(0x52a7)).toBe('0x52a7')
  expect(nameToKeycode('0x1304')).toBe(0x1304)
  expect(nameToKeycode('0X7C00')).toBe(0x7c00)
  expect(nameToKeycode('31744')).toBe(0x7c00)
})

test('このサイトで作れるキーコードは、Vial の名前で書ける（修飾の組に名前がないものだけ 16 進）', () => {
  const hex = /^0x[0-9a-f]+$/
  // 欄が1つの動作: 動作を選ぶ部品の候補すべて
  for (const slot of ['tap', 'hold', 'encoder', 'combo'] as const) {
    for (const { action } of candidates({ slot, layerCount: 32, layerModes: LAYER_MODES })) {
      const keycode = actionToKeycode(action)!
      const mods = action.kind === 'key' ? action.mods : []
      const name = keycodeToName(keycode)
      expect(nameToKeycode(name)).toBe(keycode)
      // 修飾キーが1つまでの動作には、必ず名前がある
      if (mods.length <= 1) expect(name, labelOf(action).full).not.toMatch(hex)
    }
  }
  // タップと長押しの組（MT、LT）
  const mod = (kind: Mod['kind'], side: Mod['side'] = 'left'): Mod => ({ kind, side })
  for (const code of KEY_CODES) {
    const tap = { kind: 'key', code, mods: [] } as const
    for (const hold of [mod('ctrl'), mod('shift'), mod('alt'), mod('gui'), mod('ctrl', 'right'), mod('gui', 'right')]) {
      const encoded = encodeBehavior({ tap, hold: { kind: 'key', mods: [hold] } })
      if (encoded?.feature !== 'mt') expect.fail('MT にならない')
      expect(keycodeToName(encoded.keycode)).toMatch(/^[LR](CTL|SFT|ALT|GUI)_T\(KC_\w+\)$/)
    }
    const encoded = encodeBehavior({ tap, hold: { kind: 'layer', mode: 'momentary', layer: 3 } })
    if (encoded?.feature !== 'lt') expect.fail('LT にならない')
    expect(keycodeToName(encoded.keycode)).toMatch(/^LT3\(KC_\w+\)$/)
  }
})

test('QMK の新しい名前や、別の書き方も読める', () => {
  expect(nameToKeycode('KC_BSPC')).toBe(0x2a)
  expect(nameToKeycode('KC_LSFT')).toBe(0xe1)
  expect(nameToKeycode('KC_LNG1')).toBe(0x90)
  expect(nameToKeycode('KC_TRANSPARENT')).toBe(0x01)
  expect(nameToKeycode('LCS(KC_A)')).toBe(0x0304)
  expect(nameToKeycode('LT(2, KC_SPACE)')).toBe(0x422c)
  expect(nameToKeycode(' MO(2) ')).toBe(0x5222)
  expect(nameToKeycode('OSM(MOD_LCTL|MOD_LSFT)')).toBe(0x52a3)
  expect(nameToKeycode('OSM(MOD_MEH)')).toBe(0x52a7)
})

test('解釈できない名前は undefined にする（0 にしない）', () => {
  for (const name of [
    '',
    'KC_',
    'KC_UNKNOWN',
    'kc_a',
    'RESET',
    'MO(32)',
    'MO(-1)',
    'MO()',
    'TD(256)',
    'LT16(KC_A)',
    'LT2(MO(1))',
    'LSFT(LCTL(KC_A))',
    'LSFT(KC_A',
    'NOPE(KC_A)',
    'USER64',
    'M256',
    '0x10000',
    '65536',
    '-1',
    'OSM(MOD_LCTL|MOD_RSFT)',
    'OSM()',
  ]) {
    expect(nameToKeycode(name), name).toBeUndefined()
  }
})
