import { useEffect, useRef } from 'react'
import type { InterruptedWrite } from '../session/writeSession.ts'
import { formatDateTime, unreadableText } from './writeFlow.ts'

interface Props {
  /** 残っていた「書き込み中」の印 */
  interrupted: Exclude<InterruptedWrite, { status: 'none' }>
  /** 書き込み前の状態に戻す。印が読み込めない時は、選べない */
  onRestore: () => void
  /** いまの本体の状態のまま続ける（印を消す） */
  onContinue: () => void
}

/**
 * 前回の書き込みが終わっていない時のダイアログ。書き込みの途中でページを閉じた後などに、同じ機器を接続すると出る。
 * 書き込み前の状態に戻すか、いまの本体の状態のまま続けるかを選ぶまで、閉じられない
 */
export function InterruptedDialog({ interrupted, onRestore, onContinue }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    element?.querySelector<HTMLButtonElement>('.dialog-actions button.primary')?.focus()
    return () => element?.close()
  }, [])
  const started = interrupted.startedAt ? `${formatDateTime(interrupted.startedAt)} に始めた書き込み` : '前に始めた書き込み'

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="interrupted-title" onCancel={(event) => event.preventDefault()}>
      <h2 id="interrupted-title" className="ng">
        前回の書き込みが終わっていません
      </h2>
      <p>
        {started}
        が、途中で止まっています（ページを閉じた、接続が切れた、など）。本体は、書きかけの状態かもしれません。
      </p>
      {interrupted.status === 'pending' ? (
        <>
          <p>
            書き込みを始める前の設定は、このブラウザーに残っています。「書き込み前の状態に戻す」を選ぶと、本体をその設定に戻し、読み直して確かめます。
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onContinue}>
              いまの本体の状態のまま続ける
            </button>
            <button type="button" className="primary" onClick={onRestore}>
              書き込み前の状態に戻す
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            ただし、その記録を読み込めないので（{unreadableText(interrupted.reason)}
            ）、ここからは、書き込み前の状態に戻せません。書き込みを始める前の設定がヘッダーの「バックアップ」に残っていれば、そこから戻せます。
          </p>
          <div className="dialog-actions">
            <button type="button" className="primary" onClick={onContinue}>
              いまの本体の状態のまま続ける
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
