import { useRef } from 'react'
import type { ConnectionState } from './useConnection.ts'
import type { SlotCount } from './deviceInfo.ts'
import { isDevSite } from './site.ts'

interface Props {
  connection: ConnectionState
  /** このブラウザーで接続できるか（WebHID があるか） */
  supported: boolean
  /** 読み込んだ内容がある時の、残り枠数。1回も読み出していなければ null。接続が切れても出し続ける */
  slots: { tapDance: SlotCount; combo: SlotCount } | null
  /** 変更の件数（変更点の一覧の行数） */
  changes: number
  /** 変更点の確認のダイアログを開く。変更がない間は null */
  onWrite: (() => void) | null
  /** 自動バックアップの一覧を開く */
  onBackups: () => void
  /** 画面の内容を .vil に保存する（保存の前の確認を開く） */
  onSaveVil: () => void
  /** 利用者が選んだ .vil を読み込む */
  onLoadVil: (file: File) => void
  onConnect: () => void
  onDisconnect: () => void
  /** 本体の情報のダイアログを開く。接続中の機器を読み終えるまでは null */
  onDeviceInfo: (() => void) | null
}

/** ヘッダー。タイトル、接続の状態、残り枠数と、保存・書き込みのボタン */
export function AppHeader({
  connection,
  supported,
  slots,
  changes,
  onWrite,
  onBackups,
  onSaveVil,
  onLoadVil,
  onConnect,
  onDisconnect,
  onDeviceInfo,
}: Props) {
  const file = useRef<HTMLInputElement>(null)
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
          <button type="button" title="自動バックアップの一覧を見る" onClick={onBackups}>
            バックアップ
          </button>
          <button type="button" title="この画面の内容を、Vial と同じ形式のファイルに保存する" onClick={onSaveVil}>
            .vil に保存
          </button>
          <button type="button" title="Vial やこのサイトで保存したファイルを、この画面に読み込む" onClick={() => file.current?.click()}>
            .vil を読み込む
          </button>
          {/* ファイルを選ぶ部品は見せず、上のボタンから開く。同じファイルを続けて選べるように、選んだら空に戻す */}
          <input
            ref={file}
            type="file"
            accept=".vil,application/json"
            hidden
            aria-label=".vil ファイルを選ぶ"
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              event.target.value = ''
              if (chosen) onLoadVil(chosen)
            }}
          />
          {/* 押すと、変更点の確認のダイアログが出る。接続が切れている間も、変更点を見て、取り消せる */}
          <button
            type="button"
            className="primary"
            disabled={!onWrite}
            title={onWrite ? '変更点を確かめる' : '変更はありません'}
            onClick={onWrite ?? undefined}
          >
            書き込み（変更 {changes} 件）
          </button>
        </>
      )}
    </header>
  )
}
