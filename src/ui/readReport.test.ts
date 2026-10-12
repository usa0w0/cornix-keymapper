import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { buildReadReport, countDifferences, hex16, summarizeExchanges } from './readReport.ts'

const snapshot = (): KeyboardSnapshot => ({
  uid: '0123456789abcdef',
  layout: { rows: 1, cols: 2, encoderCount: 0, raw: { matrix: { rows: 1, cols: 2 } } },
  capabilities: { viaProtocol: 9, vialProtocol: 6, layerCount: 1, tapDanceCount: 1, comboCount: 0 },
  keymap: [[0x0004, 0x5220]],
  encoders: [[]],
  tapDances: [{ onTap: 4, onHold: 0xe0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 200 }],
  combos: [],
})

test('通信の回数、タイムアウト、かかった時間をまとめる', () => {
  const stats = summarizeExchanges([
    { request: '01', response: '010009', ms: 10 },
    { request: '11', response: null, ms: 1000 },
    { request: '11', response: '1104', ms: 30 },
  ])
  expect(stats).toEqual({ count: 3, timeouts: 1, totalMs: 1040, averageMs: 20, maxMs: 30 })
})

test('キーコードを 4 桁の 16 進で表す', () => {
  expect(hex16(0x4)).toBe('0x0004')
  expect(hex16(0x5220)).toBe('0x5220')
})

test('同じ読み出しどうしは違いが 0、違う箇所があればその数', () => {
  expect(countDifferences(snapshot(), snapshot())).toBe(0)
  const changed = snapshot()
  changed.keymap[0][1] = 0x5221
  changed.tapDances[0].tappingTerm = 250
  expect(countDifferences(snapshot(), changed)).toBe(2)
})

test('書き出し用の記録は、通信を「要求>応答@ミリ秒」に縮める', () => {
  const report = buildReadReport({
    readAt: new Date('2026-10-11T00:00:00Z'),
    userAgent: 'test',
    device: { name: 'Cornix', protocol: 'VIA プロトコル 9' },
    snapshot: snapshot(),
    differencesFromPrevious: null,
    exchanges: [
      { request: '0100000000', response: '0100090000', ms: 12 },
      { request: 'fe0d0000', response: null, ms: 1000 },
    ],
  })
  expect(report.exchanges).toEqual(['01>010009@12', 'fe0d>-@1000'])
  expect(report.readAt).toBe('2026-10-11T00:00:00.000Z')
  expect(report.stats.timeouts).toBe(1)
})
