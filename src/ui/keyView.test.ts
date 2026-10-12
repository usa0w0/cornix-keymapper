import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import { placeKeys } from '../model/layout.ts'
import type { Action } from '../model/action.ts'
import type { Edits } from '../model/edits.ts'
import { behaviorAt, isChanged, isLayerEmpty, isLong, keycodeAt, keyViewOf, placeName, slotsName, type KeyTarget } from './keyView.ts'

// 実機（Cornix LP）から読んだ設定。JSON の型では、エンコーダーとコンボのキーが、決まった長さの組にならない
const cornix = recorded.snapshot as unknown as KeyboardSnapshot

const key = (index: number): KeyTarget => ({ kind: 'key', index })

/** 2 行 × 2 列、エンコーダー 1 個の小さな機器。keymap は [レイヤー][キー] */
const tiny = (keymap: number[][], encoders: [number, number][][] = keymap.map(() => [[0, 0]])): KeyboardSnapshot => ({
  uid: '0123456789abcdef',
  layout: { rows: 2, cols: 2, encoderCount: 1, raw: { layouts: { keymap: [['0,0', '0,1'], ['1,0', '1,1']] } } },
  capabilities: { viaProtocol: 9, vialProtocol: 6, layerCount: keymap.length, tapDanceCount: 1, comboCount: 0 },
  keymap,
  encoders,
  // 枠 0 は、タップ A ／ 長押し 左 Ctrl ／ 2回タップ Esc ／ タップ後長押し 左 Shift
  tapDances: [{ onTap: 0x0004, onHold: 0x00e0, onDoubleTap: 0x0029, onTapHold: 0x00e1, tappingTerm: 250 }],
  combos: [],
})

test('キーコードを、欄ごとの動作の表示名にする', () => {
  // レイヤー 0 の 行 0・列 1 は Q
  expect(keyViewOf(cornix, 0, key(1), 'us')).toEqual({ state: 'normal', slots: { tap: { short: 'Q', full: 'Q' } } })
})

test('実機の設定: Tap Dance とレイヤー切り替えのキーを、同じ欄の形で出す。Tap Dance の番号は出さない', () => {
  // 左の親指。行 3・列 3 は MO(2)、行 3・列 5 は Tap Dance 0（タップ Space ／ 長押し 左 GUI）
  expect(keyViewOf(cornix, 0, key(24), 'us')).toEqual({
    state: 'normal',
    slots: { hold: { short: 'レイヤー 2', note: '押している間', full: '押している間だけレイヤー 2' } },
  })
  const space = keyViewOf(cornix, 0, key(26), 'us')
  expect(space).toMatchObject({ state: 'normal', slots: { tap: { short: 'Space' }, hold: { short: 'GUI' } } })
  expect(slotsName(space.slots)).toBe('タップ: Space ／ 長押し: 左 GUI（Cmd / Win）')
  // 右の親指。行 7・列 4 は OSL(1)、行 7・列 5 は Tap Dance 1（タップ B ／ 長押し 右 GUI）
  expect(keyViewOf(cornix, 0, key(53), 'us')).toMatchObject({
    state: 'normal',
    slots: { tap: { short: 'レイヤー 1', note: '次の1キー' } },
  })
  const b = keyViewOf(cornix, 0, key(54), 'us')
  expect(b).toMatchObject({ state: 'normal', slots: { tap: { short: 'B' }, hold: { short: 'GUI' } } })
  expect(slotsName(b.slots)).toBe('タップ: B ／ 長押し: 右 GUI（Cmd / Win）')
  // どのレイヤーのどのキーにも、Tap Dance の番号は出ない
  for (let layer = 0; layer < cornix.keymap.length; layer++) {
    for (let index = 0; index < cornix.keymap[layer].length; index++) {
      expect(JSON.stringify(keyViewOf(cornix, layer, key(index), 'us'))).not.toContain('Tap Dance')
    }
  }
})

test('MT と LT は、タップと長押しに分けて出す', () => {
  // LSft_T(V)、LT(2, Space)
  const snapshot = tiny([[0x2219, 0x422c, 0, 0]])
  expect(keyViewOf(snapshot, 0, key(0), 'us')).toMatchObject({
    state: 'normal',
    slots: { tap: { short: 'V' }, hold: { short: 'Shift' } },
  })
  expect(keyViewOf(snapshot, 0, key(1), 'us')).toMatchObject({
    state: 'normal',
    slots: { tap: { short: 'Space' }, hold: { short: 'レイヤー 2', note: '押している間' } },
  })
})

test('4欄とも入った Tap Dance は、4欄とも出す', () => {
  const view = keyViewOf(tiny([[0x5700, 0, 0, 0]]), 0, key(0), 'us')
  expect(view).toMatchObject({
    state: 'normal',
    slots: { tap: { short: 'A' }, hold: { short: 'Ctrl' }, doubleTap: { short: 'Esc' }, tapHold: { short: 'Shift' } },
  })
  expect(slotsName(view.slots)).toBe('タップ: A ／ 長押し: 左 Ctrl ／ 2回タップ: Escape ／ タップ後長押し: 左 Shift')
})

test('「何もしない」は空、このサイトで扱わないキーコードは編集不可として、その名前を出す', () => {
  expect(keyViewOf(cornix, 1, key(8), 'us')).toMatchObject({ state: 'none', slots: { tap: { short: '' } } })
  // 独自のキーは、レイアウト定義の名前
  expect(keyViewOf(cornix, 3, key(7), 'us')).toMatchObject({ state: 'locked', slots: { tap: { short: 'BT0' } } })
  // 本体にない枠を指す Tap Dance は、展開できないので、番号のまま編集不可にする
  expect(keyViewOf(tiny([[0x5705, 0, 0, 0]]), 0, key(0), 'us')).toMatchObject({
    state: 'locked',
    slots: { tap: { short: 'Tap Dance 5' } },
  })
})

test('刻印を JIS にすると、数字と記号の見え方だけが変わる', () => {
  // レイヤー 1 の 行 0・列 2 は 2
  expect(keyViewOf(cornix, 1, key(2), 'us').slots.tap).toMatchObject({ short: '2', shifted: '@' })
  expect(keyViewOf(cornix, 1, key(2), 'jis').slots.tap).toMatchObject({ short: '2', shifted: '"' })
})

test('エンコーダーは、左回しと右回しを別々に出す', () => {
  expect(keyViewOf(cornix, 0, { kind: 'encoder', encoder: 0, direction: 'left' }, 'us').slots.tap?.short).toBe('ホイール↑')
  expect(keyViewOf(cornix, 0, { kind: 'encoder', encoder: 0, direction: 'right' }, 'us').slots.tap?.short).toBe('ホイール↓')
  expect(keyViewOf(cornix, 1, { kind: 'encoder', encoder: 0, direction: 'left' }, 'us').slots.tap?.short).toBe('音量−')
})

test('透過キーには、下のレイヤーで実際に効く動作を添える', () => {
  const snapshot = tiny([
    [0x0004, 0x0005, 0x7e00, 0x0001],
    [0x0001, 0x0000, 0x0001, 0x0001],
    [0x0001, 0x0001, 0x0001, 0x0006],
  ])
  expect(keyViewOf(snapshot, 2, key(0), 'us')).toEqual({
    state: 'transparent',
    slots: { tap: { short: '透過', full: '透過' } },
    inherited: { layer: 0, state: 'normal', slots: { tap: { short: 'A', full: 'A' } } },
  })
  // 1つ下が「何もしない」なら、それが効く
  expect(keyViewOf(snapshot, 2, key(1), 'us').inherited).toMatchObject({ layer: 1, state: 'none' })
  expect(keyViewOf(snapshot, 2, key(2), 'us').inherited).toMatchObject({ layer: 0, state: 'locked' })
  // レイヤー 0 まですべて透過
  expect(keyViewOf(snapshot, 1, key(3), 'us')).toEqual({
    state: 'transparent',
    slots: { tap: { short: '透過', full: '透過' } },
  })
  // 透過でないキーには添えない
  expect(keyViewOf(snapshot, 2, key(3), 'us').inherited).toBeUndefined()
})

test('透過キーに添える動作も、欄に展開した後のものにする', () => {
  // 下のレイヤーが、Tap Dance、MO、LT
  const snapshot = tiny([
    [0x5700, 0x5222, 0x422c, 0],
    [0x0001, 0x0001, 0x0001, 0],
  ])
  expect(keyViewOf(snapshot, 1, key(0), 'us').inherited).toMatchObject({
    layer: 0,
    state: 'normal',
    slots: { tap: { short: 'A' }, hold: { short: 'Ctrl' }, doubleTap: { short: 'Esc' }, tapHold: { short: 'Shift' } },
  })
  expect(keyViewOf(snapshot, 1, key(1), 'us').inherited?.slots).toEqual({
    hold: { short: 'レイヤー 2', note: '押している間', full: '押している間だけレイヤー 2' },
  })
  expect(keyViewOf(snapshot, 1, key(2), 'us').inherited?.slots).toMatchObject({
    tap: { short: 'Space' },
    hold: { short: 'レイヤー 2' },
  })
  // 実機の設定: レイヤー 1 の親指の Tap Dance 0 は、透過ではなく、そのまま出る
  expect(keyViewOf(cornix, 1, key(26), 'us')).toMatchObject({ state: 'normal', slots: { tap: { short: 'Space' } } })
})

test('エンコーダーの透過も、同じ向きの下のレイヤーをたどる', () => {
  const snapshot = tiny(
    [[0, 0, 0, 0], [0, 0, 0, 0]],
    [[[0x00a9, 0x00aa]], [[0x0001, 0x0004]]],
  )
  const left = keyViewOf(snapshot, 1, { kind: 'encoder', encoder: 0, direction: 'left' }, 'us')
  expect(left.inherited).toMatchObject({ layer: 0, slots: { tap: { short: '音量＋' } } })
  expect(keyViewOf(snapshot, 1, { kind: 'encoder', encoder: 0, direction: 'right' }, 'us').state).toBe('normal')
})

test('エンコーダーは動作1つのままで、欄に展開しない', () => {
  // 左回しが MO(2)、右回しが Tap Dance 0
  const snapshot = tiny([[0, 0, 0, 0]], [[[0x5222, 0x5700]]])
  expect(keyViewOf(snapshot, 0, { kind: 'encoder', encoder: 0, direction: 'left' }, 'us')).toMatchObject({
    state: 'normal',
    slots: { tap: { short: 'レイヤー 2' } },
  })
  expect(keyViewOf(snapshot, 0, { kind: 'encoder', encoder: 0, direction: 'right' }, 'us')).toMatchObject({
    state: 'locked',
    slots: { tap: { short: 'Tap Dance 0' } },
  })
})

test('本体から読んだ設定にない場所は、空として出す', () => {
  expect(keycodeAt(cornix, 99, key(0))).toBeUndefined()
  expect(keyViewOf(cornix, 0, key(999), 'us').state).toBe('none')
})

test('図に出るキーが、すべて「何もしない」か透過のレイヤーは、空とする', () => {
  const snapshot = tiny([
    [0x0004, 0, 0, 0],
    [0x0000, 0x0001, 0, 0],
  ])
  const keys = placeKeys(snapshot.layout)
  expect(isLayerEmpty(snapshot, 0, keys)).toBe(false)
  expect(isLayerEmpty(snapshot, 1, keys)).toBe(true)
  // 実機の設定は、どのレイヤーにも、内側のキー（消音と中クリック）が割り当てられている
  const cornixKeys = placeKeys(cornix.layout)
  expect(cornix.keymap.map((_, layer) => isLayerEmpty(cornix, layer, cornixKeys))).not.toContain(true)
})

test('4つとも空の枠を指す Tap Dance だけのレイヤーは、図と同じく空とする', () => {
  const snapshot = tiny([
    [0x5700, 0, 0x0001, 0],
    [0x5700, 0, 0, 0],
  ])
  const keys = placeKeys(snapshot.layout)
  // 枠 0 に中身がある間は、空ではない
  expect(isLayerEmpty(snapshot, 0, keys)).toBe(false)
  const cleared = { ...snapshot, tapDances: [{ onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 }] }
  expect(keyViewOf(cleared, 0, key(0), 'us').state).toBe('none')
  expect(isLayerEmpty(cleared, 0, keys)).toBe(true)
  expect(isLayerEmpty(cleared, 1, keys)).toBe(true)
})

test('図に出ない場所（行列にあって、レイアウト定義にないキー）は、空かどうかの判定に入れない', () => {
  const snapshot = tiny([[0, 0, 0, 0x0004]])
  const keys = placeKeys({ ...snapshot.layout, raw: { layouts: { keymap: [['0,0', '0,1', '1,0']] } } })
  expect(isLayerEmpty(snapshot, 0, keys)).toBe(true)
})

test('大きな字で収まらない表示を見分ける。全角の字は2つぶんに数える', () => {
  expect(isLong('Enter')).toBe(false)
  expect(isLong('Ctrl+C')).toBe(true)
  expect(isLong('変換')).toBe(false)
  expect(isLong('無変換')).toBe(true)
})

// ---- 編集を当てはめた後の見え方 ----

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const CTRL: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] }
const keyEdits = (...keys: Edits['keys']): Edits => ({ keys, encoders: [], combos: [] })

test('編集したキーは、編集した後の内容を出す。編集していないキーと、ほかのレイヤーの同じ場所は、出発点のまま', () => {
  const edits = keyEdits({ layer: 0, key: 1, behavior: { tap: A, hold: CTRL } })
  expect(keyViewOf(cornix, 0, key(1), 'us', undefined, edits).slots).toEqual({
    tap: { short: 'A', full: 'A' },
    hold: { short: 'Ctrl', full: '左 Ctrl' },
  })
  expect(isChanged(edits, 0, key(1))).toBe(true)
  expect(keyViewOf(cornix, 0, key(2), 'us', undefined, edits)).toEqual(keyViewOf(cornix, 0, key(2), 'us'))
  expect(isChanged(edits, 0, key(2))).toBe(false)
  expect(keyViewOf(cornix, 1, key(1), 'us', undefined, edits)).toEqual(keyViewOf(cornix, 1, key(1), 'us'))
  expect(isChanged(edits, 1, key(1))).toBe(false)
  expect(isChanged(edits, 0, { kind: 'encoder', encoder: 0, direction: 'left' })).toBe(false)
  expect(behaviorAt(cornix, 0, key(1), undefined, edits)).toEqual({ tap: A, hold: CTRL })
  expect(behaviorAt(cornix, 0, key(999), undefined, edits)).toBeUndefined()
})

test('実機の設定: 編集したエンコーダーは、その方向・そのレイヤーだけ、編集した後の内容を出す', () => {
  const left = { kind: 'encoder', encoder: 0, direction: 'left' } as const
  const right = { kind: 'encoder', encoder: 0, direction: 'right' } as const
  const VOLUME_UP: Action = { kind: 'key', code: 0xa9, mods: [] }
  const edits: Edits = { keys: [], encoders: [{ layer: 0, ...left, action: VOLUME_UP }], combos: [] }
  expect(keyViewOf(cornix, 0, left, 'us', undefined, edits).slots.tap?.short).toBe('音量＋')
  expect(behaviorAt(cornix, 0, left, undefined, edits)).toEqual({ tap: VOLUME_UP })
  expect(isChanged(edits, 0, left)).toBe(true)
  expect(keyViewOf(cornix, 0, right, 'us', undefined, edits).slots.tap?.short).toBe('ホイール↓')
  expect(isChanged(edits, 0, right)).toBe(false)
  expect(keyViewOf(cornix, 1, left, 'us', undefined, edits).slots.tap?.short).toBe('音量−')
  expect(isChanged(edits, 1, left)).toBe(false)
  expect(isChanged(edits, 0, { kind: 'encoder', encoder: 1, direction: 'left' })).toBe(false)
  // 欄を消したエンコーダーは、何もしない
  const cleared: Edits = { keys: [], encoders: [{ layer: 0, ...left, action: { kind: 'none' } }], combos: [] }
  expect(keyViewOf(cornix, 0, left, 'us', undefined, cleared)).toEqual({ state: 'none', slots: { tap: { short: '', full: '何もしない' } } })
})

test('透過キーは、編集を当てはめた後の、下のレイヤーの動作を出す', () => {
  // 3枚とも、キー 0 は レイヤー 0 から順に B、透過、透過
  const snapshot = tiny([[0x0005, 0, 0, 0], [0x0001, 0, 0, 0], [0x0001, 0, 0, 0]])
  expect(keyViewOf(snapshot, 2, key(0), 'us').inherited).toMatchObject({ layer: 0, slots: { tap: { short: 'B' } } })
  // レイヤー 0 を変えると、上の透過キーに出る動作も変わる
  const below = keyEdits({ layer: 0, key: 0, behavior: { tap: A, hold: CTRL } })
  expect(keyViewOf(snapshot, 2, key(0), 'us', undefined, below).inherited).toMatchObject({
    layer: 0,
    slots: { tap: { short: 'A' }, hold: { short: 'Ctrl' } },
  })
  // 途中のレイヤーを透過でなくすと、そこで止まる
  const middle = keyEdits({ layer: 1, key: 0, behavior: { tap: { kind: 'none' } } })
  expect(keyViewOf(snapshot, 2, key(0), 'us', undefined, middle).inherited).toMatchObject({ layer: 1, state: 'none' })
  // キーを透過にすると、下のレイヤーの動作を出す。透過でなくすと、出さない
  const made = keyEdits({ layer: 0, key: 1, behavior: { tap: A } }, { layer: 1, key: 1, behavior: { tap: { kind: 'transparent' } } })
  expect(keyViewOf(snapshot, 1, key(1), 'us', undefined, made)).toMatchObject({
    state: 'transparent',
    inherited: { layer: 0, slots: { tap: { short: 'A' } } },
  })
  const unmade = keyEdits({ layer: 2, key: 0, behavior: { tap: A } })
  expect(keyViewOf(snapshot, 2, key(0), 'us', undefined, unmade)).toEqual({ state: 'normal', slots: { tap: { short: 'A', full: 'A' } } })
})

test('キーが1つも割り当てられていないレイヤーかは、編集を当てはめた後の内容で見る', () => {
  const snapshot = tiny([[0x0004, 0, 0, 0], [0x0001, 0, 0, 0]])
  const keys = placeKeys(snapshot.layout)
  expect(isLayerEmpty(snapshot, 1, keys)).toBe(true)
  expect(isLayerEmpty(snapshot, 1, keys, keyEdits({ layer: 1, key: 3, behavior: { tap: A } }))).toBe(false)
  expect(isLayerEmpty(snapshot, 0, keys, keyEdits({ layer: 0, key: 0, behavior: { tap: { kind: 'none' } } }))).toBe(true)
})

test('キーの場所の名前', () => {
  expect(placeName(0, { row: 3, col: 5 })).toBe('レイヤー 0 ・ 行 3 列 5')
})
