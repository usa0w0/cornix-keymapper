import { useMemo, useReducer, useRef, useState } from 'react'
import { isWebHidSupported } from './browserSupport.ts'
import type { DeviceConnector, KeyboardDevice } from './device/types.ts'
import { countEdits, EMPTY_SESSION, hasUnwrittenChanges, sessionReducer, type ReloadChoice } from './session/editState.ts'
import { AppHeader } from './ui/AppHeader.tsx'
import { DebugEditPanel, type DebugTools } from './ui/DebugEditPanel.tsx'
import { DeviceInfoDialog } from './ui/DeviceInfoDialog.tsx'
import { slotCounts } from './ui/deviceInfo.ts'
import { EditSessionContext } from './ui/editContext.ts'
import { KeymapView } from './ui/KeymapView.tsx'
import { ReloadDialog } from './ui/ReloadDialog.tsx'
import { SessionBanner } from './ui/SessionBanner.tsx'
import { ConnectStage, ReadFailedStage, ReadingStage } from './ui/Stage.tsx'
import { UnsupportedBrowserWarning } from './ui/UnsupportedBrowserWarning.tsx'
import { useConnection } from './ui/useConnection.ts'
import { useDeviceRead } from './ui/useDeviceRead.ts'
import { useLeaveConfirm } from './ui/useLeaveConfirm.ts'

type Tab = 'keymap' | 'combo'

const TABS: readonly { id: Tab; name: string }[] = [
  { id: 'keymap', name: 'キーマップ' },
  { id: 'combo', name: 'コンボ' },
]

interface Props {
  connector: DeviceConnector
  /** このブラウザーで接続できるか。省くと、WebHID があるかで決める */
  supported?: boolean
  /** 偽の機器への操作。渡すと、確認用の仮の入口を出す（?fake&debugEdit。編集欄ができたら消す） */
  debug?: DebugTools
}

/**
 * 画面の枠組み。上から、知らせの帯、ヘッダー、タブ、中身。
 * 1回も読み出していない間は、中身の代わりに中央のカードを出す。
 * 読み出した後は、接続が切れても、読み込んだ内容と編集を画面に残し、帯で知らせる
 */
function App({ connector, supported = isWebHidSupported(), debug }: Props) {
  const { state: connection, open, close } = useConnection(connector)
  const device = connection.status === 'connected' ? connection.device : null
  const { state: reading, read, replace } = useDeviceRead(device)
  const [session, dispatch] = useReducer(sessionReducer, EMPTY_SESSION)
  const store = useMemo(() => ({ session, dispatch }), [session])
  const [tab, setTab] = useState<Tab>('keymap')
  const info = useRef<HTMLDialogElement>(null)
  const report = reading?.status === 'done' ? reading.report : null
  const { edit, pending } = session
  const changes = edit ? countEdits(edit) : 0

  useLeaveConfirm(edit !== null && hasUnwrittenChanges(edit))

  // 開いた時は、最初の押せる部品（診断の見出し）ではなく、「閉じる」に焦点を置く
  const showInfo = () => {
    info.current?.showModal()
    info.current?.querySelector<HTMLButtonElement>('.dialog-actions button')?.focus()
  }

  // 読み出した内容を、編集中の状態に渡す。失敗した時と、途中で別の読み出しが始まった時は渡さない
  const load = async (target: KeyboardDevice) => {
    const loaded = await read(target)
    if (loaded) dispatch({ type: 'read', snapshot: loaded.snapshot })
  }

  // 接続したら、利用者が押さなくても、続けて読み出す
  const connect = async () => {
    // 前の機器についての選択待ちが残っていれば、捨てる
    dispatch({ type: 'resolve', choice: 'cancel' })
    const connected = await open()
    if (connected) await load(connected)
  }

  const choose = (choice: ReloadChoice) => {
    dispatch({ type: 'resolve', choice })
    if (choice === 'cancel') void close()
  }

  return (
    <EditSessionContext value={store}>
      <div className="app">
        {!supported && <UnsupportedBrowserWarning />}
        {edit && (
          <SessionBanner
            connection={connection}
            reading={reading}
            supported={supported}
            changes={changes}
            onConnect={connect}
            onRetry={() => device && load(device)}
          />
        )}
        <AppHeader
          connection={connection}
          supported={supported}
          slots={edit && slotCounts(edit.source)}
          changes={changes}
          onConnect={connect}
          onDisconnect={close}
          onDeviceInfo={report ? showInfo : null}
        />
        {debug && <DebugEditPanel tools={debug} />}
        {edit && (
          <nav className="app-tabs" aria-label="画面の切り替え">
            {TABS.map(({ id, name }) => (
              <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {name}
              </button>
            ))}
          </nav>
        )}
        <main>
          {edit ? (
            tab === 'keymap' ? (
              <KeymapView snapshot={edit.source} />
            ) : (
              <p className="placeholder">コンボの設定は準備中です。</p>
            )
          ) : !device || !reading ? (
            <ConnectStage
              supported={supported}
              connecting={connection.status === 'connecting'}
              notice={connection.status === 'disconnected' ? connection.notice : undefined}
              onConnect={connect}
            />
          ) : reading.status === 'failed' ? (
            <ReadFailedStage failure={reading.failure} onRetry={() => load(device)} />
          ) : (
            // 読み終えた内容が編集中の状態に入るまでの一瞬も、読み込み中として見せる
            <ReadingStage progress={reading.status === 'reading' ? reading.progress : null} />
          )}
        </main>
        {device && report && (
          <DeviceInfoDialog
            ref={info}
            device={device}
            report={report}
            onReport={(next) => {
              replace(device, next)
              dispatch({ type: 'read', snapshot: next.snapshot })
            }}
          />
        )}
        {device && edit && pending && <ReloadDialog pending={pending} changes={changes} onChoose={choose} />}
      </div>
    </EditSessionContext>
  )
}

export default App
