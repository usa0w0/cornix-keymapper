import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import usb from '../device/fixtures/cornix/usb.json'
import bluetooth from '../device/fixtures/cornix/bluetooth.json'
import { isKeyboardSnapshot, sameSnapshot } from './snapshot.ts'

const cornix = () => structuredClone(usb.snapshot) as unknown as KeyboardSnapshot

test('実機から読んだ設定は、スナップショットの形をしている。JSON に通しても同じ内容', () => {
  expect(isKeyboardSnapshot(usb.snapshot)).toBe(true)
  expect(isKeyboardSnapshot(bluetooth.snapshot)).toBe(true)

  const restored: unknown = JSON.parse(JSON.stringify(cornix()))
  expect(isKeyboardSnapshot(restored) && sameSnapshot(restored, cornix())).toBe(true)
})

test.each<[string, (snapshot: any) => void]>([
  ['UID がない', (s) => delete s.uid],
  ['レイアウト定義の中身がない', (s) => delete s.layout.raw],
  ['行列の大きさが数でない', (s) => (s.layout.rows = '8')],
  ['枠数がない', (s) => delete s.capabilities.comboCount],
  ['キーコードが数でない', (s) => (s.keymap[1][2] = 'KC_A')],
  ['キーコードが null（NaN を JSON に通したもの）', (s) => (s.keymap[1][2] = null)],
  ['キーコードが整数でない', (s) => (s.keymap[1][2] = 1.5)],
  ['レイヤーが足りない', (s) => s.keymap.pop()],
  ['キーが足りない', (s) => s.keymap[3].pop()],
  ['エンコーダーが足りない', (s) => s.encoders[0].pop()],
  ['エンコーダーの向きが1つしかない', (s) => s.encoders[0][0].pop()],
  ['Tap Dance の枠が足りない', (s) => s.tapDances.pop()],
  ['Tap Dance の時間の値がない', (s) => delete s.tapDances[0].tappingTerm],
  ['コンボの枠が多い', (s) => s.combos.push({ keys: [0, 0, 0, 0], output: 0 })],
  ['コンボのキーが4つでない', (s) => s.combos[0].keys.pop()],
  ['コンボの出力がない', (s) => delete s.combos[0].output],
])('スナップショットの形でないもの: %s', (_, change) => {
  const snapshot = cornix()
  change(snapshot)
  expect(isKeyboardSnapshot(snapshot)).toBe(false)
})

test('オブジェクトでないものは、スナップショットではない', () => {
  for (const value of [null, undefined, 'text', 1, [], {}]) expect(isKeyboardSnapshot(value)).toBe(false)
})
