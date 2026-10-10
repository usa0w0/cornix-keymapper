import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { DeviceError, type KeyboardSnapshot } from '../device/types.ts'
import { describeReadError, ReadResult } from './ReadPanel.tsx'
import { buildReadReport } from './readReport.ts'
import { formatDuration } from './useConnection.ts'

const snapshot: KeyboardSnapshot = {
  uid: '0123456789abcdef',
  layout: { rows: 2, cols: 2, encoderCount: 1, raw: { matrix: { rows: 2, cols: 2 } } },
  capabilities: { viaProtocol: 9, vialProtocol: 6, layerCount: 1, tapDanceCount: 1, comboCount: 1 },
  keymap: [[0x0004, 0x0005, 0x5220, 0x0001]],
  encoders: [[[0x0081, 0x0080]]],
  tapDances: [{ onTap: 4, onHold: 0xe0, onDoubleTap: 0x29, onTapHold: 0, tappingTerm: 200 }],
  combos: [{ keys: [4, 5, 0, 0], output: 0x29 }],
}

const render = (differencesFromPrevious: number | null) =>
  renderToStaticMarkup(
    <ReadResult
      report={buildReadReport({
        readAt: new Date('2026-10-11T00:00:00Z'),
        userAgent: 'test',
        device: { name: 'Cornix', protocol: 'VIA プロトコル 9' },
        snapshot,
        differencesFromPrevious,
        exchanges: [{ request: '01', response: '010009', ms: 12 }],
      })}
    />,
  )

test('読み出した値を、生の値のまま表示する', () => {
  const html = render(null)
  expect(html).toContain('0123456789abcdef')
  expect(html).toContain('2 行 × 2 列')
  expect(html).toContain('<td>0x5220</td>')
  expect(html).toContain('左回し 0x0081 / 右回し 0x0080')
  expect(html).toContain('<td>200</td>')
  expect(html).toContain('1 回、合計 0.0 秒、平均 12 ミリ秒、最長 12 ミリ秒、タイムアウト 0 回')
  expect(html).not.toContain('前回の読み出し')
})

test('前回の読み出しと比べた結果を表示する', () => {
  expect(render(0)).toContain('前回の読み出しと一致しました。')
  expect(render(3)).toContain('前回の読み出しと 3 か所が違います。')
})

test('接続していた時間を、秒か「分 秒」で表す', () => {
  expect(formatDuration(42_400)).toBe('42 秒')
  expect(formatDuration(185_000)).toBe('3 分 5 秒')
})

test('読み出しの失敗は、どこで失敗したかと次の操作を伝える', () => {
  const message = describeReadError(new DeviceError('timeout', { step: 'キーマップ' }))
  expect(message).toContain('「キーマップ」を読んでいる途中で')
  expect(message).toContain('「もう一度読み出す」を押してください')
})
