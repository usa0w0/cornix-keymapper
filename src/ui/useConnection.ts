import { useCallback, useEffect, useState } from 'react'
import { DeviceError, type DeviceConnector, type KeyboardDevice } from '../device/types.ts'

export type ConnectionState =
  | { status: 'disconnected'; notice?: string }
  | { status: 'connecting' }
  | { status: 'connected'; device: KeyboardDevice }

export function useConnection(connector: DeviceConnector) {
  const [state, setState] = useState<ConnectionState>({ status: 'disconnected' })
  const device = state.status === 'connected' ? state.device : null

  const open = useCallback(async () => {
    setState({ status: 'connecting' })
    try {
      const connected = await connector.connect()
      setState(connected ? { status: 'connected', device: connected } : { status: 'disconnected' })
    } catch (error) {
      setState({ status: 'disconnected', notice: describeError(error) })
    }
  }, [connector])

  const close = useCallback(async () => {
    if (!device) return
    setState({ status: 'disconnected' })
    await device.disconnect().catch(() => {})
  }, [device])

  // ケーブルを抜く、Bluetooth が切れる、などで機器がなくなった時
  useEffect(() => {
    if (!device) return
    return device.onDisconnect(() => {
      setState({
        status: 'disconnected',
        notice: 'キーボードとの接続が切れました。つなぎ直してから「接続」を押してください。',
      })
    })
  }, [device])

  return { state, open, close }
}

export function describeError(error: unknown): string {
  if (error instanceof DeviceError) {
    switch (error.kind) {
      case 'timeout':
        return 'キーボードから応答がありません。電源と接続を確かめて、もう一度「接続」を押してください。'
      case 'send-failed':
        return 'キーボードへ送信できませんでした。つなぎ直してから、もう一度「接続」を押してください。'
      case 'disconnected':
        return 'キーボードとの接続が切れました。つなぎ直してから「接続」を押してください。'
      case 'unexpected-response':
        return 'キーボードから想定と違う応答が返りました。Vial など他のアプリやタブで開いている場合は閉じて、もう一度「接続」を押してください。'
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return `キーボードを開けませんでした。Vial など他のアプリで開いている場合は閉じてください。（${detail}）`
}
