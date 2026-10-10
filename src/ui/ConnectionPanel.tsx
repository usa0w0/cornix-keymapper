import { isWebHidSupported } from '../browserSupport.ts'
import type { ConnectionState } from './useConnection.ts'

interface Props {
  state: ConnectionState
  onConnect: () => void
  onDisconnect: () => void
}

export function ConnectionPanel({ state, onConnect, onDisconnect }: Props) {
  return (
    <section className="connection" aria-label="接続">
      <p className="connection-status" aria-live="polite">
        {statusText(state)}
      </p>
      {state.status === 'connected' ? (
        <button type="button" onClick={onDisconnect}>
          切断
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={state.status === 'connecting' || !isWebHidSupported()}
        >
          接続
        </button>
      )}
      {state.status === 'disconnected' && state.notice && (
        <p className="notice" role="alert">
          {state.notice}
        </p>
      )}
    </section>
  )
}

function statusText(state: ConnectionState): string {
  switch (state.status) {
    case 'disconnected':
      return '未接続'
    case 'connecting':
      return '接続中…'
    case 'connected': {
      const name = state.connection.device.productName || '名前のない機器'
      return `接続済み: ${name}（VIA プロトコル ${state.connection.viaProtocolVersion}）`
    }
  }
}
