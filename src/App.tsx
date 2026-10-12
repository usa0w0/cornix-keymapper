import { useRef, useState } from 'react'
import { isWebHidSupported } from './browserSupport.ts'
import type { DeviceConnector } from './device/types.ts'
import { AppHeader } from './ui/AppHeader.tsx'
import { DeviceInfoDialog } from './ui/DeviceInfoDialog.tsx'
import { slotCounts } from './ui/deviceInfo.ts'
import { KeymapView } from './ui/KeymapView.tsx'
import { ConnectStage, ReadFailedStage, ReadingStage } from './ui/Stage.tsx'
import { UnsupportedBrowserWarning } from './ui/UnsupportedBrowserWarning.tsx'
import { useConnection } from './ui/useConnection.ts'
import { useDeviceRead } from './ui/useDeviceRead.ts'

type Tab = 'keymap' | 'combo'

const TABS: readonly { id: Tab; name: string }[] = [
  { id: 'keymap', name: 'キーマップ' },
  { id: 'combo', name: 'コンボ' },
]

interface Props {
  connector: DeviceConnector
  /** このブラウザーで接続できるか。省くと、WebHID があるかで決める */
  supported?: boolean
}

/** 画面の枠組み。上から、知らせの帯、ヘッダー、タブ、中身（接続前と読み出しの間は、中央のカード） */
function App({ connector, supported = isWebHidSupported() }: Props) {
  const { state: connection, open, close } = useConnection(connector)
  const device = connection.status === 'connected' ? connection.device : null
  const { state: reading, read, replace } = useDeviceRead(device)
  const [tab, setTab] = useState<Tab>('keymap')
  const info = useRef<HTMLDialogElement>(null)
  const report = reading?.status === 'done' ? reading.report : null

  // 開いた時は、最初の押せる部品（診断の見出し）ではなく、「閉じる」に焦点を置く
  const showInfo = () => {
    info.current?.showModal()
    info.current?.querySelector<HTMLButtonElement>('.dialog-actions button')?.focus()
  }

  // 接続したら、利用者が押さなくても、続けて読み出す
  const connect = async () => {
    const connected = await open()
    if (connected) await read(connected)
  }

  return (
    <div className="app">
      {!supported && <UnsupportedBrowserWarning />}
      <AppHeader
        connection={connection}
        supported={supported}
        slots={report && slotCounts(report.snapshot)}
        onConnect={connect}
        onDisconnect={close}
        onDeviceInfo={showInfo}
      />
      {!device || !reading ? (
        <ConnectStage
          supported={supported}
          connecting={connection.status === 'connecting'}
          notice={connection.status === 'disconnected' ? connection.notice : undefined}
          onConnect={connect}
        />
      ) : reading.status === 'reading' ? (
        <ReadingStage progress={reading.progress} />
      ) : reading.status === 'failed' ? (
        <ReadFailedStage failure={reading.failure} onRetry={() => read(device)} />
      ) : (
        <>
          <nav className="app-tabs" aria-label="画面の切り替え">
            {TABS.map(({ id, name }) => (
              <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {name}
              </button>
            ))}
          </nav>
          <main>
            {tab === 'keymap' ? (
              <KeymapView snapshot={reading.report.snapshot} />
            ) : (
              <p className="placeholder">コンボの設定は準備中です。</p>
            )}
          </main>
          <DeviceInfoDialog
            ref={info}
            device={device}
            report={reading.report}
            onReport={(next) => replace(device, next)}
          />
        </>
      )}
    </div>
  )
}

export default App
