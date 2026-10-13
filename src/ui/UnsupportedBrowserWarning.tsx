/** 非対応ブラウザーで開いた時に、画面のいちばん上に出し続ける警告 */
export function UnsupportedBrowserWarning() {
  return (
    <p className="banner banner-danger" role="alert">
      このブラウザーでは、キーボードに接続できません。デスクトップ版の Chrome か Edge で開いてください。
    </p>
  )
}
