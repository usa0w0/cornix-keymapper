import type { DeviceConnector } from './device/types.ts'
import { ConnectionPanel } from './ui/ConnectionPanel.tsx'
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
      </main>
    </>
  )
}

export default App
