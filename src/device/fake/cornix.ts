// 実機（Cornix LP）から読んだ設定を初期値にした、偽の機器
import type { KeyboardSnapshot } from '../types.ts'
import recorded from '../fixtures/cornix/usb.json'
import { FakeKeyboard, type FakeOptions } from './fakeDevice.ts'

/** 実機から読んだ設定の写し。呼ぶたびに新しい写しを返す */
export function cornixSnapshot(): KeyboardSnapshot {
  // JSON の型では、エンコーダーとコンボのキーが、決まった長さの組にならない
  return structuredClone(recorded.snapshot) as unknown as KeyboardSnapshot
}

export function createFakeCornix(options: FakeOptions = {}): FakeKeyboard {
  return new FakeKeyboard(cornixSnapshot(), { name: 'Cornix', ...options })
}
