import type { ConnectionState } from './useConnection.ts'
import type { SlotCount } from './deviceInfo.ts'

// develop のビルドは /cornix-keymapper/dev/ で配信される（.github/workflows/deploy.yml）
const isDevSite = import.meta.env.BASE_URL.endsWith('/dev/')

interface Props {
  connection: ConnectionState
  /** このブラウザーで接続できるか（WebHID があるか） */
  supported: boolean
  /** 読み込んだ内容がある時の、残り枠数。1回も読み出していなければ null。接続が切れても出し続ける */
  slots: { tapDance: SlotCount; combo: SlotCount } | null
  /** 編集の数 */
  changes: number
  onConnect: () => void
  onDisconnect: () => void
  /** 本体の情報のダイアログを開く。接続中の機器を読み終えるまでは null */
  onDeviceInfo: (() => void) | null
}

/** ヘッダー。タイトル、接続の状態、残り枠数と、保存・書き込みのボタン */
export function AppHeader({ connection, supported, slots, changes, onConnect, onDisconnect, onDeviceInfo }: Props) {
  return (
    <header className="app-header">
      <h1>
        Cornix キーマッパー{isDevSite && <span className="badge">開発版</span>}
      </h1>
      {connection.status === 'connected' ? (
        <>
          {onDeviceInfo ? (
            <button type="button" className="chip chip-ok" title="接続中のキーボードの情報を見る" onClick={onDeviceInfo}>
              接続済み: {connection.device.name} ▾
            </button>
          ) : (
            <span className="chip chip-off">接続済み: {connection.device.name}</span>
          )}
          <button type="button" className="quiet" onClick={onDisconnect}>
            切断
          </button>
        </>
      ) : (
        <>
          <span className="chip chip-off" aria-live="polite">
            {connection.status === 'connecting' ? '接続中…' : '未接続'}
          </span>
          <button type="button" onClick={onConnect} disabled={connection.status === 'connecting' || !supported}>
            接続
          </button>
        </>
      )}
      <span className="spacer" />
      {slots && (
        <>
          <span className="slots" title="長押しや2回タップを組み合わせたキーが使う枠">
            Tap Dance 残り <b>{slots.tapDance.free}</b> / {slots.tapDance.total}
          </span>
          <span className="slots">
            コンボ 残り <b>{slots.combo.free}</b> / {slots.combo.total}
          </span>
          {/* ここから下の4つは置き場所だけ。中身は、バックアップと書き込みが #15、.vil が #16。件数は、編集の数（変更点の一覧は #14） */}
          <button type="button" disabled title="準備中">
            バックアップ
          </button>
          <button type="button" disabled title="準備中">
            .vil に保存
          </button>
          <button type="button" disabled title="準備中">
            .vil を読み込む
          </button>
          <button type="button" className="primary" disabled title="準備中">
            書き込み（変更 {changes} 件）
          </button>
        </>
      )}
    </header>
  )
}
