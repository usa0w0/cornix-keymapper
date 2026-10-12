import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import type { Action } from './action.ts'
import type { KeyBehavior } from './behavior.ts'
import { decodeKey, tapDanceIndexOf } from './decode.ts'
import type { Edits, KeyEdit } from './edits.ts'
import { applyEdits, countFreeTapDances, encodeBehavior, planKeyEdits, tapDanceUses } from './encode.ts'
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

test('枠が使われているかは、キーに加えて、エンコーダーとコンボの出力も数える', () => {
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

test('エンコーダーとコンボの編集は、まだ本体の設定に直せない', () => {
  const withEncoder: Edits = { ...edits(), encoders: [{ layer: 0, encoder: 0, direction: 'left', action: A }] }
  expect(() => applyEdits(cornixSnapshot(), withEncoder)).toThrow('まだない')
})
