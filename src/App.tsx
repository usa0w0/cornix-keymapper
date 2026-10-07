import { isWebHidSupported } from './browserSupport.ts'

// develop のビルドは /cornix-keymapper/dev/ で配信される（.github/workflows/deploy.yml）
const isDevSite = import.meta.env.BASE_URL.endsWith('/dev/')

function App() {
  return (
    <>
      {!isWebHidSupported() && (
        <p className="warning" role="alert">
          このブラウザーではキーボードに接続できません。デスクトップ版の Chrome または Edge
          で開いてください。
        </p>
      )}
      <main>
        <h1>Cornix キーマッパー{isDevSite && <span className="badge">開発版</span>}</h1>
        <p>準備中です。</p>
      </main>
    </>
  )
}

export default App
