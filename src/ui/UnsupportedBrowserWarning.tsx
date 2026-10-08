import { isWebHidSupported } from '../browserSupport.ts'

/** 非対応ブラウザーで開いた時に、画面上部に出し続ける警告 */
export function UnsupportedBrowserWarning() {
  if (isWebHidSupported()) return null
  return (
    <p className="warning" role="alert">
      このブラウザーではキーボードに接続できません。デスクトップ版の Chrome または Edge
      で開いてください。
    </p>
  )
}
