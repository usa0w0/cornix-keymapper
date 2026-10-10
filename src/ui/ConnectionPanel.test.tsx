import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { DeviceError, type KeyboardDevice } from '../device/types.ts'
import { ConnectionPanel } from './ConnectionPanel.tsx'
import { describeError, type ConnectionState } from './useConnection.ts'

const render = (state: ConnectionState) =>
  renderToStaticMarkup(<ConnectionPanel state={state} onConnect={() => {}} onDisconnect={() => {}} />)

const device: KeyboardDevice = {
  name: 'Cornix',
  protocol: 'VIA プロトコル 9',
  onDisconnect: () => () => {},
  disconnect: async () => {},
  read: () => Promise.reject(new Error('使わない')),
  exchangeCount: () => 0,
  exchanges: () => [],
}

test('未接続では「接続」ボタンを出す', () => {
  const html = render({ status: 'disconnected' })
  expect(html).toContain('未接続')
  expect(html).toContain('接続</button>')
})

test('接続済みでは機器名と通信方式を出し、「切断」ボタンに替わる', () => {
  const html = render({ status: 'connected', device })
  expect(html).toContain('接続済み: Cornix（VIA プロトコル 9）')
  expect(html).toContain('切断</button>')
})

test('切断の知らせを表示する', () => {
  const html = render({ status: 'disconnected', notice: describeError(new DeviceError('timeout')) })
  expect(html).toContain('キーボードから応答がありません')
})

test('想定と違う応答には、他のアプリやタブを閉じるよう案内する', () => {
  expect(describeError(new DeviceError('unexpected-response'))).toContain('他のアプリやタブ')
})
