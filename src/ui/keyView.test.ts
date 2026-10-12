import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import { placeKeys } from '../model/layout.ts'
import { isLayerEmpty, isLong, keycodeAt, keyViewOf, type KeyTarget } from './keyView.ts'

// 実機（Cornix LP）から読んだ設定。JSON の型では、エンコーダーとコンボのキーが、決まった長さの組にならない
const cornix = recorded.snapshot as unknown as KeyboardSnapshot

const key = (index: number): KeyTarget => ({ kind: 'key', index })

/** 2 行 × 2 列、エンコーダー 1 個の小さな機器。keymap は [レイヤー][キー] */
const tiny = (keymap: number[][], encoders: [number, number][][] = keymap.map(() => [[0, 0]])): KeyboardSnapshot => ({
  uid: '0123456789abcdef',
  layout: { rows: 2, cols: 2, encoderCount: 1, raw: { layouts: { keymap: [['0,0', '0,1'], ['1,0', '1,1']] } } },
  capabilities: { viaProtocol: 9, vialProtocol: 6, layerCount: keymap.length, tapDanceCount: 0, comboCount: 0 },
  keymap,
  encoders,
  tapDances: [],
  combos: [],
})

test('キーコードを、動作の表示名にする', () => {
  // レイヤー 0 の 行 0・列 1 は Q、行 3・列 3 は「押している間だけレイヤー 2」
  expect(keyViewOf(cornix, 0, key(1), 'us')).toEqual({ state: 'normal', label: { short: 'Q', full: 'Q' } })
  expect(keyViewOf(cornix, 0, key(24), 'us')).toMatchObject({
    state: 'normal',
    label: { short: 'レイヤー 2', note: '押している間' },
  })
})

test('「何もしない」は空、このサイトで扱わないキーコードは編集不可として、その名前を出す', () => {
  expect(keyViewOf(cornix, 1, key(8), 'us')).toMatchObject({ state: 'none', label: { short: '' } })
  // 独自のキーは、レイアウト定義の名前
  expect(keyViewOf(cornix, 3, key(7), 'us')).toMatchObject({ state: 'locked', label: { short: 'BT0' } })
  expect(keyViewOf(cornix, 0, key(26), 'us')).toMatchObject({ state: 'locked', label: { short: 'Tap Dance 0' } })
})

test('刻印を JIS にすると、数字と記号の見え方だけが変わる', () => {
  // レイヤー 1 の 行 0・列 2 は 2
  expect(keyViewOf(cornix, 1, key(2), 'us').label).toMatchObject({ short: '2', shifted: '@' })
  expect(keyViewOf(cornix, 1, key(2), 'jis').label).toMatchObject({ short: '2', shifted: '"' })
})

test('エンコーダーは、左回しと右回しを別々に出す', () => {
  expect(keyViewOf(cornix, 0, { kind: 'encoder', encoder: 0, direction: 'left' }, 'us').label.short).toBe('ホイール↑')
  expect(keyViewOf(cornix, 0, { kind: 'encoder', encoder: 0, direction: 'right' }, 'us').label.short).toBe('ホイール↓')
  expect(keyViewOf(cornix, 1, { kind: 'encoder', encoder: 0, direction: 'left' }, 'us').label.short).toBe('音量−')
})

test('透過キーには、下のレイヤーで実際に効く動作を添える', () => {
  const snapshot = tiny([
    [0x0004, 0x0005, 0x7e00, 0x0001],
    [0x0001, 0x0000, 0x0001, 0x0001],
    [0x0001, 0x0001, 0x0001, 0x0006],
  ])
  expect(keyViewOf(snapshot, 2, key(0), 'us')).toEqual({
    state: 'transparent',
    label: { short: '透過', full: '透過' },
    inherited: { layer: 0, state: 'normal', label: { short: 'A', full: 'A' } },
  })
  // 1つ下が「何もしない」なら、それが効く
  expect(keyViewOf(snapshot, 2, key(1), 'us').inherited).toMatchObject({ layer: 1, state: 'none' })
  expect(keyViewOf(snapshot, 2, key(2), 'us').inherited).toMatchObject({ layer: 0, state: 'locked' })
  // レイヤー 0 まですべて透過
  expect(keyViewOf(snapshot, 1, key(3), 'us')).toEqual({ state: 'transparent', label: { short: '透過', full: '透過' } })
  // 透過でないキーには添えない
  expect(keyViewOf(snapshot, 2, key(3), 'us').inherited).toBeUndefined()
})

test('エンコーダーの透過も、同じ向きの下のレイヤーをたどる', () => {
  const snapshot = tiny(
    [[0, 0, 0, 0], [0, 0, 0, 0]],
    [[[0x00a9, 0x00aa]], [[0x0001, 0x0004]]],
  )
  const left = keyViewOf(snapshot, 1, { kind: 'encoder', encoder: 0, direction: 'left' }, 'us')
  expect(left.inherited).toMatchObject({ layer: 0, label: { short: '音量＋' } })
  expect(keyViewOf(snapshot, 1, { kind: 'encoder', encoder: 0, direction: 'right' }, 'us').state).toBe('normal')
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
