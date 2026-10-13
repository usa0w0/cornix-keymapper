import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import { deviceInfoRows, slotCounts } from './deviceInfo.ts'

// 実機（Cornix LP）から読んだ設定
const cornix = () => structuredClone(recorded.snapshot) as unknown as KeyboardSnapshot
const device = { name: 'Cornix', protocol: 'VIA プロトコル 9' }

const valueOf = (snapshot: KeyboardSnapshot, label: string) =>
  deviceInfoRows(device, snapshot).find((row) => row.label === label)?.value

test('実機の設定: Tap Dance は 32 枠のうち 2 枠を使っていて、コンボは 32 枠すべて空いている', () => {
  expect(slotCounts(cornix())).toEqual({ tapDance: { total: 32, free: 30 }, combo: { total: 32, free: 32 } })
})

test('中身が空でも、どこかから指されている Tap Dance の枠は、空いている枠に数えない', () => {
  const free = (change: (snapshot: KeyboardSnapshot) => void) => {
    const snapshot = cornix()
    change(snapshot)
    return slotCounts(snapshot).tapDance.free
  }
  // 枠 5 は空で、どこからも指されていない
  expect(free((s) => (s.keymap[0][0] = 0x5705))).toBe(29)
  expect(free((s) => (s.encoders[0][0][1] = 0x5705))).toBe(29)
  expect(free((s) => (s.combos[0] = { keys: [4, 5, 0, 0], output: 0x5705 }))).toBe(29)
  // 中身が入っている枠は、どこからも指されていなくても、空いている枠に数えない
  expect(free((s) => (s.tapDances[5].onDoubleTap = 0x0029))).toBe(29)
})

test('キーか出力が入っているコンボの枠は、空いている枠に数えない', () => {
  const snapshot = cornix()
  snapshot.combos[0] = { keys: [4, 5, 0, 0], output: 0x29 }
  snapshot.combos[1] = { keys: [4, 0, 0, 0], output: 0 }
  expect(slotCounts(snapshot).combo).toEqual({ total: 32, free: 30 })
})

test('実機の設定: 本体の情報に、ファームウェアの版、Vial の版、レイヤー数、対応機能と枠数、切り替えの方式を出す', () => {
  expect(deviceInfoRows(device, cornix())).toEqual([
    { label: '機器', value: 'Cornix（ファームウェア V1.12）' },
    { label: '通信', value: 'VIA プロトコル 9 ・ Vial の版 6' },
    { label: 'レイヤー', value: '10' },
    { label: '長押し・2回タップの組み合わせ', value: '使える（Tap Dance の枠 32 個、残り 30）' },
    { label: 'コンボ', value: '使える（枠 32 個、残り 32）' },
    { label: 'ロータリーエンコーダー', value: '2 つ' },
    {
      label: 'レイヤー切り替え',
      value: '押している間だけ ・ 押すたびにオン・オフ ・ そのレイヤーに移動 ・ 次の1キーだけ（実機で確認済み）',
    },
  ])
})

test('枠やエンコーダーのない本体では、その機能を「使えない」「なし」と出す', () => {
  const snapshot = cornix()
  snapshot.tapDances = []
  snapshot.combos = []
  snapshot.layout = { ...snapshot.layout, encoderCount: 0, raw: {} }
  expect(valueOf(snapshot, '機器')).toBe('Cornix（ファームウェアの版は不明）')
  expect(valueOf(snapshot, '長押し・2回タップの組み合わせ')).toBe('使えない（本体に Tap Dance の枠がありません）')
  expect(valueOf(snapshot, 'コンボ')).toBe('使えない（本体にコンボの枠がありません）')
  expect(valueOf(snapshot, 'ロータリーエンコーダー')).toBe('なし')
})

test('確かめていない Vial の版では、切り替えの方式をすべて出したうえで、確かめていないと伝える', () => {
  const snapshot = cornix()
  snapshot.capabilities.vialProtocol = 7
  expect(valueOf(snapshot, 'レイヤー切り替え')).toBe(
    '押している間だけ ・ 押すたびにオン・オフ ・ そのレイヤーに移動 ・ 次の1キーだけ（この Vial の版では、動くかを確かめていません）',
  )
})
