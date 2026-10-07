import { expect, test } from 'vitest'
import { isWebHidSupported } from './browserSupport.ts'

test('navigator.hid があれば対応ブラウザーと判定する', () => {
  expect(isWebHidSupported({ hid: {} })).toBe(true)
})

test('navigator.hid がなければ非対応ブラウザーと判定する', () => {
  expect(isWebHidSupported({})).toBe(false)
})
