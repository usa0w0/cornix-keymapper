import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import type { Action } from './action.ts'
import type { KeyBehavior } from './behavior.ts'
import { decodeKey, tapDanceIndexOf } from './decode.ts'
import type { ComboEdit, ComboKey, EncoderEdit, Edits, KeyEdit } from './edits.ts'
import {
  applyEdits,
  comboKeycode,
  countFreeCombos,
  countFreeTapDances,
  encodeBehavior,
  encodeComboOutput,
  encodeEncoderAction,
  planKeyEdits,
  tapDanceUses,
} from './encode.ts'
import { customKeycodesOf } from './keycodes.ts'

const key = (code: number): Action => ({ kind: 'key', code, mods: [] })
const A = key(0x04)
const B = key(0x05)
const SPACE = key(0x2c)
const ESC = key(0x29)
const L_CTRL: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] }
const L_GUI: Action = { kind: 'key', mods: [{ kind: 'gui', side: 'left' }] }
const R_GUI: Action = { kind: 'key', mods: [{ kind: 'gui', side: 'right' }] }
const CTRL_C: Action = { kind: 'key', code: 0x06, mods: [{ kind: 'ctrl', side: 'left' }] }
const mo = (layer: number): Action => ({ kind: 'layer', mode: 'momentary', layer })

const keycode = (feature: string, code: number) => ({ feature, keycode: code })
const tapDance = (onTap: number, onHold: number, onDoubleTap = 0, onTapHold = 0) => ({
  feature: 'tapDance',
  fields: { onTap, onHold, onDoubleTap, onTapHold },
})

// ---- 機能の自動判定 ----

test('タップだけのキーは、そのキーコード1つになる（枠を使わない）', () => {
  expect(encodeBehavior({ tap: A })).toEqual(keycode('key', 0x0004))
  expect(encodeBehavior({ tap: CTRL_C })).toEqual(keycode('key', 0x0106))
  expect(encodeBehavior({ tap: L_CTRL })).toEqual(keycode('key', 0x00e0))
  // タップ欄のレイヤー切り替えは、TG・TO・OSL
  expect(encodeBehavior({ tap: { kind: 'layer', mode: 'toggle', layer: 1 } })).toEqual(keycode('key', 0x5261))
  expect(encodeBehavior({ tap: { kind: 'layer', mode: 'to', layer: 2 } })).toEqual(keycode('key', 0x5202))
  expect(encodeBehavior({ tap: { kind: 'layer', mode: 'oneShot', layer: 1 } })).toEqual(keycode('key', 0x5281))
  // このサイトで扱わないキーコードは、元の値のまま
  expect(encodeBehavior({ tap: { kind: 'unsupported', raw: 0x7e00, label: 'BT0' } })).toEqual(keycode('key', 0x7e00))
})

test('何もしないキーと透過のキーは、キーコード 0 と 1 になる。4欄とも空のキーも、何もしないキー', () => {
  expect(encodeBehavior({ tap: { kind: 'none' } })).toEqual(keycode('key', 0x0000))
  expect(encodeBehavior({})).toEqual(keycode('key', 0x0000))
  expect(encodeBehavior({ tap: { kind: 'transparent' } })).toEqual(keycode('key', 0x0001))
})

test('長押しだけで「押している間だけレイヤー N」のキーは、MO になる', () => {
  expect(encodeBehavior({ hold: mo(2) })).toEqual(keycode('mo', 0x5222))
  expect(encodeBehavior({ hold: mo(31) })).toEqual(keycode('mo', 0x523f))
  // 「何もしない」のタップは、タップ欄が空なのと同じ
  expect(encodeBehavior({ tap: { kind: 'none' }, hold: mo(2) })).toEqual(keycode('mo', 0x5222))
})

test('タップが修飾なしの基本キー、長押しが片側の修飾キーの組のキーは、MT になる', () => {
  expect(encodeBehavior({ tap: A, hold: L_CTRL })).toEqual(keycode('mt', 0x2104))
  expect(encodeBehavior({ tap: B, hold: R_GUI })).toEqual(keycode('mt', 0x3805))
  const ctrlShift: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }, { kind: 'shift', side: 'left' }] }
  expect(encodeBehavior({ tap: A, hold: ctrlShift })).toEqual(keycode('mt', 0x2304))
})

test('タップが修飾なしの基本キー、長押しが「押している間だけレイヤー N」（N は 0〜15）のキーは、LT になる', () => {
  expect(encodeBehavior({ tap: SPACE, hold: mo(3) })).toEqual(keycode('lt', 0x432c))
  expect(encodeBehavior({ tap: SPACE, hold: mo(0) })).toEqual(keycode('lt', 0x402c))
  expect(encodeBehavior({ tap: SPACE, hold: mo(15) })).toEqual(keycode('lt', 0x4f2c))
})

test('MO・MT・LT にしたキーコードは、読み直すと同じ4欄に戻る', () => {
  const behaviors: KeyBehavior[] = [{ hold: mo(2) }, { tap: A, hold: L_CTRL }, { tap: B, hold: R_GUI }, { tap: SPACE, hold: mo(3) }]
  for (const behavior of behaviors) {
    const encoded = encodeBehavior(behavior)
    expect(encoded && 'keycode' in encoded && decodeKey(encoded.keycode, [])).toEqual(behavior)
  }
})

test('MT と LT の形に合わないタップ＋長押しは、Tap Dance になる', () => {
  // タップが修飾キー付きのキー、修飾キーだけ、レイヤー切り替え
  expect(encodeBehavior({ tap: CTRL_C, hold: L_CTRL })).toEqual(tapDance(0x0106, 0x00e0))
  expect(encodeBehavior({ tap: L_GUI, hold: L_CTRL })).toEqual(tapDance(0x00e3, 0x00e0))
  expect(encodeBehavior({ tap: { kind: 'layer', mode: 'toggle', layer: 1 }, hold: mo(2) })).toEqual(tapDance(0x5261, 0x5222))
  // 長押しが、ふつうのキー、修飾キー付きのキー
  expect(encodeBehavior({ tap: A, hold: B })).toEqual(tapDance(0x0004, 0x0005))
  expect(encodeBehavior({ tap: A, hold: CTRL_C })).toEqual(tapDance(0x0004, 0x0106))
  // LT で表せないレイヤー（16 以上）
  expect(encodeBehavior({ tap: SPACE, hold: mo(16) })).toEqual(tapDance(0x002c, 0x5230))
})

test('長押しだけでレイヤー切り替えでないキーと、2回タップ・タップ後長押しを使うキーは、Tap Dance になる', () => {
  expect(encodeBehavior({ hold: L_CTRL })).toEqual(tapDance(0, 0x00e0))
  expect(encodeBehavior({ tap: A, doubleTap: ESC })).toEqual(tapDance(0x0004, 0, 0x0029))
  expect(encodeBehavior({ doubleTap: ESC })).toEqual(tapDance(0, 0, 0x0029))
  expect(encodeBehavior({ tapHold: mo(1) })).toEqual(tapDance(0, 0, 0, 0x5221))
  // MT で書ける2欄に、もう1欄を足すと Tap Dance
  expect(encodeBehavior({ tap: A, hold: L_CTRL, doubleTap: ESC })).toEqual(tapDance(0x0004, 0x00e0, 0x0029))
  expect(encodeBehavior({ tap: A, hold: L_CTRL, doubleTap: ESC, tapHold: mo(1) })).toEqual(
    tapDance(0x0004, 0x00e0, 0x0029, 0x5221),
  )
  // 長押しだけの MO に、タップ後長押しを足しても Tap Dance
  expect(encodeBehavior({ hold: mo(2), tapHold: mo(3) })).toEqual(tapDance(0, 0x5222, 0, 0x5223))
})

test('本体の設定に直せない動作は、undefined になる', () => {
  const mixed: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }, { kind: 'shift', side: 'right' }] }
  expect(encodeBehavior({ tap: mixed })).toBeUndefined()
  expect(encodeBehavior({ tap: A, hold: mixed })).toBeUndefined()
  // 透過は、ほかの欄と組み合わせられず、タップ欄にだけ入る
  expect(encodeBehavior({ tap: { kind: 'transparent' }, hold: L_CTRL })).toBeUndefined()
  expect(encodeBehavior({ hold: { kind: 'transparent' } })).toBeUndefined()
  // 表にないキー、範囲外のレイヤー
  expect(encodeBehavior({ tap: key(0xff) })).toBeUndefined()
  expect(encodeBehavior({ hold: mo(32) })).toBeUndefined()
})

test('実機の設定: Tap Dance 以外のキーは、4欄に直してから本体の設定に直すと、元のキーコードに戻る', () => {
  const snapshot = cornixSnapshot()
  const custom = customKeycodesOf(snapshot.layout)
  let checked = 0
  for (const code of snapshot.keymap.flat()) {
    if (tapDanceIndexOf(code) !== undefined) continue
    expect(encodeBehavior(decodeKey(code, snapshot.tapDances, custom))).toMatchObject({ keycode: code })
    checked++
  }
  expect(checked).toBe(snapshot.keymap.flat().length - 5)
})

// ---- 枠の割り当て ----
// 実機の設定では、枠 0（タップ: Space ／ 長押し: 左 GUI）をレイヤー 0〜2 の4つのキーが、
// 枠 1（タップ: B ／ 長押し: 右 GUI）をレイヤー 0 のキー 54 だけが使っていて、残りの 30 枠は空

const TD = 0x5700
const EMPTY = { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 }
const A_ESC: KeyBehavior = { tap: A, doubleTap: ESC }
const B_ESC: KeyBehavior = { tap: B, doubleTap: ESC }
const A_ESC_ENTRY = { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 }
const B_ESC_ENTRY = { ...A_ESC_ENTRY, onTap: 0x05 }

const edit = (layer: number, index: number, behavior: KeyBehavior): KeyEdit => ({ layer, key: index, behavior })
const edits = (...keys: KeyEdit[]): Edits => ({ keys, encoders: [], combos: [] })

function altered(alter: (snapshot: KeyboardSnapshot) => void): KeyboardSnapshot {
  const snapshot = cornixSnapshot()
  alter(snapshot)
  return snapshot
}

/** 空いている枠がない設定。枠 2〜31 に別々の中身を入れ、レイヤー 9 のキーから1つずつ指す */
const full = (alter: (snapshot: KeyboardSnapshot) => void = () => {}) =>
  altered((s) => {
    for (let slot = 2; slot < 32; slot++) {
      s.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
      s.keymap[9][slot] = TD + slot
    }
    alter(s)
  })

/** 編集を当てはめた目標 */
function targetOf(source: KeyboardSnapshot, applied: Edits): KeyboardSnapshot {
  const target = structuredClone(source)
  applyEdits(target, applied)
  return target
}

test('実機の設定: 編集がなければ、キーマップと枠は出発点と一致し、残り枠数は 30', () => {
  const source = cornixSnapshot()
  const plan = planKeyEdits(source, edits())
  expect(plan.keymap).toEqual(source.keymap)
  expect(plan.tapDances).toEqual(source.tapDances)
  expect(plan).toMatchObject({ free: 30, missing: 0, unplaced: [], invalid: [], overwritable: 0 })
  expect(countFreeTapDances(source)).toBe(30)
  expect(targetOf(source, edits())).toEqual(source)
})

test('枠を使わない機能への編集は、キーコードだけを変える。枠は変わらない', () => {
  const source = cornixSnapshot()
  const target = targetOf(source, edits(edit(0, 1, { tap: A, hold: L_CTRL }), edit(3, 2, { hold: mo(4) }), edit(0, 2, { tap: B })))
  expect(target).toEqual(
    altered((s) => {
      s.keymap[0][1] = 0x2104
      s.keymap[3][2] = 0x5224
      s.keymap[0][2] = 0x0005
    }),
  )
})

test('Tap Dance が要るキーには、空いている枠のうち、番号の小さいものを割り当てる。ほかのキーと枠は変わらない', () => {
  const source = cornixSnapshot()
  const applied = edits(edit(0, 1, A_ESC))
  expect(targetOf(source, applied)).toEqual(
    altered((s) => {
      s.keymap[0][1] = TD + 2
      s.tapDances[2] = A_ESC_ENTRY
    }),
  )
  expect(planKeyEdits(source, applied).free).toBe(29)
})

test('同じ内容のキーは、1つの枠を共有する。内容が違えば、別の枠を使う。結果は、編集の順番によらない', () => {
  const source = cornixSnapshot()
  const keys = [edit(4, 3, B_ESC), edit(0, 1, A_ESC), edit(2, 5, A_ESC)]
  const expected = altered((s) => {
    s.keymap[0][1] = TD + 2
    s.keymap[2][5] = TD + 2
    s.keymap[4][3] = TD + 3
    s.tapDances[2] = A_ESC_ENTRY
    s.tapDances[3] = B_ESC_ENTRY
  })
  expect(targetOf(source, edits(...keys))).toEqual(expected)
  expect(targetOf(source, edits(...keys.toReversed()))).toEqual(expected)
  expect(planKeyEdits(source, edits(...keys)).free).toBe(28)
})

test('4欄が同じ内容の枠が出発点にあれば、その枠を使う。複数あれば、番号の小さいもの', () => {
  // 枠 7 と枠 5 に同じ中身。枠 5 はどこからも使われていない（Vial で作りかけの枠）
  const source = altered((s) => {
    s.tapDances[7] = { ...A_ESC_ENTRY, tappingTerm: 180 }
    s.tapDances[5] = A_ESC_ENTRY
    s.keymap[3][0] = TD + 7
  })
  const plan = planKeyEdits(source, edits(edit(0, 1, A_ESC)))
  expect(plan.keymap[0][1]).toBe(TD + 5)
  expect(plan.tapDances).toEqual(source.tapDances)
  expect(plan.free).toBe(28)
})

test('Tap Dance のキーの長押しを消すと通常のキーになり、使われなくなった枠が空く', () => {
  const source = cornixSnapshot()
  const applied = edits(edit(0, 54, { tap: B }))
  expect(targetOf(source, applied)).toEqual(
    altered((s) => {
      s.keymap[0][54] = 0x0005
      s.tapDances[1] = EMPTY
    }),
  )
  expect(planKeyEdits(source, applied).free).toBe(31)
})

test('同じ枠を指すキーの1つだけを変えても、ほかのキーが使っている枠は変わらない（このキーだけ変更）', () => {
  const source = cornixSnapshot()
  // 枠を使わない機能にする
  expect(targetOf(source, edits(edit(0, 26, { tap: SPACE })))).toEqual(altered((s) => (s.keymap[0][26] = 0x002c)))
  // 別の内容の Tap Dance にする。枠が1つ増える
  const applied = edits(edit(0, 26, { tap: SPACE, hold: L_GUI, doubleTap: ESC }))
  expect(targetOf(source, applied)).toEqual(
    altered((s) => {
      s.keymap[0][26] = TD + 2
      s.tapDances[2] = { onTap: 0x2c, onHold: 0xe3, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 }
    }),
  )
  expect(planKeyEdits(source, applied).free).toBe(29)
})

test('同じ枠を指すキーをすべて変えると、その枠は空く', () => {
  const source = cornixSnapshot()
  const all = [edit(0, 26, { tap: SPACE }), edit(1, 26, { tap: SPACE }), edit(1, 54, { tap: SPACE }), edit(2, 26, { tap: SPACE })]
  const plan = planKeyEdits(source, edits(...all))
  expect(plan.tapDances[0]).toEqual(EMPTY)
  expect(plan.free).toBe(31)
  // 1つでも残っていれば、空かない
  expect(planKeyEdits(source, edits(...all.slice(1))).tapDances[0]).toEqual(source.tapDances[0])
})

test('使われなくなった枠より、空いている枠を先に使う。使われなくなった枠は空にする', () => {
  const source = cornixSnapshot()
  expect(targetOf(source, edits(edit(0, 54, B_ESC)))).toEqual(
    altered((s) => {
      s.keymap[0][54] = TD + 2
      s.tapDances[2] = B_ESC_ENTRY
      s.tapDances[1] = EMPTY
    }),
  )
})

test('空いている枠がなければ、この編集で使われなくなった枠を使う', () => {
  const source = full()
  expect(countFreeTapDances(source)).toBe(0)
  // 枠 1 を使っていたキー自身を、別の内容にする
  expect(targetOf(source, edits(edit(0, 54, B_ESC)))).toEqual(
    full((s) => {
      s.keymap[0][54] = TD + 1
      s.tapDances[1] = B_ESC_ENTRY
    }),
  )
  // 枠 1 を使っていたキーを通常のキーにし、別のキーに Tap Dance を足す
  const moved = edits(edit(0, 1, A_ESC), edit(0, 54, { tap: B }))
  const expected = full((s) => {
    s.keymap[0][1] = TD + 1
    s.keymap[0][54] = 0x0005
    s.tapDances[1] = A_ESC_ENTRY
  })
  expect(targetOf(source, moved)).toEqual(expected)
  expect(targetOf(source, edits(...moved.keys.toReversed()))).toEqual(expected)
  expect(planKeyEdits(source, moved).free).toBe(0)
})

test('枠が足りない編集は、割り当てられなかったキーと、足りない数を返す。目標は作れない', () => {
  const source = full()
  const applied = edits(edit(0, 1, A_ESC), edit(0, 2, A_ESC), edit(0, 3, B_ESC), edit(0, 4, { tap: A }))
  const plan = planKeyEdits(source, applied)
  // 中身ごとに1枠なので、足りないのは2枠。キーは3つ
  expect(plan.missing).toBe(2)
  expect(plan.unplaced).toEqual([edit(0, 1, A_ESC), edit(0, 2, A_ESC), edit(0, 3, B_ESC)])
  expect(plan.free).toBe(0)
  expect(plan.overwritable).toBe(0)
  // 割り当てられなかったキーは、出発点のまま
  expect(plan.keymap[0].slice(1, 4)).toEqual(source.keymap[0].slice(1, 4))
  expect(plan.keymap[0][4]).toBe(0x0004)
  expect(() => applyEdits(structuredClone(source), applied)).toThrow('Tap Dance の枠が 2 個足りない')
})

test('本体に Tap Dance の枠がなければ、枠が要る編集はできない。枠を使わない編集はできる', () => {
  const source = altered((s) => {
    s.tapDances = []
    s.keymap = s.keymap.map((keys) => keys.map((code) => (tapDanceIndexOf(code) === undefined ? code : 0)))
  })
  expect(planKeyEdits(source, edits(edit(0, 1, A_ESC)))).toMatchObject({ missing: 1, free: 0 })
  expect(targetOf(source, edits(edit(0, 1, { tap: A, hold: L_CTRL }))).keymap[0][1]).toBe(0x2104)
})

test('出発点で中身が入っている枠は、どこからも使われていなくても、勝手に空にしないし、勝手に使わない', () => {
  // 枠 31 を、どのキーからも指さない
  const source = full((s) => (s.keymap[9][31] = 0))
  expect(countFreeTapDances(source)).toBe(0)
  // 関係のない編集で、中身は変わらない
  expect(planKeyEdits(source, edits(edit(0, 1, { tap: A }))).tapDances).toEqual(source.tapDances)
  // 枠が要る編集は、足りないまま。上書きすれば使える枠の数を返す
  const plan = planKeyEdits(source, edits(edit(0, 1, A_ESC)))
  expect(plan).toMatchObject({ missing: 1, overwritable: 1 })
  expect(plan.tapDances).toEqual(source.tapDances)
})

test('利用者が認めていれば、中身はあるが使われていない枠を、上書きして使う。空いている枠があるうちは、上書きしない', () => {
  const source = full((s) => (s.keymap[9][31] = 0))
  const allowed: Edits = { ...edits(edit(0, 1, A_ESC)), overwriteUnusedTapDances: true }
  expect(targetOf(source, allowed)).toEqual(
    full((s) => {
      s.keymap[9][31] = 0
      s.keymap[0][1] = TD + 31
      s.tapDances[31] = A_ESC_ENTRY
    }),
  )
  expect(planKeyEdits(source, allowed)).toMatchObject({ missing: 0, overwritable: 0, free: 0 })
  // 認めていても、足りなければ足りない
  expect(planKeyEdits(source, { ...allowed, keys: [edit(0, 1, A_ESC), edit(0, 2, B_ESC)] })).toMatchObject({ missing: 1 })
  // 空いている枠がある時は、そちらを使う
  const roomy = altered((s) => (s.tapDances[9] = B_ESC_ENTRY))
  const plan = planKeyEdits(roomy, allowed)
  expect(plan.keymap[0][1]).toBe(TD + 2)
  expect(plan.tapDances[9]).toEqual(B_ESC_ENTRY)
  expect(plan.overwritable).toBe(1)
})

test('出発点にある枠どうしは、内容が同じでもまとめない。時間の値も枠ごとに残す', () => {
  const source = altered((s) => {
    s.tapDances[3] = { ...s.tapDances[0], tappingTerm: 180 }
    s.keymap[5][0] = TD + 3
  })
  const plan = planKeyEdits(source, edits(edit(0, 1, A_ESC)))
  expect(plan.keymap[5][0]).toBe(TD + 3)
  expect(plan.keymap[0][26]).toBe(TD)
  expect(plan.tapDances[0]).toEqual(source.tapDances[0])
  expect(plan.tapDances[3]).toEqual(source.tapDances[3])
})

test('新しく使う枠と、空にする枠の時間の値は、その枠の値のまま', () => {
  const source = altered((s) => {
    s.tapDances[1].tappingTerm = 300
    s.tapDances[2].tappingTerm = 180
  })
  const plan = planKeyEdits(source, edits(edit(0, 1, A_ESC), edit(0, 54, { tap: B })))
  expect(plan.tapDances[2]).toEqual({ ...A_ESC_ENTRY, tappingTerm: 180 })
  expect(plan.tapDances[1]).toEqual({ ...EMPTY, tappingTerm: 300 })
})

test('枠が使われているかは、キーに加えて、エンコーダーとコンボも数える', () => {
  // 枠 2 はエンコーダーから、枠 3 はコンボの出力から指されている（中身は空）。枠 1 は、キーとコンボの両方から
  const source = altered((s) => {
    s.encoders[4][1] = [TD + 2, 0x00da]
    s.combos[0] = { keys: [0x04, 0x05, 0, 0], output: TD + 3 }
    s.combos[1] = { keys: [0x06, 0x07, 0, 0], output: TD + 1 }
  })
  expect(countFreeTapDances(source)).toBe(28)
  // 空に見えても、指されている枠は使わない
  const plan = planKeyEdits(source, edits(edit(0, 1, A_ESC), edit(0, 54, { tap: B })))
  expect(plan.keymap[0][1]).toBe(TD + 4)
  expect(plan.tapDances[2]).toEqual(EMPTY)
  expect(plan.tapDances[3]).toEqual(EMPTY)
  // キーが使わなくなっても、コンボの出力が指している枠は、空にしない
  expect(plan.tapDances[1]).toEqual(source.tapDances[1])
  expect(tapDanceUses(source)).toEqual([
    { slot: 0, keys: [{ layer: 0, key: 26 }, { layer: 1, key: 26 }, { layer: 1, key: 54 }, { layer: 2, key: 26 }], others: 0 },
    { slot: 1, keys: [{ layer: 0, key: 54 }], others: 1 },
    { slot: 2, keys: [], others: 1 },
    { slot: 3, keys: [], others: 1 },
  ])
})

test('枠を使っているキーの一覧に、本体にない枠を指すキーコードは含めない', () => {
  const source = altered((s) => (s.keymap[0][1] = TD + 200))
  expect(tapDanceUses(source).map((use) => use.slot)).toEqual([0, 1])
})

test('中身が空の枠を指しているキーを変えると、その枠は、空いている枠に戻る', () => {
  const source = altered((s) => (s.keymap[0][1] = TD + 6))
  expect(countFreeTapDances(source)).toBe(29)
  expect(planKeyEdits(source, edits(edit(0, 1, { tap: A }))).free).toBe(30)
})

test('本体の設定に直せない動作と、出発点にない場所の編集は、invalid として返し、目標は作れない', () => {
  const source = cornixSnapshot()
  const bad = edit(0, 1, { tap: { kind: 'transparent' }, hold: L_CTRL })
  const nowhere = edit(0, 999, { tap: A })
  const plan = planKeyEdits(source, edits(bad, nowhere))
  expect(plan.invalid).toEqual([bad, nowhere])
  expect(plan.keymap).toEqual(source.keymap)
  expect(() => applyEdits(structuredClone(source), edits(bad))).toThrow('直せない')
})

// ---- コンボ ----
// 実機の設定には、コンボが1つもない（32 枠すべて空）。レイヤー 0 は、Q が キー 1、W が キー 2

const Q = 0x14
const W = 0x1a
const NO_KEYS: [number, number, number, number] = [0, 0, 0, 0]
const EMPTY_COMBO = { keys: NO_KEYS, output: 0 }
const combos = (...list: ComboEdit[]): Edits => ({ keys: [], encoders: [], combos: list })
const added = (number: number, keys: ComboKey[], output: Action): ComboEdit => ({ ref: { added: number }, combo: { keys, output } })

test('コンボの出力は、動作1つをキーコード1つに直す。「押している間だけレイヤー N」と「何もしない」は入れられない', () => {
  expect(encodeComboOutput(ESC)).toBe(0x29)
  expect(encodeComboOutput(CTRL_C)).toBe(0x0106)
  expect(encodeComboOutput({ kind: 'layer', mode: 'toggle', layer: 2 })).toBe(0x5262)
  expect(encodeComboOutput(mo(1))).toBeUndefined()
  expect(encodeComboOutput({ kind: 'none' })).toBeUndefined()
  expect(encodeComboOutput({ kind: 'transparent' })).toBeUndefined()
  // 本体から読んだ、このサイトで扱わない動作は、元の値に戻る
  expect(encodeComboOutput({ kind: 'unsupported', raw: TD + 3, label: 'Tap Dance 3' })).toBe(TD + 3)
})

test('足したコンボは、足した順に、空いている枠の番号の小さいものへ入る。編集していないコンボは、出発点の値のまま', () => {
  // 枠 0 と 2 に、本体のコンボがある（枠 2 の出力は、このサイトで扱わないキーコード）
  const source = altered((s) => {
    s.combos[0] = { keys: [0x04, 0x05, 0, 0], output: 0x29 }
    s.combos[2] = { keys: [0x06, 0x07, 0x08, 0x09], output: 0x7e00 }
  })
  expect(countFreeCombos(source.combos)).toBe(30)
  // 足した順の番号が逆に並んでいても、結果は同じ
  const applied = combos(added(1, [Q, W, 0x08], CTRL_C), added(0, [Q, W], ESC))
  const target = targetOf(source, applied)
  expect(target.combos[1]).toEqual({ keys: [Q, W, 0, 0], output: 0x29 })
  expect(target.combos[3]).toEqual({ keys: [Q, W, 0x08, 0], output: 0x0106 })
  expect(target.combos[0]).toEqual(source.combos[0])
  expect(target.combos[2]).toEqual(source.combos[2])
  expect(target.combos.slice(4)).toEqual(source.combos.slice(4))
  // キーマップ、エンコーダー、Tap Dance の枠は変わらない
  expect({ ...target, combos: source.combos }).toEqual(source)
  expect(planKeyEdits(source, applied)).toMatchObject({
    freeCombos: 28,
    missingCombos: 0,
    invalidCombos: [],
    addedCombos: [{ added: 0, slot: 1 }, { added: 1, slot: 3 }],
  })
})

test('出発点にあるコンボを変えると、その枠に書く。消すと、その枠を空にする', () => {
  const source = altered((s) => {
    s.combos[0] = { keys: [0x04, 0x05, 0, 0], output: 0x29 }
    s.combos[2] = { keys: [0x06, 0x07, 0x08, 0x09], output: 0x7e00 }
  })
  const applied = combos(
    { ref: { slot: 0 }, combo: null },
    // 同時に押すキーだけを変えた時は、このサイトで扱わない出力を、元の値のまま保つ
    { ref: { slot: 2 }, combo: { keys: [Q, W], output: { kind: 'unsupported', raw: 0x7e00, label: 'BT0' } } },
  )
  const target = targetOf(source, applied)
  expect(target.combos[0]).toEqual(EMPTY_COMBO)
  expect(target.combos[2]).toEqual({ keys: [Q, W, 0, 0], output: 0x7e00 })
  expect(planKeyEdits(source, applied).freeCombos).toBe(31)
})

test('コンボの枠が足りない時は、足りない数を返し、目標は作れない。消したコンボの枠は、足したコンボに使える', () => {
  const source = altered((s) => {
    s.combos = s.combos.map((_, slot) => ({ keys: [0x04, 0x05 + slot, 0, 0], output: 0x29 }))
  })
  expect(countFreeCombos(source.combos)).toBe(0)
  const short = planKeyEdits(source, combos(added(0, [Q, W], ESC)))
  expect(short).toMatchObject({ missingCombos: 1, freeCombos: 0, addedCombos: [] })
  expect(short.combos).toEqual(source.combos)
  expect(() => applyEdits(structuredClone(source), combos(added(0, [Q, W], ESC)))).toThrow('コンボの枠が 1 個足りない')
  // 枠 5 のコンボを消すと、足したコンボは、その枠に入る
  const swapped = combos({ ref: { slot: 5 }, combo: null }, added(0, [Q, W], ESC))
  expect(planKeyEdits(source, swapped)).toMatchObject({ missingCombos: 0, freeCombos: 0, addedCombos: [{ added: 0, slot: 5 }] })
  expect(targetOf(source, swapped).combos[5]).toEqual({ keys: [Q, W, 0, 0], output: 0x29 })
})

test('本体の設定に直せないコンボと、出発点にない枠のコンボは、invalidCombos として返し、目標は作れない', () => {
  const source = cornixSnapshot()
  const bad = [
    added(0, [Q], ESC),
    added(1, [Q, W, 0x04, 0x05, 0x06], ESC),
    added(2, [Q, W], mo(1)),
    added(3, [Q, 0], ESC),
    { ref: { slot: 99 }, combo: { keys: [Q, W], output: ESC } },
  ]
  const plan = planKeyEdits(source, combos(...bad))
  expect(plan.invalidCombos).toHaveLength(5)
  expect(plan.combos).toEqual(source.combos)
  expect(plan.freeCombos).toBe(32)
  expect(() => applyEdits(structuredClone(source), combos(bad[0]))).toThrow('直せないコンボ')
})

test('コンボの出力が Tap Dance を指していれば、その枠は使われている。そのコンボを消すと、枠は使われなくなって空になる', () => {
  // 枠 5 は、コンボの出力だけから指されている
  const source = altered((s) => {
    s.tapDances[5] = A_ESC_ENTRY
    s.combos[0] = { keys: [Q, W, 0, 0], output: TD + 5 }
  })
  expect(countFreeTapDances(source)).toBe(29)
  const removed = planKeyEdits(source, combos({ ref: { slot: 0 }, combo: null }))
  expect(removed.tapDances[5]).toEqual(EMPTY)
  expect(removed.free).toBe(30)
  // 出力を別の動作に変えても、同じ
  const changed = planKeyEdits(source, combos({ ref: { slot: 0 }, combo: { keys: [Q, W], output: ESC } }))
  expect(changed.tapDances[5]).toEqual(EMPTY)
  expect(changed.combos[0]).toEqual({ keys: [Q, W, 0, 0], output: 0x29 })
})

test('コンボの同時に押すキーが Tap Dance を指していれば、その枠は使われている（キーを変えても、枠を空にしない）', () => {
  // レイヤー 0 の キー 54 は枠 1 を指す。コンボも、枠 1 を指すキーコードを、同時に押すキーに持つ
  const source = altered((s) => (s.combos[0] = { keys: [Q, TD + 1, 0, 0], output: 0x29 }))
  expect(tapDanceUses(source)[1]).toEqual({ slot: 1, keys: [{ layer: 0, key: 54 }], others: 1 })
  const plan = planKeyEdits(source, edits(edit(0, 54, { tap: A })))
  expect(plan.tapDances[1]).toEqual(source.tapDances[1])
  expect(plan.free).toBe(30)
  // コンボを消せば、枠は使われなくなって空になる
  const both = planKeyEdits(source, { ...edits(edit(0, 54, { tap: A })), combos: [{ ref: { slot: 0 }, combo: null }] })
  expect(both.tapDances[1]).toEqual(EMPTY)
  expect(both.free).toBe(31)
})

test('編集して Tap Dance になるキーをコンボに使う時は、4欄の中身で持ち、目標を作る時に、その枠を指すキーコードに直す', () => {
  const source = cornixSnapshot()
  const fields = { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0 }
  const combo = added(0, [Q, { tapDance: fields }], ESC)
  // キー 2 を「A、2回タップで Esc」にして、コンボに使う。枠は 2 になる
  const one: Edits = { ...edits(edit(0, 2, A_ESC)), combos: [combo] }
  const plan = planKeyEdits(source, one)
  expect(plan.keymap[0][2]).toBe(TD + 2)
  expect(plan.combos[0]).toEqual({ keys: [Q, TD + 2, 0, 0], output: 0x29 })
  expect(comboKeycode(plan, { tapDance: fields })).toBe(TD + 2)
  expect(comboKeycode(plan, Q)).toBe(Q)
  // その後で、前にあるキーが別の枠を使うと、枠の番号がずれる。コンボは、同じ中身のキーを指し続ける
  const two: Edits = { ...edits(edit(0, 1, B_ESC), edit(0, 2, A_ESC)), combos: [combo] }
  const shifted = targetOf(source, two)
  expect(shifted.keymap[0][1]).toBe(TD + 2)
  expect(shifted.keymap[0][2]).toBe(TD + 3)
  expect(shifted.tapDances[3]).toEqual(A_ESC_ENTRY)
  expect(shifted.combos[0]).toEqual({ keys: [Q, TD + 3, 0, 0], output: 0x29 })
})

test('コンボが中身で持っているキーを、後から別の動作に変えても、コンボの中身の枠は残る（コンボは、そのキーから外れる）', () => {
  const source = cornixSnapshot()
  const fields = { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0 }
  const combo = added(0, [Q, { tapDance: fields }], ESC)
  // キー 2 は、別の中身（B、2回タップで Esc）になった
  const plan = planKeyEdits(source, { ...edits(edit(0, 2, B_ESC)), combos: [combo] })
  expect(plan.missing).toBe(0)
  expect(plan.keymap[0][2]).toBe(TD + 2)
  expect(plan.tapDances[2]).toEqual(B_ESC_ENTRY)
  expect(plan.tapDances[3]).toEqual(A_ESC_ENTRY)
  expect(plan.combos[0]).toEqual({ keys: [Q, TD + 3, 0, 0], output: 0x29 })
  expect(plan.free).toBe(28)
  // 出発点に同じ中身の枠があれば、その枠を指す。どのキーからも指されていなくても、その枠は空にしない
  const held = altered((s) => (s.tapDances[1] = { ...fields, tappingTerm: 250 }))
  const reused = planKeyEdits(held, { ...edits(edit(0, 54, { tap: B })), combos: [combo] })
  expect(reused.combos[0]).toEqual({ keys: [Q, TD + 1, 0, 0], output: 0x29 })
  expect(reused.tapDances[1]).toEqual(held.tapDances[1])
})

test('コンボのキーの中身に枠を割り当てられない時は、Tap Dance の枠が足りない', () => {
  const source = full()
  const combo = added(0, [Q, { tapDance: { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0 } }], ESC)
  const plan = planKeyEdits(source, combos(combo))
  expect(plan.missing).toBe(1)
  expect(plan.combos).toEqual(source.combos)
  expect(() => applyEdits(structuredClone(source), combos(combo))).toThrow('Tap Dance の枠が 1 個足りない')
})

// ---- エンコーダー ----
// 実機の設定では、エンコーダーは2つ。レイヤー 0 は、1つ目が [ホイール↑, ホイール↓]、2つ目が [ホイール↓, ホイール↑]。
// レイヤー 1〜9 は、1つ目が [音量−, 音量＋]、2つ目が [ホイール↑, ホイール↓]

const WHEEL_UP = 0x00d9
const WHEEL_DOWN = 0x00da
const VOLUME_DOWN = 0x00aa
const VOLUME_UP = 0x00a9

const turn = (layer: number, encoder: number, direction: 'left' | 'right', action: Action): EncoderEdit => ({
  layer,
  encoder,
  direction,
  action,
})
const turns = (...encoders: EncoderEdit[]): Edits => ({ keys: [], encoders, combos: [] })

test('エンコーダーの動作は、キーコード1つになる。透過、「押している間だけレイヤー N」、キーコード1つで表せない動作は入れられない', () => {
  expect(encodeEncoderAction(key(VOLUME_UP))).toBe(VOLUME_UP)
  expect(encodeEncoderAction(CTRL_C)).toBe(0x0106)
  expect(encodeEncoderAction(L_CTRL)).toBe(0x00e0)
  expect(encodeEncoderAction({ kind: 'layer', mode: 'toggle', layer: 3 })).toBe(0x5263)
  // 欄を消した時の「何もしない」
  expect(encodeEncoderAction({ kind: 'none' })).toBe(0x0000)
  // 透過は、実機で効くか確かめていないので、入れられない
  expect(encodeEncoderAction({ kind: 'transparent' })).toBeUndefined()
  // 本体から読んだ、このサイトで扱わない動作は、元の値に戻る
  expect(encodeEncoderAction({ kind: 'unsupported', raw: TD + 3, label: 'Tap Dance 3' })).toBe(TD + 3)
  expect(encodeEncoderAction(mo(1))).toBeUndefined()
  expect(encodeEncoderAction({ kind: 'key', code: 0x04, mods: [{ kind: 'ctrl', side: 'left' }, { kind: 'shift', side: 'right' }] })).toBeUndefined()
})

test('実機の設定: エンコーダーの編集は、その方向だけを変える。ほかの方向・レイヤー・キー・枠は、出発点のまま', () => {
  const source = cornixSnapshot()
  expect(source.encoders[0]).toEqual([[WHEEL_UP, WHEEL_DOWN], [WHEEL_DOWN, WHEEL_UP]])
  expect(source.encoders[1]).toEqual([[VOLUME_DOWN, VOLUME_UP], [WHEEL_UP, WHEEL_DOWN]])
  const target = structuredClone(source)
  applyEdits(target, turns(turn(0, 0, 'left', key(VOLUME_DOWN)), turn(1, 1, 'right', { kind: 'none' })))
  expect(target.encoders[0]).toEqual([[VOLUME_DOWN, WHEEL_DOWN], [WHEEL_DOWN, WHEEL_UP]])
  expect(target.encoders[1]).toEqual([[VOLUME_DOWN, VOLUME_UP], [WHEEL_UP, 0]])
  expect(target.encoders.slice(2)).toEqual(source.encoders.slice(2))
  expect({ ...target, encoders: source.encoders }).toEqual(source)
  // 出発点は書き換えない
  expect(source).toEqual(cornixSnapshot())
})

test('エンコーダーとキーの編集は、一緒に目標に入る', () => {
  const target = cornixSnapshot()
  applyEdits(target, { keys: [edit(0, 1, A_ESC)], encoders: [turn(2, 0, 'right', CTRL_C)], combos: [] })
  expect(target.keymap[0][1]).toBe(TD + 2)
  expect(target.tapDances[2]).toEqual(A_ESC_ENTRY)
  expect(target.encoders[2][0]).toEqual([VOLUME_DOWN, 0x0106])
})

test('Tap Dance を指していたエンコーダーを変えると、その枠は使われなくなり、空になる', () => {
  // 枠 2 は、エンコーダーだけが指している
  const source = altered((s) => {
    s.tapDances[2] = { ...A_ESC_ENTRY }
    s.encoders[4][1] = [TD + 2, WHEEL_DOWN]
  })
  expect(countFreeTapDances(source)).toBe(29)
  const plan = planKeyEdits(source, turns(turn(4, 1, 'left', key(WHEEL_UP))))
  expect(plan.encoders[4][1]).toEqual([WHEEL_UP, WHEEL_DOWN])
  expect(plan.tapDances[2]).toEqual(EMPTY)
  expect(plan.free).toBe(30)
  // 同じ枠を、ほかのエンコーダーかキーも指していれば、残る
  const shared = altered((s) => {
    s.tapDances[2] = { ...A_ESC_ENTRY }
    s.encoders[4][1] = [TD + 2, TD + 2]
  })
  const kept = planKeyEdits(shared, turns(turn(4, 1, 'left', key(WHEEL_UP))))
  expect(kept.tapDances[2]).toEqual(A_ESC_ENTRY)
  expect(kept.free).toBe(29)
  // エンコーダーを変えていなければ、キーが使わなくなっても、枠は残る
  const pointed = altered((s) => (s.encoders[4][1] = [TD + 1, WHEEL_DOWN]))
  expect(planKeyEdits(pointed, edits(edit(0, 54, { tap: B }))).tapDances[1]).toEqual(source.tapDances[1])
})

test('エンコーダーの編集で使われなくなった枠は、枠が要るキーの編集に使える', () => {
  // 空いている枠がなく、枠 31 はエンコーダーだけが指している
  const source = full((s) => {
    s.keymap[9][31] = 0
    s.encoders[4][1] = [TD + 31, WHEEL_DOWN]
  })
  expect(planKeyEdits(source, edits(edit(0, 1, A_ESC))).missing).toBe(1)
  const plan = planKeyEdits(source, { ...edits(edit(0, 1, A_ESC)), encoders: [turn(4, 1, 'left', key(WHEEL_UP))] })
  expect(plan.missing).toBe(0)
  expect(plan.keymap[0][1]).toBe(TD + 31)
  expect(plan.tapDances[31]).toEqual(A_ESC_ENTRY)
})

test('本体の設定に直せないエンコーダーの動作と、出発点にない場所の編集は、invalidEncoders として返し、目標は作れない', () => {
  const source = cornixSnapshot()
  const held = turn(0, 0, 'left', mo(1))
  const nowhere = turn(0, 5, 'left', A)
  const plan = planKeyEdits(source, turns(held, nowhere))
  expect(plan.invalidEncoders).toEqual([held, nowhere])
  expect(plan.encoders).toEqual(source.encoders)
  expect(() => applyEdits(structuredClone(source), turns(held))).toThrow('直せない')
})
