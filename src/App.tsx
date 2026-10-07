import { isWebHidSupported } from './browserSupport.ts'

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
        <h1>Cornix キーマッパー</h1>
        <p>準備中です。</p>
      </main>
    </>
  )
}

export default App
