import { expect, test } from 'vitest'
import { findReportId } from './connect.ts'

const collection = (usagePage: number, usage: number, reportId?: number): HIDCollectionInfo => ({
  usagePage,
  usage,
  outputReports: reportId === undefined ? [] : [{ reportId }],
})

test('Raw HID の出力レポートの ID を返す', () => {
  const device = { collections: [collection(0x01, 0x06, 1), collection(0xff60, 0x61, 4)] }
  expect(findReportId(device)).toBe(4)
})

test('出力レポートの情報がなければ 0 を返す', () => {
  expect(findReportId({ collections: [collection(0xff60, 0x61)] })).toBe(0)
  expect(findReportId({ collections: [] })).toBe(0)
})
