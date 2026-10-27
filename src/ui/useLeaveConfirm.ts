import { useEffect } from 'react'

/**
 * active の間、ページを離れる（再読み込み、閉じる、ほかのページへ移る）前に、ブラウザーの確認を出す。
 * 編集中の内容はブラウザーに保存しないので、離れると消えるため。文言はブラウザーが決める
 */
export function useLeaveConfirm(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const confirm = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', confirm)
    return () => window.removeEventListener('beforeunload', confirm)
  }, [active])
}
