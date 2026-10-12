import type { ReadState } from './useDeviceRead.ts'
import { disconnectedNotice, type ConnectionState } from './useConnection.ts'

interface Props {
  connection: ConnectionState
  /** 接続中の機器の読み出しの状態。接続していなければ null */
  reading: ReadState | null
  /** このブラウザーで接続できるか（WebHID があるか） */
  supported: boolean
  /** 編集の数 */
  changes: number
  onConnect: () => void
  onRetry: () => void
}

/**
 * 読み込んだ内容を画面に残したまま、本体とつながっていない間に、いちばん上に出し続ける帯。
 * 接続が切れた時は「接続」を、つなぎ直した後の読み直しに失敗した時は「もう一度読み出す」を添える。
 * 本体とつながっていて、読み直しも終わっていれば、何も出さない
 */
export function SessionBanner({ connection, reading, supported, changes, onConnect, onRetry }: Props) {
  if (connection.status !== 'connected') {
    const connecting = connection.status === 'connecting'
    return (
      <p className="banner banner-warning" role="alert">
        {disconnectedNotice(connection, changes)}
        <button type="button" className="primary" onClick={onConnect} disabled={connecting || !supported}>
          {connecting ? '接続中…' : '接続'}
        </button>
      </p>
    )
  }
  if (reading?.status === 'failed') {
    return (
      <p className="banner banner-warning" role="alert">
        つなぎ直した後、本体の設定を読み直せませんでした。{reading.failure.cause}
        {reading.failure.advice}
        <button type="button" className="primary" onClick={onRetry}>
          もう一度読み出す
        </button>
      </p>
    )
  }
  if (reading?.status === 'reading') {
    return (
      <p className="banner banner-warning" role="status">
        本体の設定を読み直しています…{reading.progress && `（${reading.progress.step}）`}
      </p>
    )
  }
  return null
}
