import { useCallback, useEffect, useState } from 'react'
import { DeviceError, type DeviceConnector, type KeyboardDevice } from '../device/types.ts'

export type ConnectionState =
  /** lostAfterMs は、こちらから切ったのではなく、機器がなくなった時の、接続していた時間 */
  | { status: 'disconnected'; notice?: string; lostAfterMs?: number }
  | { status: 'connecting' }
  | { status: 'connected'; device: KeyboardDevice }

export function useConnection(connector: DeviceConnector) {
  const [state, setState] = useState<ConnectionState>({ status: 'disconnected' })
  const device = state.status === 'connected' ? state.device : null

  /** 機器選択を開いて接続する。接続できたら、その機器を返す（続けて読み出すため）。できなければ null */
  const open = useCallback(async (): Promise<KeyboardDevice | null> => {
    setState({ status: 'connecting' })
    try {
      const connected = await connector.connect()
      setState(connected ? { status: 'connected', device: connected } : { status: 'disconnected' })
      return connected
    } catch (error) {
      setState({ status: 'disconnected', notice: describeError(error) })
      return null
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
    const connectedAt = Date.now()
    return device.onDisconnect(() => {
      const lostAfterMs = Date.now() - connectedAt
      setState({
        status: 'disconnected',
        notice: `キーボードとの接続が切れました。つなぎ直してから「接続」を押してください。（接続していた時間: ${formatDuration(lostAfterMs)}）`,
        lostAfterMs,
      })
    })
  }, [device])

  return { state, open, close }
}

/** ミリ秒を「3 分 5 秒」の形にする */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

/** 接続していない間の知らせ。編集が残っていることを添える */
export function disconnectedNotice(connection: ConnectionState, changes: number): string {
  const kept = changes > 0 ? `編集した内容（${changes} 件）は画面に残っています。` : ''
  if (connection.status === 'connecting') return `キーボードに接続しています…${kept}`
  if (connection.status === 'connected') return ''
  if (connection.lostAfterMs !== undefined) {
    return `キーボードとの接続が切れました。${kept}つなぎ直してから「接続」を押してください。（接続していた時間: ${formatDuration(connection.lostAfterMs)}）`
  }
  // 接続できなかった時は、その理由を出す
  if (connection.notice) return `${connection.notice}${kept}`
  return `キーボードとの接続を切りました。${kept}続けるには「接続」を押してください。`
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
