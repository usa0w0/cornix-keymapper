import { useEffect, useRef } from 'react'
import type { PendingReload, ReloadChoice } from '../session/editState.ts'

interface Props {
  pending: PendingReload
  /** 編集の数 */
  changes: number
  onChoose: (choice: ReloadChoice) => void
}

/**
 * つなぎ直した後（または診断）で読み直した内容が、前に読み込んだ内容と違っていた時のダイアログ。
 * 同じ機器なら、読み直した内容に編集を当て直すか、編集を捨てるかを選ばせる。
 * 別の機器なら、編集を捨てる前に確認する。「やめる」は、接続を切って、編集した内容を画面に残す
 */
export function ReloadDialog({ pending, changes, onChoose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  // 出ている間は、ほかの操作を止める。最初の押せる部品（「やめる」）に焦点が置かれる
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const otherDevice = pending.reason === 'other-device'

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="reload-title"
      onCancel={(event) => {
        // Esc は「やめる」と同じ
        event.preventDefault()
        onChoose('cancel')
      }}
    >
      <h2 id="reload-title" className="ng">
        {otherDevice ? '前とは別のキーボードです' : '本体の設定が変わっています'}
      </h2>
      {otherDevice ? (
        <>
          <p>
            いまつないだキーボードは、この画面に読み込んであるものとは別のキーボードです。編集した内容（{changes}{' '}
            件）は、前のキーボードのものなので、このキーボードには使えません。
          </p>
          <p>
            このキーボードの設定を読み込むと、編集した内容は消えます。「やめる」を選ぶと、接続を切り、編集した内容を画面に残します。
          </p>
        </>
      ) : (
        <>
          <p>
            本体を読み直したところ、この画面に読み込んだ時と内容が違っていました。Vial
            など、ほかのアプリで設定を変えた時に起きます。
          </p>
          <p>
            編集した内容（{changes}{' '}
            件）を、読み直した内容の上に当て直して続けるか、編集を捨てて読み直した内容にするかを選んでください。「やめる」を選ぶと、接続を切り、編集した内容を画面に残します。
          </p>
        </>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={() => onChoose('cancel')}>
          やめる
        </button>
        <button type="button" className={otherDevice ? 'primary' : ''} onClick={() => onChoose('discard')}>
          {otherDevice ? '編集を捨てて、このキーボードを読み込む' : '編集を捨てる'}
        </button>
        {!otherDevice && (
          <button type="button" className="primary" onClick={() => onChoose('reapply')}>
            編集を当て直して続ける
          </button>
        )}
      </div>
    </dialog>
  )
}
