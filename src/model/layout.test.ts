import { expect, test } from 'vitest'
import type { LayoutDefinition } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import { boundsOf, firmwareVersionOf, placeKeys, type PlacedKey } from './layout.ts'

// 実機（Cornix LP）から読んだレイアウト定義
const cornix = recorded.snapshot.layout as LayoutDefinition
const placed = placeKeys(cornix)

const keyAt = (row: number, col: number) =>
  placed.find((key) => key.kind === 'key' && key.row === row && key.col === col)

const layoutOf = (keymap: unknown, size = { rows: 4, cols: 4, encoderCount: 1 }): LayoutDefinition => ({
  ...size,
  raw: { layouts: { keymap } },
})

test('実機の定義から、キー 50 個とエンコーダー 2 個ぶん（左回しと右回し）を取り出す', () => {
  const keys = placed.filter((key) => key.kind === 'key')
  const encoders = placed.filter((key) => key.kind === 'encoder')
  expect(keys).toHaveLength(50)
  expect(encoders.map((key) => [key.encoder, key.direction])).toEqual([
    [0, 'left'],
    [0, 'right'],
    [1, 'left'],
    [1, 'right'],
  ])
  // 同じ場所を2回取り出していない
  expect(new Set(keys.map((key) => key.index)).size).toBe(50)
})

test('キーの番号は、行列の 行 × 列数 + 列', () => {
  expect(keyAt(0, 0)).toMatchObject({ index: 0 })
  expect(keyAt(2, 6)).toMatchObject({ index: 20 })
  expect(keyAt(7, 5)).toMatchObject({ index: 54 })
  for (const key of placed) {
    if (key.kind === 'key') expect(key.index).toBeLessThan(cornix.rows * cornix.cols)
  }
})

test('行ごとの位置の指定（x と y のずれ）を積み上げて、座標にする', () => {
  // 1行目: 3u あけて「0,3」、さらに 6.5u あけて「4,3」
  expect(keyAt(0, 3)).toMatchObject({ x: 3, y: 0, w: 1, h: 1, r: 0 })
  expect(keyAt(4, 3)).toMatchObject({ x: 10.5, y: 0 })
  // 2行目: 1行下がってから 0.75u 上へ
  expect(keyAt(0, 2)).toMatchObject({ x: 2, y: 0.25 })
  // 5行目: 左端から並ぶ。ラベルに余分な欄があっても、先頭の「行,列」を読む
  expect(keyAt(0, 0)).toMatchObject({ x: 0 })
  expect(keyAt(0, 1)).toMatchObject({ x: 1 })
  expect(keyAt(0, 0)!.y).toBeCloseTo(0.5)
  expect(keyAt(4, 0)).toMatchObject({ x: 13.5 })
})

test('左右の手のキーは、中央の線をはさんで対称に並ぶ', () => {
  // 左手の 行 r・列 c と、右手の 行 r + 4・列 c が対になる（親指の回転したキーと、内側の列 6 のキーを除く）
  for (const key of placed) {
    if (key.kind !== 'key' || key.row >= 4 || key.col >= 6 || key.r !== 0) continue
    const mirror = keyAt(key.row + 4, key.col)!
    expect(key.x + key.w + mirror.x).toBeCloseTo(14.5)
    // 縦は、定義の値が左右でわずかに違う（最大 0.08u）
    expect(Math.abs(mirror.y - key.y)).toBeLessThan(0.1)
  }
})

test('親指のキーは、回転と、その中心を持つ', () => {
  expect(keyAt(3, 4)).toMatchObject({ r: 11.93, rx: 5, ry: 4.75, x: 4.5 })
  expect(keyAt(3, 4)!.y).toBeCloseTo(3.7)
  // 回転だけを変えた行は、前の中心をそのまま使い、前の行の1行下から数える（3.7 + 1 − 1.05）
  expect(keyAt(3, 5)).toMatchObject({ r: 23, rx: 5, ry: 4.75, x: 5.5 })
  expect(keyAt(3, 5)!.y).toBeCloseTo(3.65)
  expect(keyAt(7, 5)).toMatchObject({ r: -23, rx: 5, ry: 4.75 })
  expect(keyAt(7, 5)!.x).toBeCloseTo(7.64)
  expect(keyAt(7, 5)!.y).toBeCloseTo(5.38)
  // 中心の x だけを変えた行は、置く場所が新しい中心に戻る
  expect(keyAt(7, 4)).toMatchObject({ r: -11.93, rx: 9.25, ry: 4.75, x: 9 })
  expect(keyAt(7, 4)!.y).toBeCloseTo(3.75)
})

test('エンコーダーは、左回しと右回しが隣り合って並ぶ', () => {
  const [left, right] = placed.filter((key) => key.kind === 'encoder' && key.encoder === 0)
  expect(left).toMatchObject({ x: 15.25, direction: 'left' })
  expect(right).toMatchObject({ x: 16.25, y: left.y, direction: 'right' })
})

test('図全体の大きさは、回転したキーの角まで含める', () => {
  const box = boundsOf(placed)
  expect(box.minX).toBe(0)
  expect(box.minY).toBe(0)
  // 右端はエンコーダー 2 個め（x = 17.75 から 2u）
  expect(box.maxX).toBeCloseTo(19.75)
  // 下端は、23 度回転した親指のキーの角。回転を入れないと、右手の親指のキー（y = 5.38 から 1u）が下端になってしまう
  expect(box.maxY).toBeCloseTo(5.244)
})

test('キーがない時の大きさは 0', () => {
  expect(boundsOf([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
})

test('幅と高さの指定は、次のキー1つにだけ効く', () => {
  const keys = placeKeys(layoutOf([[{ w: 2, h: 1.5 }, '0,0', '0,1']]))
  expect(keys).toMatchObject([
    { x: 0, w: 2, h: 1.5 },
    { x: 2, w: 1, h: 1 },
  ])
})

test('行列やエンコーダーの数に収まらないものと、読めないラベルは除く。場所は1つぶん進める', () => {
  const keys = placeKeys(
    layoutOf([['0,0', '4,0', '0,4', 'x', '', '0,1\n\n\n\n\n\n\n\n\ne', '1,0\n\n\n\n\n\n\n\n\ne', '0,2\n\n\n\n\n\n\n\n\ne', '1,1']]),
  )
  expect(keys.map((key: PlacedKey) => [key.kind, key.x])).toEqual([
    ['key', 0],
    ['encoder', 5],
    ['key', 8],
  ])
})

test('配列の選択肢があるキーは、候補 0 のものだけを使う', () => {
  const keys = placeKeys(layoutOf([['0,0\n\n\n\n\n\n\n\n0,0', '0,1\n\n\n\n\n\n\n\n0,1', '0,2']]))
  expect(keys.map((key) => key.kind === 'key' && key.col)).toEqual([0, 2])
})

test('定義の形が違う時は、空を返す', () => {
  for (const raw of [null, {}, { layouts: {} }, { layouts: { keymap: 'x' } }, { layouts: { keymap: [1, null, [null, 3, { x: 'a' }]] } }]) {
    expect(placeKeys({ rows: 4, cols: 4, encoderCount: 0, raw })).toEqual([])
  }
})

test('レイアウト定義に書かれたファームウェアの版を取り出す。書かれていなければ undefined', () => {
  expect(firmwareVersionOf(cornix)).toBe('V1.12')
  const withLabels = (labels: unknown): LayoutDefinition => ({ rows: 1, cols: 1, encoderCount: 0, raw: { layouts: { labels } } })
  expect(firmwareVersionOf(withLabels(['Split Backspace', ['Firmware Version', 'V2.0']]))).toBe('V2.0')
  for (const labels of [undefined, 'x', [], ['Firmware Version'], [['Firmware Version']], [['Firmware Version', 1]], [['Bottom Row', 'ANSI']]]) {
    expect(firmwareVersionOf(withLabels(labels))).toBeUndefined()
  }
  expect(firmwareVersionOf({ rows: 1, cols: 1, encoderCount: 0, raw: null })).toBeUndefined()
})
