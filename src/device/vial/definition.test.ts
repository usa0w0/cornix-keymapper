import { expect, test } from 'vitest'
import { decompressDefinition, parseDefinition } from './definition.ts'
import { definitionJson } from './testing/definitionFixture.ts'
import { sampleState } from './testing/sampleState.ts'

test('XZ 圧縮された定義を展開できる', async () => {
  const compressed = new Uint8Array(sampleState().compressedDefinition)
  expect(await decompressDefinition(compressed)).toEqual(definitionJson)
})

test('定義から、行列の大きさとエンコーダーの数を取り出す', () => {
  const layout = parseDefinition(definitionJson)
  expect(layout).toMatchObject({ rows: 2, cols: 3, encoderCount: 1 })
  expect(layout.raw).toBe(definitionJson)
})

test('エンコーダーのない定義では、エンコーダーの数は 0', () => {
  const layout = parseDefinition({ matrix: { rows: 1, cols: 2 }, layouts: { keymap: [['0,0', '0,1']] } })
  expect(layout.encoderCount).toBe(0)
})

test('matrix のない定義は失敗する', () => {
  expect(() => parseDefinition({ layouts: {} })).toThrow()
  expect(() => parseDefinition(null)).toThrow()
})

test('行と列が 1〜255 の整数でない定義は失敗する', () => {
  for (const matrix of [{ rows: 0, cols: 3 }, { rows: 2, cols: 256 }, { rows: 2.5, cols: 3 }, { rows: '2', cols: 3 }]) {
    expect(() => parseDefinition({ matrix, layouts: { keymap: [] } })).toThrow()
  }
})

test('エンコーダーの番号が 0〜255 の整数でない定義は失敗する', () => {
  const withEncoder = (label: string) => ({
    matrix: { rows: 1, cols: 1 },
    layouts: { keymap: [[`${label}\n\n\n\n\n\n\n\n\ne`]] },
  })
  expect(parseDefinition(withEncoder('3,0')).encoderCount).toBe(4)
  for (const label of ['999999,0', '-1,0', 'x,0', '1.5,0']) {
    expect(() => parseDefinition(withEncoder(label))).toThrow()
  }
})
