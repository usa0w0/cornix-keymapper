import { useCallback, useEffect, useRef, useState } from 'react'
import { connect, disconnect, requestDevice, type Connection } from '../device/vial/connect.ts'
import { TransportError } from '../device/vial/transport.ts'

export type ConnectionState =
  | { status: 'disconnected'; notice?: string }
  | { status: 'connecting' }
  | { status: 'connected'; connection: Connection }

export function useConnection() {
  const [state, setState] = useState<ConnectionState>({ status: 'disconnected' })
  const current = useRef<Connection | null>(null)

  const open = useCallback(async () => {
    try {
      const device = await requestDevice()
      if (!device) return
      setState({ status: 'connecting' })
      const connection = await connect(device)
      current.current = connection
      setState({ status: 'connected', connection })
    } catch (error) {
      setState({ status: 'disconnected', notice: describeError(error) })
    }
  }, [])

  const close = useCallback(async () => {
    const connection = current.current
    if (!connection) return
    current.current = null
    setState({ status: 'disconnected' })
    await disconnect(connection).catch(() => {})
  }, [])

  // ケーブルを抜く、Bluetooth が切れる、などで機器がなくなった時
  useEffect(() => {
    if (!('hid' in navigator)) return
    const onDisconnect = (event: HIDConnectionEvent) => {
      const connection = current.current
      if (connection?.device !== event.device) return
      current.current = null
      connection.transport.close()
      setState({
        status: 'disconnected',
        notice: 'キーボードとの接続が切れました。つなぎ直してから「接続」を押してください。',
      })
    }
    navigator.hid.addEventListener('disconnect', onDisconnect)
    return () => navigator.hid.removeEventListener('disconnect', onDisconnect)
  }, [])

  return { state, open, close }
}

function describeError(error: unknown): string {
  if (error instanceof TransportError) {
    switch (error.kind) {
      case 'timeout':
        return 'キーボードから応答がありません。電源と接続を確かめて、もう一度「接続」を押してください。'
      case 'send-failed':
        return 'キーボードへ送信できませんでした。つなぎ直してから、もう一度「接続」を押してください。'
      case 'disconnected':
        return 'キーボードとの接続が切れました。つなぎ直してから「接続」を押してください。'
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return `キーボードを開けませんでした。Vial など他のアプリで開いている場合は閉じてください。（${detail}）`
}
