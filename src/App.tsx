import type { DeviceConnector } from './device/types.ts'
import { ConnectionPanel } from './ui/ConnectionPanel.tsx'
import { ReadPanel } from './ui/ReadPanel.tsx'
import { UnsupportedBrowserWarning } from './ui/UnsupportedBrowserWarning.tsx'
import { useConnection } from './ui/useConnection.ts'

// develop のビルドは /cornix-keymapper/dev/ で配信される（.github/workflows/deploy.yml）
const isDevSite = import.meta.env.BASE_URL.endsWith('/dev/')

function App({ connector }: { connector: DeviceConnector }) {
  const { state, open, close } = useConnection(connector)

  return (
    <>
      <UnsupportedBrowserWarning />
      <main>
        <h1>Cornix キーマッパー{isDevSite && <span className="badge">開発版</span>}</h1>
        <ConnectionPanel state={state} onConnect={open} onDisconnect={close} />
        {/* 機器が替わったら、前の読み出しの結果を捨てる */}
        {state.status === 'connected' && <ReadPanel key={state.device.name} device={state.device} />}
      </main>
    </>
  )
}

export default App
