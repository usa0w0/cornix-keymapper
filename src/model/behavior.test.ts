import { expect, test } from 'vitest'
import type { Action } from './action.ts'
import { withoutSlot, withSlot } from './behavior.ts'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const B: Action = { kind: 'key', code: 0x05, mods: [] }
const CTRL: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] }
const NONE: Action = { kind: 'none' }
const BT0: Action = { kind: 'unsupported', raw: 0x7e00, label: 'BT0' }

test('欄に動作を入れる: ほかの欄は残し、同じ欄は置き換える', () => {
  expect(withSlot({ tap: A }, 'hold', CTRL)).toEqual({ tap: A, hold: CTRL })
  expect(withSlot({ tap: A, hold: CTRL }, 'tap', B)).toEqual({ tap: B, hold: CTRL })
})

test('何もしないキーと透過のキーに動作を入れると、その欄だけのキーになる（透過ではなくなる）', () => {
  expect(withSlot({ tap: NONE }, 'hold', CTRL)).toEqual({ hold: CTRL })
  expect(withSlot({ tap: { kind: 'transparent' } }, 'doubleTap', A)).toEqual({ doubleTap: A })
  expect(withSlot({ tap: { kind: 'transparent' } }, 'tap', A)).toEqual({ tap: A })
})

test('編集不可のキーに動作を入れると、元の内容を残さずに、その欄だけのキーになる（上書き）', () => {
  expect(withSlot({ tap: BT0 }, 'tap', A)).toEqual({ tap: A })
  expect(withSlot({ tap: A, hold: BT0 }, 'doubleTap', B)).toEqual({ doubleTap: B })
})

test('欄を消す: ほかの欄は残す。4つとも空になったら、何もしないキー', () => {
  expect(withoutSlot({ tap: A, hold: CTRL }, 'hold')).toEqual({ tap: A })
  expect(withoutSlot({ tap: A, hold: CTRL }, 'tap')).toEqual({ hold: CTRL })
  expect(withoutSlot({ tap: A }, 'tap')).toEqual({ tap: NONE })
  // 空の欄を消しても変わらない
  expect(withoutSlot({ tap: A }, 'hold')).toEqual({ tap: A })
})
