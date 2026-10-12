import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { cornixSnapshot, createFakeCornix } from '../device/fake/cornix.ts'
import type { Action } from '../model/action.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { decodeKey } from '../model/decode.ts'
import { listChanges, writeOperations } from '../model/diff.ts'
import { EMPTY_EDITS, type Edits } from '../model/edits.ts'
import { customKeycodesOf, keycodeToAction } from '../model/keycodes.ts'
import {
  addCombo,
  buildTarget,
  comboKeyAt,
  comboList,
  combosOfKey,
  countEdits,
  editCombo,
  editEncoder,
  editKey,
  editKeysTogether,
  EMPTY_SESSION,
  hasUnwrittenChanges,
  isSourceReplaced,
  loadSnapshot,
  markWritten,
  reapplyEdits,
  replaceSource,
  revertAll,
  revertEdit,
  revertSource,
  sameSnapshot,
  planKeys,
  sessionReducer,
  sharedKeys,
  tryAddCombo,
  tryEditCombo,
  tryEditEncoder,
  tryEditKey,
  tryEditKeysTogether,
  tryRevertEdit,
  type EditSession,
  type EditState,
  type SessionAction,
} from './editState.ts'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const B: Action = { kind: 'key', code: 0x05, mods: [] }
const CTRL: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] }
const TAP_A_HOLD_CTRL: KeyBehavior = { tap: A, hold: CTRL }

/** 実機（Cornix LP）から読んだ設定に、手を加えた写し */
function altered(alter: (snapshot: KeyboardSnapshot) => void): KeyboardSnapshot {
  const snapshot = cornixSnapshot()
  alter(snapshot)
  return snapshot
}

/** その場所のキーの、出発点での動作 */
const behaviorAt = (snapshot: KeyboardSnapshot, layer: number, key: number) =>
  decodeKey(snapshot.keymap[layer][key], snapshot.tapDances, customKeycodesOf(snapshot.layout))

const run = (actions: SessionAction[], from: EditSession = EMPTY_SESSION) => actions.reduce(sessionReducer, from)

test('読み込んだ直後に、何も編集せずに作った目標は、基準のスナップショット全体と一致する（実機のデータ）', () => {
  const state = loadSnapshot(cornixSnapshot())
  // 編集がなければ、編集を本体の設定に直す処理は呼ばない
  const target = buildTarget(state, () => {
    throw new Error('呼ばれない')
  })
  expect(target.keymap).toEqual(state.baseline.keymap)
  expect(target.encoders).toEqual(state.baseline.encoders)
  expect(target.tapDances).toEqual(state.baseline.tapDances)
  expect(target.combos).toEqual(state.baseline.combos)
  expect(target).toEqual(state.baseline)
  expect(sameSnapshot(target, state.baseline)).toBe(true)
  // 目標は写し。書き換えても、基準と出発点は変わらない
  target.keymap[0][0] = 0x7777
  expect(state.source).toEqual(cornixSnapshot())
})

test('このサイトが解釈できないキーコードも、編集していなければ、目標にそのまま残る', () => {
  // マクロを呼ぶキー、表にない番号、本体にない枠を指す Tap Dance
  const snapshot = altered((s) => {
    s.keymap[0][1] = 0x7700
    s.keymap[0][2] = 0x00ff
    s.keymap[0][3] = 0x57ff
    s.encoders[0][0] = [0x5700, 0x7e03]
    s.combos[0] = { keys: [0x2204, 0x5701, 0, 0], output: 0x7701 }
  })
  expect(buildTarget(loadSnapshot(snapshot))).toEqual(snapshot)
})

test('目標を作る時、編集は、出発点の写しと一緒に、本体の設定に直す処理へ渡す。編集していない場所は出発点のまま', () => {
  const state = editKey(loadSnapshot(cornixSnapshot()), 0, 1, TAP_A_HOLD_CTRL)
  const seen: Edits[] = []
  const target = buildTarget(state, (draft, edits) => {
    seen.push(edits)
    draft.keymap[0][1] = 0x2104
  })
  expect(seen).toEqual([{ keys: [{ layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL }], encoders: [], combos: [] }])
  expect(target).toEqual(altered((s) => (s.keymap[0][1] = 0x2104)))
  expect(state.source).toEqual(cornixSnapshot())
  // 渡さなければ、model/encode.ts の処理を使う（タップ: A ／ 長押し: 左 Ctrl は MT）
  expect(buildTarget(state)).toEqual(altered((s) => (s.keymap[0][1] = 0x2104)))
})

test('キーの編集を足す: 利用者が変えたキーだけを持つ。同じキーをもう一度変えると、置き換える', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  expect(loaded.edits).toEqual(EMPTY_EDITS)
  expect(hasUnwrittenChanges(loaded)).toBe(false)

  const once = editKey(loaded, 0, 1, TAP_A_HOLD_CTRL)
  expect(once.edits.keys).toEqual([{ layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL }])
  expect(once.baseline).toBe(loaded.baseline)
  expect(once.source).toBe(loaded.source)
  expect(countEdits(once)).toBe(1)
  expect(hasUnwrittenChanges(once)).toBe(true)
  // 元の状態は変えない
  expect(loaded.edits.keys).toEqual([])

  const twice = editKey(editKey(once, 2, 9, { tap: B }), 0, 1, { tap: B })
  expect(twice.edits.keys).toEqual([
    { layer: 2, key: 9, behavior: { tap: B } },
    { layer: 0, key: 1, behavior: { tap: B } },
  ])
  expect(countEdits(twice)).toBe(2)
})

test('出発点と同じ内容に戻した編集は、編集として残さない', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const original = behaviorAt(loaded.source, 0, 1)
  const edited = editKey(loaded, 0, 1, TAP_A_HOLD_CTRL)
  expect(editKey(edited, 0, 1, original).edits).toEqual(EMPTY_EDITS)
  // 最初から同じ内容なら、状態は変わらない。値のない欄（undefined）は、ない欄と同じ
  expect(editKey(loaded, 0, 1, { ...original, doubleTap: undefined })).toBe(loaded)
  // Tap Dance のキーも、4欄に展開した内容で比べる
  const tapDanceKey = loaded.source.keymap.flat().indexOf(0x5700)
  const [layer, key] = [Math.floor(tapDanceKey / loaded.source.keymap[0].length), tapDanceKey % loaded.source.keymap[0].length]
  expect(editKey(loaded, layer, key, behaviorAt(loaded.source, layer, key))).toBe(loaded)
})

test('本体にない場所への編集は、受け付けない', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  expect(editKey(loaded, 99, 0, { tap: A })).toBe(loaded)
  expect(editKey(loaded, 0, 999, { tap: A })).toBe(loaded)
  expect(editEncoder(loaded, 0, 5, 'left', A)).toBe(loaded)
  expect(editCombo(loaded, { slot: 99 }, { keys: [4, 5], output: A })).toBe(loaded)
  expect(editCombo(loaded, { added: 0 }, { keys: [4, 5], output: A })).toBe(loaded)
})

test('エンコーダーの編集: 1方向ごとに、動作1つを持つ', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const edited = editEncoder(editEncoder(loaded, 0, 1, 'left', A), 0, 1, 'right', B)
  expect(edited.edits.encoders).toEqual([
    { layer: 0, encoder: 1, direction: 'left', action: A },
    { layer: 0, encoder: 1, direction: 'right', action: B },
  ])
  expect(countEdits(edited)).toBe(2)
  // 同じ方向をもう一度変えると置き換える。出発点と同じ動作に戻すと、なくなる
  expect(editEncoder(edited, 0, 1, 'left', B).edits.encoders).toContainEqual({ layer: 0, encoder: 1, direction: 'left', action: B })
  const original = keycodeToAction(loaded.source.encoders[0][1][0])
  expect(editEncoder(edited, 0, 1, 'left', original).edits.encoders).toEqual([
    { layer: 0, encoder: 1, direction: 'right', action: B },
  ])
})

test('コンボの編集: 位置ではなく、キーコードの組で持つ。足したコンボは、枠の番号を持たない', () => {
  const source = altered((s) => (s.combos[3] = { keys: [0x14, 0x1a, 0, 0], output: 0x29 }))
  const loaded = loadSnapshot(source)
  const added = addCombo(addCombo(loaded, { keys: [0x04, 0x05], output: A }), { keys: [0x2204, 0x5700, 0x06], output: B })
  expect(added.edits.combos).toEqual([
    { ref: { added: 0 }, combo: { keys: [0x04, 0x05], output: A } },
    { ref: { added: 1 }, combo: { keys: [0x2204, 0x5700, 0x06], output: B } },
  ])
  // 足したコンボの中身を変える。足したコンボを消すと、編集ごとなくなる。番号は、残りのコンボで変わらない
  const changed = editCombo(added, { added: 0 }, { keys: [0x04, 0x05], output: B })
  expect(changed.edits.combos[0]).toEqual({ ref: { added: 0 }, combo: { keys: [0x04, 0x05], output: B } })
  const removed = editCombo(changed, { added: 0 }, null)
  expect(removed.edits.combos).toEqual([{ ref: { added: 1 }, combo: { keys: [0x2204, 0x5700, 0x06], output: B } }])
  expect(addCombo(removed, { keys: [4, 5], output: A }).edits.combos.at(-1)!.ref).toEqual({ added: 2 })

  // 出発点にあるコンボは、枠の番号で指して、変える・消す
  const existing = editCombo(loaded, { slot: 3 }, { keys: [0x14, 0x1a], output: A })
  expect(existing.edits.combos).toEqual([{ ref: { slot: 3 }, combo: { keys: [0x14, 0x1a], output: A } }])
  expect(editCombo(existing, { slot: 3 }, null).edits.combos).toEqual([{ ref: { slot: 3 }, combo: null }])
  // 出発点と同じ内容に戻すと、なくなる。空の枠を「消す」のも、編集にならない
  expect(editCombo(existing, { slot: 3 }, { keys: [0x14, 0x1a], output: keycodeToAction(0x29) }).edits).toEqual(EMPTY_EDITS)
  expect(editCombo(loaded, { slot: 4 }, null)).toBe(loaded)
})

// 実機の設定のレイヤー 0: Q が キー 1、W が キー 2、B が キー 19 と 41、キー 6 は空、キー 26 は Tap Dance（枠 0）
const Q = 0x14
const W = 0x1a
const ESC: Action = { kind: 'key', code: 0x29, mods: [] }

test('コンボのキーにする時の持ち方: 編集していないキーは出発点のキーコード。空のキーと透過のキーは選べない', () => {
  const state = loadSnapshot(altered((s) => (s.keymap[1][1] = 0x0001)))
  expect(comboKeyAt(state, { layer: 0, key: 1 })).toBe(Q)
  // 長押しなどを設定したキーは、タップ側ではなく、そのキーのキーコード全体
  expect(comboKeyAt(state, { layer: 0, key: 26 })).toBe(0x5700)
  expect(comboKeyAt(state, { layer: 0, key: 6 })).toBeUndefined()
  expect(comboKeyAt(state, { layer: 1, key: 1 })).toBeUndefined()
  expect(comboKeyAt(state, { layer: 0, key: 999 })).toBeUndefined()
})

test('コンボのキーにする時の持ち方: 編集したキーは、枠を使わなければ動作から決まるキーコード、Tap Dance になるなら4欄の中身', () => {
  let state = loadSnapshot(cornixSnapshot())
  state = editKey(state, 0, 1, { tap: B })
  state = editKey(state, 0, 2, TAP_A_HOLD_CTRL)
  state = editKey(state, 0, 3, { tap: A, doubleTap: ESC })
  state = editKey(state, 0, 4, { tap: { kind: 'none' } })
  expect(comboKeyAt(state, { layer: 0, key: 1 })).toBe(0x05)
  expect(comboKeyAt(state, { layer: 0, key: 2 })).toBe(0x2104)
  expect(comboKeyAt(state, { layer: 0, key: 3 })).toEqual({ tapDance: { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0 } })
  expect(comboKeyAt(state, { layer: 0, key: 4 })).toBeUndefined()
  // 欄をすべて消したキーも、空のキー
  expect(comboKeyAt(editKey(state, 0, 5, {}), { layer: 0, key: 5 })).toBeUndefined()
})

test('コンボの一覧: 本体に入っているコンボ（枠の番号順）の後に、足したコンボ。消したコンボと空の枠は出さない', () => {
  const source = altered((s) => {
    s.combos[1] = { keys: [Q, W, 0, 0], output: 0x29 }
    s.combos[4] = { keys: [0x04, 0x5700, 0, 0], output: 0x5703 }
    s.combos[6] = { keys: [0x06, 0x07, 0, 0], output: 0x2a }
  })
  let state = loadSnapshot(source)
  expect(comboList(state)).toEqual([
    { ref: { slot: 1 }, combo: { keys: [Q, W], output: ESC }, keycodes: [Q, W], changed: false },
    // 出力が Tap Dance のコンボは、このサイトで扱わない動作として、元の値を保つ
    {
      ref: { slot: 4 },
      combo: { keys: [0x04, 0x5700], output: { kind: 'unsupported', raw: 0x5703, label: 'Tap Dance 3' } },
      keycodes: [0x04, 0x5700],
      changed: false,
    },
    { ref: { slot: 6 }, combo: { keys: [0x06, 0x07], output: keycodeToAction(0x2a) }, keycodes: [0x06, 0x07], changed: false },
  ])
  state = editCombo(state, { slot: 1 }, { keys: [Q, W, 0x08], output: ESC })
  state = editCombo(state, { slot: 6 }, null)
  // Tap Dance になるキーを、コンボのキーにする
  state = editKey(state, 0, 3, { tap: A, doubleTap: ESC })
  const pending = comboKeyAt(state, { layer: 0, key: 3 })!
  state = addCombo(state, { keys: [Q, pending], output: B })
  expect(comboList(state)).toEqual([
    { ref: { slot: 1 }, combo: { keys: [Q, W, 0x08], output: ESC }, keycodes: [Q, W, 0x08], changed: true },
    expect.objectContaining({ ref: { slot: 4 }, changed: false }),
    { ref: { added: 0 }, combo: { keys: [Q, pending], output: B }, keycodes: [Q, 0x5702], changed: true },
  ])
  expect(countEdits(state)).toBe(4)
  // 目標では、消した枠に、足したコンボが入るのではなく、空いている枠の小さい番号（0）に入る。消した枠は空になる
  const target = buildTarget(state)
  expect(target.combos[0]).toEqual({ keys: [Q, 0x5702, 0, 0], output: 0x05 })
  expect(target.combos[1]).toEqual({ keys: [Q, W, 0x08, 0], output: 0x29 })
  expect(target.combos[4]).toEqual(source.combos[4])
  expect(target.combos[6]).toEqual({ keys: [0, 0, 0, 0], output: 0 })
  expect(target.keymap[0][3]).toBe(0x5702)
})

test('コンボの枠が足りない追加と、本体の設定に直せないコンボは、状態に反映せずに止める', () => {
  const fullCombos = altered((s) => {
    s.combos = s.combos.map((_, slot) => ({ keys: [0x04, 0x05 + slot, 0, 0], output: 0x29 }))
  })
  const state = loadSnapshot(fullCombos)
  expect(planKeys(state).freeCombos).toBe(0)
  const stopped = tryAddCombo(state, { keys: [Q, W], output: A })
  expect(stopped.state).toBe(state)
  expect(stopped.blocked).toMatchObject({ missingCombos: 1 })
  expect(run([{ type: 'addCombo', combo: { keys: [Q, W], output: A } }], { edit: state, pending: null }).edit).toBe(state)
  // 1つ消せば、足せる。残り枠数は、編集に合わせて増減する
  const removed = tryEditCombo(state, { slot: 3 }, null)
  expect(removed.blocked).toBeNull()
  expect(planKeys(removed.state).freeCombos).toBe(1)
  const added = tryAddCombo(removed.state, { keys: [Q, W], output: A })
  expect(added.blocked).toBeNull()
  expect(planKeys(added.state).freeCombos).toBe(0)
  expect(buildTarget(added.state).combos[3]).toEqual({ keys: [Q, W, 0, 0], output: 0x04 })

  // 「押している間だけレイヤー N」は、コンボの出力に入れられない。キーが1個のコンボも作れない
  const loaded = loadSnapshot(cornixSnapshot())
  const momentary = tryAddCombo(loaded, { keys: [Q, W], output: { kind: 'layer', mode: 'momentary', layer: 1 } })
  expect(momentary.state).toBe(loaded)
  expect(momentary.blocked!.invalidCombos).toHaveLength(1)
  expect(tryAddCombo(loaded, { keys: [Q], output: A }).state).toBe(loaded)
})

test('出力が Tap Dance のコンボを消すと枠が空く。空いた枠をキーが使った後は、その取り消しを止める', () => {
  // Tap Dance の枠は、枠 2 だけが空いていて、枠 3 はコンボの出力だけが指している
  const source = altered((s) => {
    for (let slot = 3; slot < 32; slot++) s.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
    for (let slot = 4; slot < 32; slot++) s.keymap[9][slot] = 0x5700 + slot
    s.combos[0] = { keys: [Q, W, 0, 0], output: 0x5703 }
  })
  let state = loadSnapshot(source)
  expect(planKeys(state).free).toBe(1)
  state = tryEditCombo(state, { slot: 0 }, null).state
  expect(planKeys(state).free).toBe(2)
  state = tryEditKey(state, 0, 1, { tap: A, doubleTap: B }).state
  state = tryEditKey(state, 0, 2, { tap: B, doubleTap: A }).state
  expect(planKeys(state)).toMatchObject({ free: 0, missing: 0 })
  const reverted = tryRevertEdit(state, { kind: 'combo', ref: { slot: 0 } })
  expect(reverted.state).toBe(state)
  expect(reverted.blocked).toMatchObject({ missing: 1 })
})

test('そのキーを使っているコンボの数は、位置ではなく、キーコードで数える。動作を変えた後は、働かなくなったコンボの数を出す', () => {
  // B は、レイヤー 0 に2つある（キー 19 と 41）
  const source = altered((s) => {
    s.combos[0] = { keys: [0x05, Q, 0, 0], output: 0x29 }
    s.combos[1] = { keys: [0x05, W, 0x08, 0], output: 0x2a }
    s.combos[2] = { keys: [0x5700, Q, 0, 0], output: 0x2a }
  })
  let state = loadSnapshot(source)
  expect(combosOfKey(state, { layer: 0, key: 19 })).toEqual({ used: 2, broken: 0 })
  expect(combosOfKey(state, { layer: 0, key: 41 })).toEqual({ used: 2, broken: 0 })
  expect(combosOfKey(state, { layer: 0, key: 1 })).toEqual({ used: 2, broken: 0 })
  expect(combosOfKey(state, { layer: 0, key: 26 })).toEqual({ used: 1, broken: 0 })
  // 空のキーと、コンボにないキー
  expect(combosOfKey(state, { layer: 0, key: 6 })).toEqual({ used: 0, broken: 0 })
  expect(combosOfKey(state, { layer: 0, key: 4 })).toEqual({ used: 0, broken: 0 })
  expect(combosOfKey(state, { layer: 0, key: 999 })).toEqual({ used: 0, broken: 0 })
  // キーの動作を変えると、変える前の中身を使っていたコンボが、そのキーでは働かなくなる。同じ中身のほかのキーは、そのまま
  state = editKey(state, 0, 19, { tap: A })
  expect(combosOfKey(state, { layer: 0, key: 19 })).toEqual({ used: 0, broken: 2 })
  expect(combosOfKey(state, { layer: 0, key: 41 })).toEqual({ used: 2, broken: 0 })
  // 変えた後の中身でも当たり続けるコンボは、働かなくなる数に入れない（Q に変えると、B と Q のコンボには当たる）
  state = editKey(state, 0, 19, { tap: { kind: 'key', code: Q, mods: [] } })
  expect(combosOfKey(state, { layer: 0, key: 19 })).toEqual({ used: 2, broken: 1 })
  // 働かなくなったコンボを消すと、数が減る。変更を取り消すと、元に戻る
  state = editCombo(state, { slot: 1 }, null)
  expect(combosOfKey(state, { layer: 0, key: 19 })).toEqual({ used: 2, broken: 0 })
  expect(combosOfKey(revertEdit(state, { kind: 'key', layer: 0, key: 19 }), { layer: 0, key: 19 })).toEqual({ used: 1, broken: 0 })
})

test('Tap Dance のキーの動作を変えた時も、変える前のキーコードを使っていたコンボを、働かなくなった数に入れる', () => {
  // キー 26 は枠 0 を指す。レイヤー 1 と 2 にも、同じ枠を指すキーがある
  const source = altered((s) => (s.combos[0] = { keys: [0x5700, Q, 0, 0], output: 0x29 }))
  let state = loadSnapshot(source)
  state = editKey(state, 0, 26, { tap: A, doubleTap: ESC })
  expect(combosOfKey(state, { layer: 0, key: 26 })).toEqual({ used: 0, broken: 1 })
  expect(combosOfKey(state, { layer: 1, key: 26 })).toEqual({ used: 1, broken: 0 })
  // 変えた後のキーを、コンボのキーにすると、そのコンボには使われている
  state = addCombo(state, { keys: [W, comboKeyAt(state, { layer: 0, key: 26 })!], output: B })
  expect(combosOfKey(state, { layer: 0, key: 26 })).toEqual({ used: 1, broken: 1 })
})

test('編集を取り消す: その場所の編集だけがなくなる', () => {
  let state = loadSnapshot(cornixSnapshot())
  state = editKey(state, 0, 1, TAP_A_HOLD_CTRL)
  state = editKey(state, 1, 1, { tap: B })
  state = editEncoder(state, 0, 0, 'right', A)
  state = addCombo(state, { keys: [4, 5], output: A })
  expect(countEdits(state)).toBe(4)

  const withoutKey = revertEdit(state, { kind: 'key', layer: 0, key: 1 })
  expect(withoutKey.edits.keys).toEqual([{ layer: 1, key: 1, behavior: { tap: B } }])
  expect(withoutKey.edits.encoders).toEqual(state.edits.encoders)
  expect(revertEdit(state, { kind: 'encoder', layer: 0, encoder: 0, direction: 'right' }).edits.encoders).toEqual([])
  expect(revertEdit(state, { kind: 'combo', ref: { added: 0 } }).edits.combos).toEqual([])
  // 編集していない場所を取り消しても、変わらない
  expect(revertEdit(state, { kind: 'key', layer: 5, key: 5 })).toBe(state)

  const none = [
    { kind: 'key', layer: 0, key: 1 } as const,
    { kind: 'key', layer: 1, key: 1 } as const,
    { kind: 'encoder', layer: 0, encoder: 0, direction: 'right' } as const,
    { kind: 'combo', ref: { added: 0 } } as const,
  ].reduce(revertEdit, state)
  expect(none.edits).toEqual(EMPTY_EDITS)
  expect(hasUnwrittenChanges(none)).toBe(false)
  expect(buildTarget(none)).toEqual(cornixSnapshot())
})

test('出発点を入れ替える: 基準は変えず、編集は新しい出発点の上に残す。全体を1件として取り消せる', () => {
  const loaded = editKey(editKey(loadSnapshot(cornixSnapshot()), 0, 1, TAP_A_HOLD_CTRL), 0, 2, { tap: B })
  // 読み込んだ .vil では、レイヤー 3 のキーが違い、レイヤー 0 のキー 2 は、編集と同じ B になっている
  const fromFile = altered((s) => {
    s.keymap[3][4] = 0x0006
    s.keymap[0][2] = 0x0005
  })
  const replaced = replaceSource(loaded, fromFile)
  expect(replaced.baseline).toEqual(cornixSnapshot())
  expect(replaced.source).toBe(fromFile)
  expect(isSourceReplaced(replaced)).toBe(true)
  // 新しい出発点と同じ内容になった編集は、なくなる
  expect(replaced.edits.keys).toEqual([{ layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL }])
  // 入れ替えは、全体で1件に数える
  expect(countEdits(replaced)).toBe(2)
  // 目標は、基準ではなく出発点から作る
  expect(buildTarget({ ...replaced, edits: EMPTY_EDITS })).toEqual(fromFile)

  const reverted = revertSource(replaced)
  expect(reverted.source).toBe(reverted.baseline)
  expect(isSourceReplaced(reverted)).toBe(false)
  expect(reverted.edits.keys).toEqual([{ layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL }])

  // 編集がなくても、入れ替えた出発点は、まだ本体に書いていない内容
  const onlyReplaced = replaceSource(loadSnapshot(cornixSnapshot()), fromFile)
  expect(hasUnwrittenChanges(onlyReplaced)).toBe(true)
  expect(countEdits(onlyReplaced)).toBe(1)
  // 基準と同じ内容を読み込んだ時は、入れ替えていないことにする
  expect(isSourceReplaced(replaceSource(onlyReplaced, cornixSnapshot()))).toBe(false)
})

test('書き込みと照合が通った後: 読み直した内容が新しい基準になり、編集はなくなる', () => {
  const verified = altered((s) => (s.keymap[0][1] = 0x2104))
  const written = markWritten(verified)
  expect(written).toEqual({ baseline: verified, source: verified, edits: EMPTY_EDITS })
  expect(hasUnwrittenChanges(written)).toBe(false)
})

test('読み直した内容に編集を当て直す: 基準と出発点が読み直した内容になり、同じ内容になった編集はなくなる', () => {
  const state = editKey(editKey(loadSnapshot(cornixSnapshot()), 0, 1, TAP_A_HOLD_CTRL), 0, 2, { tap: B })
  // ほかのアプリで、レイヤー 1 のキーと、編集したキー 2（編集と同じ B に）が変えられていた
  const fresh = altered((s) => {
    s.keymap[1][0] = 0x0007
    s.keymap[0][2] = 0x0005
  })
  const reapplied = reapplyEdits(state, fresh)
  expect(reapplied.baseline).toBe(fresh)
  expect(reapplied.source).toBe(fresh)
  expect(reapplied.edits.keys).toEqual([{ layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL }])

  // 出発点を入れ替えていた時は、出発点（読み込んだ .vil などの内容）を残し、基準だけを読み直した内容にする
  const fromFile = altered((s) => (s.keymap[3][4] = 0x0006))
  const replaced = reapplyEdits(replaceSource(state, fromFile), fresh)
  expect(replaced.baseline).toBe(fresh)
  expect(replaced.source).toBe(fromFile)
  expect(replaced.edits.keys).toHaveLength(2)
})

test('最初の読み出し: 読んだ内容が基準と出発点になる。読み出す前は、編集を受け付けない', () => {
  const before = run([{ type: 'editKey', layer: 0, key: 1, behavior: { tap: A } }])
  expect(before).toBe(EMPTY_SESSION)
  const session = run([{ type: 'read', snapshot: cornixSnapshot() }])
  expect(session.pending).toBeNull()
  expect(session.edit).toEqual(loadSnapshot(cornixSnapshot()))
  expect(session.edit!.source).toBe(session.edit!.baseline)
})

test('つなぎ直して読み直した内容が基準と同じなら、編集をそのまま続ける', () => {
  const edited = run([
    { type: 'read', snapshot: cornixSnapshot() },
    { type: 'editKey', layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL },
    { type: 'editEncoder', layer: 0, encoder: 0, direction: 'left', action: A },
  ])
  const again = run([{ type: 'read', snapshot: cornixSnapshot() }], edited)
  expect(again.pending).toBeNull()
  expect(again.edit).toBe(edited.edit)
  expect(countEdits(again.edit!)).toBe(2)
})

test('編集がなければ、本体の内容が変わっていても、別の機器でも、聞かずに読み直した内容にする', () => {
  const loaded = run([{ type: 'read', snapshot: cornixSnapshot() }])
  const fresh = altered((s) => (s.keymap[1][0] = 0x0007))
  expect(run([{ type: 'read', snapshot: fresh }], loaded)).toEqual({ edit: loadSnapshot(fresh), pending: null })
  const other = altered((s) => (s.uid = 'ほかの機器'))
  expect(run([{ type: 'read', snapshot: other }], loaded)).toEqual({ edit: loadSnapshot(other), pending: null })
  // 同じ内容なら、状態をそのまま使う
  expect(run([{ type: 'read', snapshot: cornixSnapshot() }], loaded).edit).toBe(loaded.edit)
})

test('つなぎ直した時に本体の内容が変わっていたら、選択待ちにする。答えが出るまで、編集中の状態は変えない', () => {
  const edited = run([
    { type: 'read', snapshot: cornixSnapshot() },
    { type: 'editKey', layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL },
  ])
  const fresh = altered((s) => (s.keymap[1][0] = 0x0007))
  const waiting = run([{ type: 'read', snapshot: fresh }], edited)
  expect(waiting.pending).toEqual({ reason: 'changed', fresh })
  expect(waiting.edit).toBe(edited.edit)
  // 選択待ちの間は、編集を受け付けない
  expect(run([{ type: 'editKey', layer: 0, key: 2, behavior: { tap: B } }], waiting)).toBe(waiting)

  // 当て直す: 読み直した内容が基準になり、編集は残る
  const reapplied = run([{ type: 'resolve', choice: 'reapply' }], waiting)
  expect(reapplied.pending).toBeNull()
  expect(reapplied.edit!.baseline).toBe(fresh)
  expect(reapplied.edit!.source).toBe(fresh)
  expect(reapplied.edit!.edits.keys).toEqual([{ layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL }])

  // 捨てる: 読み直した内容だけになる
  expect(run([{ type: 'resolve', choice: 'discard' }], waiting)).toEqual({ edit: loadSnapshot(fresh), pending: null })

  // やめる: 編集中の状態はそのまま
  expect(run([{ type: 'resolve', choice: 'cancel' }], waiting)).toEqual({ edit: edited.edit, pending: null })
})

test('別の機器（UID が違う）をつないだら、編集を捨てる前に確認する。編集は、当て直せない', () => {
  const edited = run([
    { type: 'read', snapshot: cornixSnapshot() },
    { type: 'editKey', layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL },
  ])
  // 中身が同じでも、UID が違えば別の機器
  const other = altered((s) => (s.uid = 'ほかの機器'))
  const waiting = run([{ type: 'read', snapshot: other }], edited)
  expect(waiting.pending).toEqual({ reason: 'other-device', fresh: other })
  expect(waiting.edit).toBe(edited.edit)

  expect(run([{ type: 'resolve', choice: 'reapply' }], waiting)).toBe(waiting)
  expect(run([{ type: 'resolve', choice: 'cancel' }], waiting)).toEqual({ edit: edited.edit, pending: null })
  expect(run([{ type: 'resolve', choice: 'discard' }], waiting)).toEqual({ edit: loadSnapshot(other), pending: null })
})

test('出発点を入れ替えただけ（編集なし）でも、本体の内容が変わっていたら選択待ちにする', () => {
  const fromFile = altered((s) => (s.keymap[3][4] = 0x0006))
  const replaced = run([
    { type: 'read', snapshot: cornixSnapshot() },
    { type: 'replaceSource', source: fromFile },
  ])
  const fresh = altered((s) => (s.keymap[1][0] = 0x0007))
  expect(run([{ type: 'read', snapshot: fresh }], replaced).pending?.reason).toBe('changed')
})

test('選択待ちがない時の答えと、取り消しなどの操作は、reducer からも同じ結果になる', () => {
  const loaded = run([{ type: 'read', snapshot: cornixSnapshot() }])
  expect(run([{ type: 'resolve', choice: 'discard' }], loaded)).toBe(loaded)
  const session = run(
    [
      { type: 'editKey', layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL },
      { type: 'addCombo', combo: { keys: [4, 5], output: A } },
      { type: 'editCombo', ref: { added: 0 }, combo: { keys: [4, 5], output: B } },
      { type: 'revert', place: { kind: 'key', layer: 0, key: 1 } },
    ],
    loaded,
  )
  expect(session.edit!.edits).toEqual({ keys: [], encoders: [], combos: [{ ref: { added: 0 }, combo: { keys: [4, 5], output: B } }] })
  const verified = altered((s) => (s.combos[0] = { keys: [4, 5, 0, 0], output: 5 }))
  expect(run([{ type: 'written', verified }], session)).toEqual({ edit: loadSnapshot(verified), pending: null })
  // 何も変わらない操作では、同じ状態を返す（画面を描き直さない）
  expect(run([{ type: 'revert', place: { kind: 'key', layer: 0, key: 1 } }], loaded)).toBe(loaded)
  expect(run([{ type: 'revertSource' }], loaded).edit).toEqual(loaded.edit)
})

test('偽の機器: 切断してつなぎ直しても編集が残る。本体が書き換えられていたら選択待ちになる', async () => {
  const keyboard = createFakeCornix()
  let session = EMPTY_SESSION
  const readFrom = async () => {
    const device = await keyboard.connect()
    session = sessionReducer(session, { type: 'read', snapshot: await device.read() })
  }

  await readFrom()
  session = sessionReducer(session, { type: 'editKey', layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL })

  // 接続が切れても、編集中の状態は何も変わらない。つなぎ直して読み直すと、基準と同じなので、そのまま続く
  keyboard.loseConnection()
  const before = session
  await readFrom()
  expect(session).toBe(before)
  expect(countEdits(session.edit!)).toBe(1)

  // 切れている間に、ほかから本体の設定が変えられた
  keyboard.loseConnection()
  keyboard.snapshot.keymap[1][0] = 0x0007
  await readFrom()
  expect(session.pending?.reason).toBe('changed')
  session = sessionReducer(session, { type: 'resolve', choice: 'reapply' })
  expect(session.edit!.baseline).toEqual(keyboard.snapshot)
  expect(session.edit!.edits.keys).toEqual([{ layer: 0, key: 1, behavior: TAP_A_HOLD_CTRL }])

  // 別の機器につないだ
  keyboard.loseConnection()
  keyboard.snapshot.uid = 'ほかの機器'
  await readFrom()
  expect(session.pending?.reason).toBe('other-device')
})

// ---- Tap Dance の枠の割り当てと、枠が足りない編集 ----

const A_ESC: KeyBehavior = { tap: A, doubleTap: ESC }
const B_ESC: KeyBehavior = { tap: B, doubleTap: ESC }

/** 空いている枠がない設定。枠 2〜31 に別々の中身を入れ、レイヤー 9 のキーから1つずつ指す */
const full = (alter: (snapshot: KeyboardSnapshot) => void = () => {}) =>
  altered((s) => {
    for (let slot = 2; slot < 32; slot++) {
      s.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
      s.keymap[9][slot] = 0x5700 + slot
    }
    alter(s)
  })

test('実機の設定: 欄の増減で機能が切り替わり、残り枠数が増減する。目標は、編集したキーと、その枠だけが変わる', () => {
  let state = loadSnapshot(cornixSnapshot())
  expect(planKeys(state).free).toBe(30)
  // タップだけのキーに、長押しを足す（MT）。枠は使わない
  state = editKey(state, 0, 1, TAP_A_HOLD_CTRL)
  expect(planKeys(state).free).toBe(30)
  // 2回タップを足す（Tap Dance）。枠を1つ使う
  state = editKey(state, 0, 1, { ...TAP_A_HOLD_CTRL, doubleTap: ESC })
  expect(planKeys(state).free).toBe(29)
  expect(buildTarget(state)).toEqual(
    altered((s) => {
      s.keymap[0][1] = 0x5702
      s.tapDances[2] = { onTap: 0x04, onHold: 0xe0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 }
    }),
  )
  // 2回タップを消すと、枠が戻る
  state = editKey(state, 0, 1, TAP_A_HOLD_CTRL)
  expect(planKeys(state).free).toBe(30)
  expect(buildTarget(state)).toEqual(altered((s) => (s.keymap[0][1] = 0x2104)))
  // Tap Dance のキー（枠 1 を1つだけで使っている）の長押しを消すと、通常のキーになり、枠が空く
  state = editKey(state, 0, 54, { tap: B })
  expect(planKeys(state).free).toBe(31)
  expect(buildTarget(state).tapDances[1]).toEqual({ onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 })
  // 取り消すと、元に戻る
  state = revertEdit(revertEdit(state, { kind: 'key', layer: 0, key: 54 }), { kind: 'key', layer: 0, key: 1 })
  expect(buildTarget(state)).toEqual(cornixSnapshot())
})

test('読んだ時のままのキーに、同じ内容を入れ直しても、編集にならない（Tap Dance のキーも、MT に変わらない）', () => {
  const state = loadSnapshot(cornixSnapshot())
  // レイヤー 0 のキー 26 は、Tap Dance の枠 0（タップ: Space ／ 長押し: 左 GUI）。MT でも書ける内容
  const same = behaviorAt(state.source, 0, 26)
  const result = tryEditKey(state, 0, 26, same)
  expect(result).toEqual({ state, blocked: null })
  expect(result.state).toBe(state)
  expect(buildTarget(result.state).keymap[0][26]).toBe(0x5700)
})

test('枠が足りなくなる編集は、状態に反映せずに止め、当てはめた場合の結果を返す', () => {
  const state = loadSnapshot(full())
  const result = tryEditKey(state, 0, 1, A_ESC)
  expect(result.state).toBe(state)
  expect(result.blocked).toMatchObject({ missing: 1, overwritable: 0 })
  expect(result.blocked!.unplaced).toEqual([{ layer: 0, key: 1, behavior: A_ESC }])
  // 画面から送られても、反映しない
  const session = run([{ type: 'read', snapshot: full() }, { type: 'editKey', layer: 0, key: 1, behavior: A_ESC }])
  expect(session.edit!.edits).toEqual(EMPTY_EDITS)
  // 枠を使わない編集と、枠を空ける編集は通る。空いた枠は、次の編集で使える
  const freed = tryEditKey(state, 0, 54, { tap: B })
  expect(freed.blocked).toBeNull()
  const reused = tryEditKey(freed.state, 0, 1, A_ESC)
  expect(reused.blocked).toBeNull()
  expect(buildTarget(reused.state).keymap[0][1]).toBe(0x5701)
  // もう1つ枠が要る編集は、止まる
  expect(tryEditKey(reused.state, 0, 2, B_ESC).blocked).toMatchObject({ missing: 1 })
  // 空いた枠をほかのキーが使った後で、枠を空けた編集を取り消すと、足りなくなるので、止まる
  const place = { kind: 'key', layer: 0, key: 54 } as const
  const reverted = tryRevertEdit(reused.state, place)
  expect(reverted.state).toBe(reused.state)
  expect(reverted.blocked).toMatchObject({ missing: 1 })
  const held = { edit: reused.state, pending: null }
  expect(sessionReducer(held, { type: 'revert', place })).toBe(held)
  // 枠を使っているほうを先に取り消せば、取り消せる
  const first = tryRevertEdit(reused.state, { kind: 'key', layer: 0, key: 1 })
  expect(first.blocked).toBeNull()
  expect(tryRevertEdit(first.state, place)).toMatchObject({ blocked: null, state: { edits: EMPTY_EDITS } })
})

test('中身はあるが使われていない枠は、利用者が認めた時だけ上書きして使う。認めたことは、キーの編集がある間だけ持つ', () => {
  const state = loadSnapshot(full((s) => (s.keymap[9][31] = 0)))
  const blocked = tryEditKey(state, 0, 1, A_ESC)
  expect(blocked.blocked).toMatchObject({ missing: 1, overwritable: 1 })
  const allowed = tryEditKey(state, 0, 1, A_ESC, true)
  expect(allowed.blocked).toBeNull()
  expect(allowed.state.edits.overwriteUnusedTapDances).toBe(true)
  expect(buildTarget(allowed.state).keymap[0][1]).toBe(0x571f)
  expect(buildTarget(allowed.state).tapDances[31]).toEqual({ onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 })
  // ほかの編集を足しても、認めたことは残る
  const more = editKey(allowed.state, 0, 2, { tap: A })
  expect(more.edits.overwriteUnusedTapDances).toBe(true)
  expect(countEdits(more)).toBe(2)
  // キーの編集がなくなったら、なくなる。編集のない状態に戻る
  const reverted = revertEdit(revertEdit(more, { kind: 'key', layer: 0, key: 1 }), { kind: 'key', layer: 0, key: 2 })
  expect(reverted.edits).toEqual(EMPTY_EDITS)
  expect(hasUnwrittenChanges(reverted)).toBe(false)
  // 読み直した内容に当て直す時は、持ち越さない（前の内容を見て出した答えなので）。枠が足りない状態になる
  const fresh = full((s) => {
    s.keymap[9][31] = 0
    s.keymap[1][0] = 0x0007
  })
  const reapplied = reapplyEdits(allowed.state, fresh)
  expect(reapplied.edits).toEqual({ keys: [{ layer: 0, key: 1, behavior: A_ESC }], encoders: [], combos: [] })
  expect(planKeys(reapplied)).toMatchObject({ missing: 1, overwritable: 1 })
  expect(replaceSource(allowed.state, fresh).edits.overwriteUnusedTapDances).toBeUndefined()
  // 画面からは、編集と一緒に送る
  const session = run([
    { type: 'read', snapshot: state.source },
    { type: 'editKey', layer: 0, key: 1, behavior: A_ESC, overwriteUnused: true },
  ])
  expect(session.edit!.edits).toEqual({ keys: [{ layer: 0, key: 1, behavior: A_ESC }], encoders: [], combos: [], overwriteUnusedTapDances: true })
})

test('読み直した内容に編集を当て直して、枠が足りなくなった時: 枠を増やす編集は止め、減らす編集は通す', () => {
  // 編集した後で、ほかから本体の枠がすべて埋められた
  const edited = editKey(editKey(loadSnapshot(cornixSnapshot()), 0, 1, A_ESC), 0, 2, B_ESC)
  const state = reapplyEdits(edited, full())
  expect(planKeys(state)).toMatchObject({ missing: 2, free: 0 })
  expect(() => buildTarget(state)).toThrow('足りない')
  // 枠が要るキーを、さらに足すことはできない
  expect(tryEditKey(state, 0, 3, { tap: B, tapHold: ESC }).blocked).toMatchObject({ missing: 3 })
  // 足りない数が増えない編集は通る
  const fewer = tryEditKey(state, 0, 2, { tap: B })
  expect(fewer.blocked).toBeNull()
  expect(planKeys(fewer.state).missing).toBe(1)
  const none = revertEdit(fewer.state, { kind: 'key', layer: 0, key: 1 })
  expect(planKeys(none).missing).toBe(0)
  expect(buildTarget(none).keymap[0][2]).toBe(0x0005)
})

// ---- 共有中のキー（同じ Tap Dance の枠を指しているキー） ----

const SPACE: Action = { kind: 'key', code: 0x2c, mods: [] }
const GUI: Action = { kind: 'key', mods: [{ kind: 'gui', side: 'left' }] }
const SPACE_GUI_ESC: KeyBehavior = { tap: SPACE, hold: GUI, doubleTap: ESC }
/** 実機の設定で、Tap Dance の枠 0（タップ Space ／ 長押し 左 GUI）を指している、レイヤー 0・1・2 のキー */
const SLOT0 = [
  { layer: 0, key: 26 },
  { layer: 1, key: 26 },
  { layer: 1, key: 54 },
  { layer: 2, key: 26 },
]

test('共有: 実機の設定で、枠 0 を指す4つのキーは、どれから見ても、同じ4つを共有している', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  for (const place of SLOT0) expect(sharedKeys(loaded, place)).toEqual(SLOT0)
  // 枠 1 を指すキーは1つだけ。枠を使わないキーも、共有ではない
  expect(sharedKeys(loaded, { layer: 0, key: 54 })).toEqual([])
  expect(sharedKeys(loaded, { layer: 0, key: 1 })).toEqual([])
  expect(sharedKeys(loaded, { layer: 0, key: 999 })).toEqual([])
})

test('共有: 枠を使わない機能（MT）で同じ内容になっているキーは、共有ではない', () => {
  const state = editKey(editKey(loadSnapshot(cornixSnapshot()), 0, 1, TAP_A_HOLD_CTRL), 0, 2, TAP_A_HOLD_CTRL)
  expect(sharedKeys(state, { layer: 0, key: 1 })).toEqual([])
  expect(sharedKeys(state, { layer: 0, key: 2 })).toEqual([])
})

test('共有: この画面の編集で同じ内容になり、同じ枠を使うことになったキーも、共有している', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const two = editKey(editKey(loaded, 0, 1, A_ESC), 3, 2, A_ESC)
  expect(sharedKeys(two, { layer: 0, key: 1 })).toEqual([{ layer: 0, key: 1 }, { layer: 3, key: 2 }])
  // 出発点にある枠と同じ内容にしたキーは、その枠を指すキーに加わる
  const withSlot = loadSnapshot(
    altered((s) => {
      s.tapDances[2] = { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 }
      s.keymap[9][2] = 0x5702
    }),
  )
  expect(sharedKeys(withSlot, { layer: 9, key: 2 })).toEqual([])
  expect(sharedKeys(editKey(withSlot, 0, 1, A_ESC), { layer: 9, key: 2 })).toEqual([{ layer: 0, key: 1 }, { layer: 9, key: 2 }])
  // 枠 0 と同じ内容（タップ Space ／ 長押し 左 GUI）にしたキーは、MT になり、枠を使わないので、共有に加わらない
  const mt = editKey(loaded, 0, 1, { tap: SPACE, hold: GUI })
  expect(sharedKeys(mt, { layer: 0, key: 1 })).toEqual([])
  expect(sharedKeys(mt, { layer: 0, key: 26 })).toEqual(SLOT0)
  // 1つだけを別の内容にしたキーは、共有から外れる
  const split = editKey(loaded, 1, 54, SPACE_GUI_ESC)
  expect(sharedKeys(split, { layer: 1, key: 54 })).toEqual([])
  expect(sharedKeys(split, { layer: 0, key: 26 })).toEqual(SLOT0.filter((place) => place.key !== 54))
})

test('共有: 枠を割り当てられていないキー（枠が足りない時）は、共有に数えない', () => {
  // 枠が1つもない本体に、読み直しの後で、枠が要る編集が2つ残った状態
  const none = altered((s) => {
    s.tapDances = []
    s.capabilities.tapDanceCount = 0
  })
  const state = { ...editKey(editKey(loadSnapshot(cornixSnapshot()), 0, 1, A_ESC), 0, 2, A_ESC), source: none }
  expect(planKeys(state).missing).toBe(1)
  expect(sharedKeys(state, { layer: 0, key: 1 })).toEqual([])
})

test('連動して変更: 同じ枠を指すキーすべてが同じ内容になり、枠は増えない。まとめて1件として数える', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  expect(planKeys(loaded).free).toBe(30)
  const { state, blocked } = tryEditKeysTogether(loaded, SLOT0, SPACE_GUI_ESC)
  expect(blocked).toBeNull()
  expect(state.edits.keys).toEqual(SLOT0.map((place) => ({ ...place, behavior: SPACE_GUI_ESC, link: 0 })))
  expect(countEdits(state)).toBe(1)
  // 4つとも同じ枠（空いていた枠 2）を指す。元の枠 0 は空になり、使っている枠の数は変わらない。ほかのキーと枠は変わらない
  expect(buildTarget(state)).toEqual(
    altered((s) => {
      for (const { layer, key } of SLOT0) s.keymap[layer][key] = 0x5702
      s.tapDances[2] = { onTap: 0x2c, onHold: 0xe3, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 }
      s.tapDances[0] = { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 }
    }),
  )
  expect(planKeys(state).free).toBe(30)
  expect(sharedKeys(state, SLOT0[0])).toEqual(SLOT0)
})

test('連動して変更: 枠を使わない内容にすれば、4つとも通常のキーになり、枠が1つ空く', () => {
  const state = editKeysTogether(loadSnapshot(cornixSnapshot()), SLOT0, { tap: SPACE })
  const target = buildTarget(state)
  for (const { layer, key } of SLOT0) expect(target.keymap[layer][key]).toBe(0x2c)
  expect(planKeys(state).free).toBe(31)
  expect(countEdits(state)).toBe(1)
})

test('連動して変更: どのキーから取り消しても、まとめて元に戻る', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const state = editKey(editKeysTogether(loaded, SLOT0, SPACE_GUI_ESC), 0, 1, { tap: B })
  expect(countEdits(state)).toBe(2)
  const reverted = tryRevertEdit(state, { kind: 'key', layer: 1, key: 54 }).state
  expect(reverted.edits.keys).toEqual([{ layer: 0, key: 1, behavior: { tap: B } }])
  expect(countEdits(reverted)).toBe(1)
  // 連動していないキーの取り消しは、そのキーだけ
  expect(revertEdit(state, { kind: 'key', layer: 0, key: 1 }).edits.keys).toHaveLength(4)
  // 連動して元の内容に戻したら、編集は残らない
  expect(editKeysTogether(state, SLOT0, { tap: SPACE, hold: GUI }).edits.keys).toEqual([{ layer: 0, key: 1, behavior: { tap: B } }])
})

test('連動して変更: 同じ組をもう一度変えても、1件のまま。組の1つだけを変えると、そのキーは組から外れて、別の1件になる', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const once = editKeysTogether(loaded, SLOT0, SPACE_GUI_ESC)
  const twice = editKeysTogether(once, SLOT0, { tap: SPACE, hold: CTRL })
  expect(twice.edits.keys).toEqual(SLOT0.map((place) => ({ ...place, behavior: { tap: SPACE, hold: CTRL }, link: 0 })))
  expect(countEdits(twice)).toBe(1)
  // 同じ内容でもう一度変えても、状態は変わらない（画面を描き直さない）
  expect(editKeysTogether(twice, SLOT0, { tap: SPACE, hold: CTRL })).toBe(twice)

  const split = editKey(twice, 1, 26, { tap: A })
  expect(countEdits(split)).toBe(2)
  expect(split.edits.keys.find((edit) => edit.layer === 1 && edit.key === 26)).toEqual({ layer: 1, key: 26, behavior: { tap: A } })
  // 外れたキーの取り消しは、そのキーだけ。残りの3つは、まとめて取り消す
  expect(revertEdit(split, { kind: 'key', layer: 1, key: 26 }).edits.keys).toHaveLength(3)
  expect(revertEdit(split, { kind: 'key', layer: 0, key: 26 }).edits.keys).toEqual([{ layer: 1, key: 26, behavior: { tap: A } }])
  // 別の組には、別の番号が付く
  const other = editKeysTogether(twice, [{ layer: 0, key: 1 }, { layer: 0, key: 2 }], A_ESC)
  expect(other.edits.keys.slice(4).map((edit) => edit.link)).toEqual([1, 1])
  expect(countEdits(other)).toBe(2)
})

test('このキーだけ変更: 選んだキーだけが変わり、内容が分かれるので、枠が1つ増える', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const { state, blocked } = tryEditKey(loaded, 1, 54, SPACE_GUI_ESC)
  expect(blocked).toBeNull()
  const target = buildTarget(state)
  expect(target.keymap[1][54]).toBe(0x5702)
  for (const { layer, key } of SLOT0.filter((place) => place.key !== 54)) expect(target.keymap[layer][key]).toBe(0x5700)
  expect(target.tapDances[0]).toEqual(loaded.source.tapDances[0])
  expect(planKeys(state).free).toBe(29)
  expect(countEdits(state)).toBe(1)
})

test('空いている枠がない時: 「このキーだけ変更」は止まり、「連動して変更」は、空く枠を使うので通る', () => {
  // 枠 2〜31 を、レイヤー 9 のキーから1つずつ使う
  const loaded = loadSnapshot(
    altered((s) => {
      for (let slot = 2; slot < 32; slot++) {
        s.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
        s.keymap[9][slot] = 0x5700 + slot
      }
    }),
  )
  expect(planKeys(loaded).free).toBe(0)
  const alone = tryEditKey(loaded, 1, 54, SPACE_GUI_ESC)
  expect(alone.blocked).toMatchObject({ missing: 1 })
  expect(alone.state).toBe(loaded)

  const together = tryEditKeysTogether(loaded, SLOT0, SPACE_GUI_ESC)
  expect(together.blocked).toBeNull()
  const target = buildTarget(together.state)
  for (const { layer, key } of SLOT0) expect(target.keymap[layer][key]).toBe(0x5700)
  expect(target.tapDances[0]).toMatchObject({ onTap: 0x2c, onHold: 0xe3, onDoubleTap: 0x29 })
})

test('連動して変更は、reducer からも同じ結果になる。1つだけ渡した時は、そのキーだけの編集になる', () => {
  const loaded = run([{ type: 'read', snapshot: cornixSnapshot() }])
  const session = run([{ type: 'editKeysTogether', keys: SLOT0, behavior: SPACE_GUI_ESC }], loaded)
  expect(session.edit).toEqual(editKeysTogether(loaded.edit!, SLOT0, SPACE_GUI_ESC))
  expect(run([{ type: 'revert', place: { kind: 'key', layer: 2, key: 26 } }], session).edit!.edits).toEqual(EMPTY_EDITS)
  expect(editKeysTogether(loaded.edit!, [SLOT0[0]], SPACE_GUI_ESC)).toEqual(editKey(loaded.edit!, 0, 26, SPACE_GUI_ESC))
  expect(editKeysTogether(loaded.edit!, [], SPACE_GUI_ESC)).toBe(loaded.edit)
})

// ---- エンコーダー ----

const WHEEL_UP: Action = { kind: 'key', code: 0xd9, mods: [] }
const VOLUME_UP: Action = { kind: 'key', code: 0xa9, mods: [] }

test('実機の設定: エンコーダーの編集は、目標の、その方向だけを変える。取り消すと、基準と同じ目標に戻る', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  // レイヤー 0 の1つ目は [ホイール↑, ホイール↓]、レイヤー 1 の1つ目は [音量−, 音量＋]
  let state = editEncoder(loaded, 0, 0, 'left', VOLUME_UP)
  state = editEncoder(state, 1, 0, 'right', { kind: 'none' })
  expect(countEdits(state)).toBe(2)
  const target = buildTarget(state)
  expect(target.encoders[0][0]).toEqual([0x00a9, 0x00da])
  expect(target.encoders[1][0]).toEqual([0x00aa, 0x0000])
  expect({ ...target, encoders: loaded.baseline.encoders }).toEqual(loaded.baseline)
  // 出発点と同じ動作を入れ直すと、編集ではなくなる
  expect(countEdits(editEncoder(state, 0, 0, 'left', WHEEL_UP))).toBe(1)
  state = revertEdit(state, { kind: 'encoder', layer: 0, encoder: 0, direction: 'left' })
  state = revertEdit(state, { kind: 'encoder', layer: 1, encoder: 0, direction: 'right' })
  expect(state.edits).toEqual(EMPTY_EDITS)
  expect(sameSnapshot(buildTarget(state), loaded.baseline)).toBe(true)
})

test('エンコーダーに「押している間だけレイヤー N」は入れられない（状態に反映せずに止める）。ほかのレイヤー切り替えは入る', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const held = tryEditEncoder(loaded, 0, 0, 'left', { kind: 'layer', mode: 'momentary', layer: 1 })
  expect(held.state).toBe(loaded)
  expect(held.blocked?.invalidEncoders).toHaveLength(1)
  const toggled = tryEditEncoder(loaded, 0, 0, 'left', { kind: 'layer', mode: 'toggle', layer: 1 })
  expect(toggled.blocked).toBeNull()
  expect(buildTarget(toggled.state).encoders[0][0][0]).toBe(0x5261)
  // reducer からも同じ
  const session = { edit: loaded, pending: null }
  expect(sessionReducer(session, { type: 'editEncoder', layer: 0, encoder: 0, direction: 'left', action: { kind: 'layer', mode: 'momentary', layer: 1 } })).toBe(session)
  expect(sessionReducer(session, { type: 'editEncoder', layer: 0, encoder: 0, direction: 'left', action: VOLUME_UP }).edit!.edits.encoders).toHaveLength(1)
})

test('本体から読んだエンコーダーが Tap Dance を指している時: 別の動作で上書きすると、その枠が空く。取り消すと、元の値に戻る', () => {
  const source = altered((s) => {
    s.tapDances[2] = { onTap: 0x04, onHold: 0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 250 }
    s.encoders[3][1] = [0x5702, 0x00da]
  })
  const loaded = loadSnapshot(source)
  expect(planKeys(loaded).free).toBe(29)
  const edited = editEncoder(loaded, 3, 1, 'left', VOLUME_UP)
  expect(planKeys(edited).free).toBe(30)
  const target = buildTarget(edited)
  expect(target.encoders[3][1]).toEqual([0x00a9, 0x00da])
  expect(target.tapDances[2]).toEqual({ onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 })
  const reverted = revertEdit(edited, { kind: 'encoder', layer: 3, encoder: 1, direction: 'left' })
  expect(sameSnapshot(buildTarget(reverted), source)).toBe(true)
})

test('エンコーダーの編集で空いた枠を、キーが使った後では、エンコーダーの取り消しを止める（枠が足りなくなるため）', () => {
  // 空いている枠がなく、枠 31 はエンコーダーだけが指している
  const source = altered((s) => {
    for (let slot = 2; slot < 32; slot++) {
      s.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
      if (slot < 31) s.keymap[9][slot] = 0x5700 + slot
    }
    s.encoders[4][1] = [0x5700 + 31, 0x00da]
  })
  const loaded = loadSnapshot(source)
  const A_ESC: KeyBehavior = { tap: A, doubleTap: { kind: 'key', code: 0x29, mods: [] } }
  expect(tryEditKey(loaded, 0, 1, A_ESC).blocked?.missing).toBe(1)
  const freed = editEncoder(loaded, 4, 1, 'left', VOLUME_UP)
  const used = tryEditKey(freed, 0, 1, A_ESC)
  expect(used.blocked).toBeNull()
  expect(buildTarget(used.state).keymap[0][1]).toBe(0x5700 + 31)
  const place = { kind: 'encoder', layer: 4, encoder: 1, direction: 'left' } as const
  expect(tryRevertEdit(used.state, place).blocked?.missing).toBe(1)
  expect(tryRevertEdit(freed, place).blocked).toBeNull()
})

test('共有: エンコーダーも同じ枠を指している時の「連動して変更」は、編集した後のエンコーダーで見る', () => {
  // 枠 0 は、4つのキーと、エンコーダーが指している。空いている枠はない
  const source = altered((s) => {
    for (let slot = 2; slot < 32; slot++) {
      s.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
      s.keymap[9][slot] = 0x5700 + slot
    }
    s.encoders[4][1] = [0x5700, 0x00da]
  })
  const loaded = loadSnapshot(source)
  const keys = sharedKeys(loaded, { layer: 0, key: 26 })
  expect(keys).toHaveLength(4)
  const A_ESC: KeyBehavior = { tap: A, doubleTap: { kind: 'key', code: 0x29, mods: [] } }
  // エンコーダーが指している間は、元の枠が残るので、枠が1つ要る
  expect(tryEditKeysTogether(loaded, keys, A_ESC).blocked?.missing).toBe(1)
  // エンコーダーを変えた後は、元の枠が空くので、通る
  const freed = editEncoder(loaded, 4, 1, 'left', VOLUME_UP)
  expect(tryEditKeysTogether(freed, keys, A_ESC).blocked).toBeNull()
})

// ---- 変更点の一覧（model/diff.ts）とのつながり ----

/** キー、連動して変えたキーの組、エンコーダー、コンボ（追加・変更・削除）を変えた状態 */
function variouslyEdited(): EditState {
  let state = loadSnapshot(
    altered((snapshot) => {
      snapshot.combos[0] = { keys: [0x04, 0x05, 0, 0], output: 0x29 }
      snapshot.combos[1] = { keys: [0x06, 0x07, 0, 0], output: 0x2a }
    }),
  )
  state = editKey(state, 0, 8, { tap: B })
  state = editKey(state, 3, 9, { tap: A, doubleTap: B })
  state = editKeysTogether(state, sharedKeys(state, { layer: 0, key: 26 }), { tap: B, tapHold: A })
  state = editEncoder(state, 0, 0, 'left', A)
  state = editEncoder(state, 0, 0, 'right', B)
  state = addCombo(state, { keys: [0x08, 0x09], output: A })
  state = editCombo(state, { slot: 0 }, { keys: [0x04, 0x06], output: B })
  return editCombo(state, { slot: 1 }, null)
}

test('変更点の一覧の行数は、編集の数と同じ。1行が、取り消しの単位', () => {
  let state = variouslyEdited()
  expect(countEdits(state)).toBe(8)
  expect(listChanges(state)).toHaveLength(8)
  // 出発点を入れ替えると、全体で1行増える
  const fromFile = structuredClone(state.baseline)
  fromFile.keymap[5][5] = 0x04
  const replaced = replaceSource(state, fromFile)
  expect(listChanges(replaced)).toHaveLength(countEdits(replaced))
  expect(countEdits(replaced)).toBe(9)

  // 一覧の行を1つずつ取り消すと、1件ずつ減って、最後は編集がなくなる
  for (let left = 8; left > 0; left--) {
    const [change] = listChanges(state)
    if (change.undo.kind !== 'edit') throw new Error('出発点は入れ替えていない')
    const { state: next, blocked } = tryRevertEdit(state, change.undo.place)
    expect(blocked).toBeNull()
    state = next
    expect(countEdits(state)).toBe(left - 1)
    expect(listChanges(state)).toHaveLength(left - 1)
  }
  expect(hasUnwrittenChanges(state)).toBe(false)
  expect(buildTarget(state)).toEqual(state.baseline)
})

test('消したコンボと、変えたコンボは、変更点の一覧の取り消しで元に戻る', () => {
  const state = variouslyEdited()
  const before = comboList(loadSnapshot(state.baseline))
  const undoOf = (id: string) => {
    const change = listChanges(state).find((item) => item.id === id)
    if (change?.undo.kind !== 'edit') throw new Error(`${id} の行がない`)
    return change.undo.place
  }
  const restored = revertEdit(revertEdit(state, undoOf('combo-slot-0')), undoOf('combo-slot-1'))
  expect(comboList(restored).slice(0, 2)).toEqual(before)
  // 足したコンボは、残っている
  expect(comboList(restored)).toHaveLength(3)
})

test('すべて取り消すと、編集も、出発点の入れ替えもなくなり、本体から読んだ内容に戻る', () => {
  const state = replaceSource(variouslyEdited(), altered((snapshot) => (snapshot.keymap[5][5] = 0x04)))
  const reverted = revertAll(state)
  expect(reverted.baseline).toBe(state.baseline)
  expect(reverted.source).toBe(state.baseline)
  expect(hasUnwrittenChanges(reverted)).toBe(false)
  expect(listChanges(reverted)).toEqual([])
  // 変更がなければ、同じ状態を返す
  expect(revertAll(reverted)).toBe(reverted)
  const session = run([{ type: 'read', snapshot: cornixSnapshot() }, { type: 'editKey', layer: 0, key: 8, behavior: { tap: B } }])
  expect(hasUnwrittenChanges(run([{ type: 'revertAll' }], session).edit!)).toBe(false)
})

test('目標と、本体の現在値から作った操作を、偽の機器に書くと、読み直した内容が目標と一致する', async () => {
  const state = variouslyEdited()
  const target = buildTarget(state)
  const keyboard = createFakeCornix()
  keyboard.snapshot = structuredClone(state.baseline)
  const device = await keyboard.connect()
  const operations = writeOperations(await device!.read(), target)
  expect(operations.length).toBeGreaterThan(8)
  await device!.write(operations)
  expect(sameSnapshot(await device!.read(), target)).toBe(true)
  // 書いた後は、送るものがない
  expect(writeOperations(await device!.read(), target)).toEqual([])
})
