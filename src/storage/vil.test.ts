import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
// 実機（Cornix LP）の読み出しの記録（usb.json）と同じ時に、Vial で保存したもの。UID だけ、にせの値に置き換えてある
import realVil from '../device/fixtures/cornix/cornix.vil?raw'
import { definedKeys } from '../model/layout.ts'
import { countExtras, snapshotToVil, uidFromVil, uidToVil, vilToSnapshot, type VilFailure } from './vil.ts'

/** 実機から読んだ設定の写し */
const snapshotOf = () => structuredClone(recorded.snapshot) as unknown as KeyboardSnapshot

const device = snapshotOf()

/** 実物の .vil を、JSON として書き換えたもの。uid は数値の精度が落ちるので、元の文字のまま差し込み直す */
function alteredVil(change: (data: Record<string, unknown>) => void, uid = '17279655951921914625'): string {
  const data = JSON.parse(realVil) as Record<string, unknown>
  const hadUid = 'uid' in data
  data.uid = 0
  change(data)
  const text = JSON.stringify(data)
  return hadUid && data.uid === 0 ? text.replace('"uid":0', `"uid":${uid}`) : text
}

function failureOf(text: string, from: KeyboardSnapshot = device): VilFailure {
  const result = vilToSnapshot(text, from)
  if (result.ok) throw new Error('読み込めてしまった')
  return result.failure
}

function read(text: string, from: KeyboardSnapshot = device) {
  const result = vilToSnapshot(text, from)
  if (!result.ok) throw new Error(`読み込めない: ${JSON.stringify(result.failure)}`)
  return result
}

test('uid は、8 バイトを下位のバイトから並べた整数として、精度を落とさずに読み書きする', () => {
  expect(uidToVil('0123456789abcdef')).toBe('17279655951921914625')
  expect(uidFromVil('17279655951921914625')).toBe('0123456789abcdef')
  // JavaScript の数値では表せない、隣り合う値を区別する
  expect(uidFromVil('17279655951921914624')).toBe('0023456789abcdef')
  expect(uidToVil('ffffffffffffffff')).toBe('18446744073709551615')
  expect(uidFromVil('18446744073709551615')).toBe('ffffffffffffffff')
  expect(uidToVil('0000000000000000')).toBe('0')
  expect(uidFromVil('1')).toBe('0100000000000000')
  expect(uidToVil('0123456789ABCDEF')).toBe('17279655951921914625')
  // 8 バイトに収まらない値と、形が違うもの
  expect(uidFromVil('18446744073709551616')).toBeNull()
  expect(uidFromVil('-1')).toBeNull()
  expect(uidFromVil('1.5')).toBeNull()
  expect(uidToVil('other')).toBeNull()
  expect(uidToVil('0123456789abcde')).toBeNull()
})

test('実物の .vil を読むと、同じ時に本体から読んだスナップショットと一致する', () => {
  const { snapshot, extras } = read(realVil)
  expect(snapshot.keymap).toEqual(device.keymap)
  expect(snapshot.encoders).toEqual(device.encoders)
  expect(snapshot.tapDances).toEqual(device.tapDances)
  expect(snapshot.combos).toEqual(device.combos)
  // 機器の識別、レイアウト定義、枠数は、本体から読んだものを使う
  expect(snapshot).toEqual(device)
  // 実物には、QMK Settings が 9 項目ある。マクロは 32 枠とも空で、Key Override と Alt Repeat Key はない
  expect(extras).toEqual({ macros: 0, keyOverrides: 0, altRepeatKeys: 0, settings: 9 })
  expect(countExtras(extras)).toBe(9)
})

test('保存した文字列は、実物の .vil と同じ項目と形になる', () => {
  const saved = snapshotToVil(device)!
  // マクロより前（版、uid、キーマップ、エンコーダー、配列の選択肢）は、実物と1文字も違わない
  const head = realVil.indexOf('"macro"')
  expect(head).toBeGreaterThan(0)
  expect(saved.slice(0, head)).toBe(realVil.slice(0, head))
  // uid は、数値として、桁を落とさずに書く
  expect(saved).toContain('"uid": 17279655951921914625, ')

  const [ours, real] = [saved, realVil].map((text) => JSON.parse(text) as Record<string, unknown>)
  // 項目の名前と順
  expect(Object.keys(ours)).toEqual(Object.keys(real))
  // このサイトが扱う項目は、実物と同じ値（-1 の位置も含む）
  for (const name of ['version', 'layout', 'encoder_layout', 'layout_options', 'vial_protocol', 'via_protocol', 'tap_dance', 'combo']) {
    expect(ours[name], name).toEqual(real[name])
  }
  // 扱わない項目は、同じ型の空の値
  expect(ours.macro).toEqual([])
  expect(ours.key_override).toEqual([])
  expect(ours.alt_repeat_key).toEqual([])
  expect(ours.settings).toEqual({})
  expect(real.key_override).toEqual([])
  expect(real.alt_repeat_key).toEqual([])
  expect(Array.isArray(real.macro)).toBe(true)
  // Vial と同じ書き方（1行、区切りは ", " と ": "）
  expect(saved).not.toContain('\n')
  expect(saved.slice(saved.indexOf('"tap_dance"'), saved.indexOf('"key_override"'))).toBe(
    realVil.slice(realVil.indexOf('"tap_dance"'), realVil.indexOf('"key_override"')),
  )
})

test('-1 にするのは、レイアウト定義にキーがない位置だけ', () => {
  const saved = JSON.parse(snapshotToVil(device)!) as { layout: (string | number)[][][] }
  const defined = definedKeys(device.layout)
  // 行列は 8 行 7 列。キーは 50 個で、残りの 6 か所にはキーがない
  expect(defined.size).toBe(50)
  saved.layout.forEach((layer) =>
    layer.forEach((row, r) => row.forEach((value, c) => expect(value === -1, `${r},${c}`).toBe(!defined.has(r * 7 + c)))),
  )
})

test('保存 → 読込の往復で、内容が変わらない', () => {
  expect(read(snapshotToVil(device)!).snapshot).toEqual(device)
  expect(read(snapshotToVil(device)!).extras).toEqual({ macros: 0, keyOverrides: 0, altRepeatKeys: 0, settings: 0 })

  // このサイトで作れる種類と、名前のないキーコードを入れたもの
  const edited = snapshotOf()
  edited.keymap[1][0] = 0x2204 // LSFT_T(KC_A)
  edited.keymap[1][1] = 0x422c // LT2(KC_SPACE)
  edited.keymap[1][2] = 0x5261 // TG(1)
  edited.keymap[1][3] = 0x5203 // TO(3)
  edited.keymap[1][4] = 0x0300 // 左 Ctrl + Shift だけ
  edited.keymap[1][5] = 0x0001 // 透過
  edited.keymap[2][0] = 0x1304 // 名前のない修飾の組（16 進で書く）
  edited.keymap[2][1] = 0x7c00 // 表にないキーコード（16 進で書く）
  edited.keymap[2][2] = 0x7703 // マクロを呼ぶキー
  edited.keymap[2][3] = 0xffff
  edited.encoders[3][1] = [0x00a9, 0x5705]
  edited.tapDances[5] = { onTap: 0x04, onHold: 0x5222, onDoubleTap: 0x0204, onTapHold: 0x00e3, tappingTerm: 180 }
  edited.combos[0] = { keys: [0x14, 0x1a, 0x5700, 0], output: 0x0229 }
  edited.combos[31] = { keys: [0x04, 0x05, 0x06, 0x07], output: 0x5281 }
  const text = snapshotToVil(edited)!
  expect(text).toContain('"0x1304"')
  expect(read(text).snapshot).toEqual(edited)
  // もう一度保存しても、同じ文字列になる
  expect(snapshotToVil(read(text).snapshot)).toBe(text)
})

test('キーのない位置に 0 でない値がある時は、失わないように名前で書き、読み戻せる', () => {
  const odd = snapshotOf()
  const empty = [...Array(56).keys()].find((key) => !definedKeys(odd.layout).has(key))!
  odd.keymap[0][empty] = 0x04
  const text = snapshotToVil(odd)!
  expect(read(text).snapshot).toEqual(odd)
})

test('uid が 8 バイトの 16 進でないスナップショットは、保存できない', () => {
  expect(snapshotToVil({ ...device, uid: 'other' })).toBeNull()
})

test('JSON として読めないものは、読み込まない', () => {
  expect(failureOf('')).toEqual({ reason: 'not-json' })
  expect(failureOf('{"version": 1, ')).toEqual({ reason: 'not-json' })
  expect(failureOf(realVil.slice(0, 500))).toEqual({ reason: 'not-json' })
  expect(failureOf('これは .vil ではありません')).toEqual({ reason: 'not-json' })
})

test('.vil の形でないものは、どの項目が違うかを示して、読み込まない', () => {
  expect(failureOf('[]')).toEqual({ reason: 'not-vil', what: '全体' })
  expect(failureOf('"text"')).toEqual({ reason: 'not-vil', what: '全体' })
  expect(failureOf('{}')).toEqual({ reason: 'not-vil', what: 'layout' })
  expect(failureOf('{"layout": "x", "uid": 1}')).toEqual({ reason: 'not-vil', what: 'layout' })
  // uid がない、整数でない
  expect(failureOf(alteredVil((data) => delete data.uid))).toEqual({ reason: 'not-vil', what: 'uid' })
  expect(failureOf(alteredVil((data) => (data.uid = 1.5)))).toEqual({ reason: 'not-vil', what: 'uid' })
  expect(failureOf(alteredVil(() => {}, '18446744073709551616'))).toEqual({ reason: 'not-vil', what: 'uid' })
  // キーコードが、名前でも数でもない
  expect(failureOf(alteredVil((data) => ((data.layout as unknown[][][])[0][0][0] = null)))).toEqual({ reason: 'not-vil', what: 'layout' })
  expect(failureOf(alteredVil((data) => ((data.layout as unknown[][][])[0][0][0] = 70000)))).toEqual({ reason: 'not-vil', what: 'layout' })
  expect(failureOf(alteredVil((data) => ((data.layout as unknown[][][])[0][0][0] = 1.5)))).toEqual({ reason: 'not-vil', what: 'layout' })
  expect(failureOf(alteredVil((data) => ((data.encoder_layout as unknown[][])[0][0] = ['KC_A'])))).toEqual({
    reason: 'not-vil',
    what: 'encoder_layout',
  })
  expect(failureOf(alteredVil((data) => ((data.tap_dance as unknown[][])[0][4] = '250')))).toEqual({ reason: 'not-vil', what: 'tap_dance' })
  expect(failureOf(alteredVil((data) => (data.tap_dance as unknown[][])[0].pop()))).toEqual({ reason: 'not-vil', what: 'tap_dance' })
  expect(failureOf(alteredVil((data) => (data.combo as unknown[][])[3].push('KC_A')))).toEqual({ reason: 'not-vil', what: 'combo' })
  expect(failureOf(alteredVil((data) => (data.combo = {})))).toEqual({ reason: 'not-vil', what: 'combo' })
})

test('UID が接続中の本体と違う .vil は、読み込まない', () => {
  expect(failureOf(alteredVil(() => {}, '17279655951921914624'))).toEqual({ reason: 'uid' })
  expect(failureOf(realVil, { ...device, uid: 'fedcba9876543210' })).toEqual({ reason: 'uid' })
  // JSON.parse にそのまま通すと同じ数値になってしまう、すぐ隣の値も、違う UID として見分ける
  expect(Number('17279655951921914625')).toBe(Number('17279655951921914624'))
  expect(read(alteredVil(() => {})).snapshot).toEqual(device)
})

test('レイヤー数、キー数、エンコーダーの数が合わない .vil は、読み込まない', () => {
  expect(failureOf(alteredVil((data) => (data.layout as unknown[]).pop()))).toEqual({ reason: 'layers', actual: 9, expected: 10 })
  expect(failureOf(alteredVil((data) => (data.layout as unknown[][])[2].pop()))).toEqual({ reason: 'rows', actual: 7, expected: 8 })
  expect(failureOf(alteredVil((data) => (data.layout as unknown[][][])[2][7].push('KC_A')))).toEqual({
    reason: 'cols',
    actual: 8,
    expected: 7,
  })
  expect(failureOf(alteredVil((data) => (data.encoder_layout as unknown[]).push([])))).toEqual({ reason: 'layers', actual: 11, expected: 10 })
  expect(failureOf(alteredVil((data) => (data.encoder_layout as unknown[][])[9].pop()))).toEqual({
    reason: 'encoders',
    actual: 1,
    expected: 2,
  })
  expect(failureOf(alteredVil((data) => delete data.encoder_layout))).toEqual({ reason: 'layers', actual: 0, expected: 10 })
  // 本体の側の数が違う時も同じ
  const fewer = snapshotOf()
  fewer.capabilities.layerCount = 8
  expect(failureOf(realVil, fewer)).toEqual({ reason: 'layers', actual: 10, expected: 8 })
})

test('キーのある位置が -1 になっている .vil は、読み込まない', () => {
  expect(failureOf(alteredVil((data) => ((data.layout as unknown[][][])[4][1][2] = -1)))).toEqual({
    reason: 'missing-key',
    place: { kind: 'key', layer: 4, row: 1, col: 2 },
  })
})

test('Tap Dance か Combo の枠数が合わない .vil は、読み込まない', () => {
  expect(failureOf(alteredVil((data) => (data.tap_dance as unknown[]).pop()))).toEqual({ reason: 'tap-dance', actual: 31, expected: 32 })
  expect(failureOf(alteredVil((data) => (data.combo as unknown[]).push(['KC_NO', 'KC_NO', 'KC_NO', 'KC_NO', 'KC_NO'])))).toEqual({
    reason: 'combo',
    actual: 33,
    expected: 32,
  })
  // 項目がないファイルは、枠が 0 のファイルとして扱う
  expect(failureOf(alteredVil((data) => delete data.tap_dance))).toEqual({ reason: 'tap-dance', actual: 0, expected: 32 })
  const none = snapshotOf()
  none.capabilities.comboCount = 0
  none.combos = []
  expect(read(alteredVil((data) => delete data.combo), none).snapshot).toEqual(none)
})

test('解釈できない名前があれば、0 にせず、どの名前がどこにあったかを示して、読み込まない', () => {
  const text = alteredVil((data) => {
    ;(data.layout as unknown[][][])[1][2][3] = 'KC_UNKNOWN'
    ;(data.layout as unknown[][][])[5][0][0] = 'KC_UNKNOWN'
    ;(data.encoder_layout as unknown[][][])[2][1][0] = 'RGB_TOG'
    ;(data.tap_dance as unknown[][])[7][1] = 'FOO(1)'
    ;(data.combo as unknown[][])[9][4] = 'BAR'
  })
  expect(failureOf(text)).toEqual({
    reason: 'keycode',
    names: [
      { name: 'KC_UNKNOWN', place: { kind: 'key', layer: 1, row: 2, col: 3 } },
      { name: 'RGB_TOG', place: { kind: 'encoder', layer: 2, encoder: 1 } },
      { name: 'FOO(1)', place: { kind: 'tapDance', index: 7 } },
      { name: 'BAR', place: { kind: 'combo', index: 9 } },
    ],
  })
})

test('名前の代わりに、数値や 16 進の文字列で書かれたキーコードも読める', () => {
  const text = alteredVil((data) => {
    ;(data.layout as unknown[][][])[0][0][0] = 4
    ;(data.layout as unknown[][][])[0][0][1] = '0x7c00'
  })
  const { snapshot } = read(text)
  expect(snapshot.keymap[0][0]).toBe(4)
  expect(snapshot.keymap[0][1]).toBe(0x7c00)
})

test('扱わない項目（マクロ、Key Override、Alt Repeat Key、QMK Settings）は、数だけを数える', () => {
  const text = alteredVil((data) => {
    // 中身のあるマクロは 2 つ。空の枠は数えない
    ;(data.macro as unknown[][])[0] = [['text', 'hello']]
    ;(data.macro as unknown[][])[5] = [['tap', 'KC_A']]
    data.key_override = [{ trigger: 'KC_A' }, { trigger: 'KC_B' }, { trigger: 'KC_C' }]
    data.alt_repeat_key = [{ keycode: 'KC_A' }]
  })
  const { extras, snapshot } = read(text)
  expect(extras).toEqual({ macros: 2, keyOverrides: 3, altRepeatKeys: 1, settings: 9 })
  expect(countExtras(extras)).toBe(15)
  // 中身は持たない
  expect(snapshot).toEqual(device)
  // 項目がないファイル
  const bare = alteredVil((data) => {
    delete data.macro
    delete data.key_override
    delete data.alt_repeat_key
    delete data.settings
  })
  expect(countExtras(read(bare).extras)).toBe(0)
})

test('文字列の中に "uid" が現れても、いちばん外側の uid だけを読む', () => {
  // マクロの文字の中の "uid": 5 と、入れ子の中の uid には触らない
  const text = realVil
    .replace('"macro": [[]', '"macro": [[["text", "\\"uid\\": 5, \\\\"]]')
    .replace('"settings": {', '"settings": {"uid": 7, ')
  expect(text).not.toBe(realVil)
  const { snapshot, extras } = read(text)
  expect(snapshot.uid).toBe(device.uid)
  expect(extras).toMatchObject({ macros: 1, settings: 10 })
  // uid が後ろの方にあっても読める
  const moved = realVil.replace('"uid": 17279655951921914625, ', '').replace(/\}$/, ', "uid" : 17279655951921914625}')
  expect(read(moved).snapshot).toEqual(device)
})
