import { useEffect, useRef, useState } from 'react'
import type { Change } from '../model/diff.ts'
import { tryRevertEdit, type EditState, type SessionAction } from '../session/editState.ts'

interface Props {
  /** 編集中の状態。取り消すと枠が足りなくなる変更を、状態に反映する前に止めるのに使う */
  state: EditState
  /** 変更点の一覧（model/diff.ts の listChanges）。1行が、取り消しの単位 */
  changes: readonly Change[]
  /** 取り消しを、編集中の状態に送る */
  onAction: (action: SessionAction) => void
  onClose: () => void
  /** 「本体に書き込む」を押した時。押せない間は、その理由（画面に出す） */
  write: { onWrite: () => void } | { blocked: string }
  /** 使用中の Tap Dance の枠の中身を、書き換えるしかない書き込みか（model/diff.ts の rewritesUsedTapDance） */
  rewritesUsed?: boolean
  /** 最初から、「すべて取り消す」の確認を出しておく（テスト用） */
  initialConfirmAll?: boolean
  /** 最初から、取り消せなかった行として示しておく変更（テスト用） */
  initialRefused?: string
}

/** 「取り消す」の読み上げ用の名前。どの行のボタンかが分かるようにする */
const revertLabel = (change: Change) =>
  change.undo.kind === 'source' ? '読み込みを取り消す' : `${change.title ?? change.lines[0]?.where ?? ''} の変更を取り消す`

/**
 * 変更点の確認のダイアログ。ヘッダーの「書き込み（変更 n 件）」から開く。
 * 「場所 / いま → 書き込む内容」の表を出し、行ごとの「取り消す」と、「すべて取り消す」を置く。
 * 「本体に書き込む」を押すと、書き込みの流れ（WriteDialog）に進む。書き込めない間は、押せなくして、理由を出す
 */
export function ChangeListDialog({
  state,
  changes,
  onAction,
  onClose,
  write,
  rewritesUsed = false,
  initialConfirmAll = false,
  initialRefused,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  // 「すべて取り消す」は、押し間違えると編集がすべて消えるので、もう一度確かめる
  const [confirmAll, setConfirmAll] = useState(initialConfirmAll)
  // 取り消すと Tap Dance の枠が足りなくなるので、取り消せなかった変更
  const [refused, setRefused] = useState<string | null>(initialRefused ?? null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    // 最初の押せる部品（行の「取り消す」）ではなく、「閉じる」に焦点を置く
    element?.querySelector<HTMLButtonElement>('.dialog-actions .changes-close')?.focus()
    return () => element?.close()
  }, [])

  const revert = (change: Change) => {
    setConfirmAll(false)
    if (change.undo.kind === 'source') {
      setRefused(null)
      return onAction({ type: 'revertSource' })
    }
    // 空いた枠をほかのキーが使った後で、枠を空けた変更を取り消すと、枠が足りなくなる。これは止める
    if (tryRevertEdit(state, change.undo.place).blocked) return setRefused(change.id)
    setRefused(null)
    onAction({ type: 'revert', place: change.undo.place })
  }
  const revertAll = () => {
    setConfirmAll(false)
    setRefused(null)
    onAction({ type: 'revertAll' })
  }
  const revertButton = (change: Change) => (
    <button type="button" aria-label={revertLabel(change)} onClick={() => revert(change)}>
      {change.undo.kind === 'source' ? '読み込みを取り消す' : '取り消す'}
    </button>
  )

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="changes-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id="changes-title">変更点の確認（{changes.length} 件）</h2>
      {changes.length === 0 ? (
        <p className="changes-empty">変更はありません。</p>
      ) : (
        <div className="changes-scroll">
          <table className="changes">
            <thead>
              <tr>
                <th scope="col">場所</th>
                <th scope="col">いま</th>
                <th />
                <th scope="col">書き込む内容</th>
                <th />
              </tr>
            </thead>
            {/* 1つの tbody が、取り消しの単位1つ。連動して変えたキーの組と、読み込んだ設定は、見出しの下に場所を並べる */}
            {changes.map((change) => (
              <tbody key={change.id} className={change.title ? 'changes-group' : undefined}>
                {change.title && (
                  <tr className="changes-title">
                    <th scope="rowgroup" colSpan={4}>
                      {change.title}
                    </th>
                    <td>{revertButton(change)}</td>
                  </tr>
                )}
                {change.lines.map((line, index) => (
                  <tr key={index}>
                    <th scope="row">{line.where}</th>
                    <td>{line.before}</td>
                    <td className="changes-arrow">→</td>
                    <td>{line.after}</td>
                    <td>{!change.title && index === 0 && revertButton(change)}</td>
                  </tr>
                ))}
                {change.notes.length > 0 && (
                  <tr className="changes-notes">
                    <td colSpan={5}>
                      {change.notes.map((note) => (
                        <span key={note}>{note}</span>
                      ))}
                    </td>
                  </tr>
                )}
                {refused === change.id && (
                  <tr className="changes-refused">
                    <td colSpan={5} role="alert">
                      この変更を取り消すと、Tap Dance の枠が足りなくなるので、取り消せません。枠を使っているほかの変更を、先に取り消してください。
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {changes.length > 0 && <p className="write-note">書き込む前に、いまの本体の設定を自動でバックアップします。</p>}
      {rewritesUsed && (
        <p className="write-caution">
          この書き込みでは、いま使っている Tap Dance
          の枠の中身を書き換えます（空いている枠がないため）。書き込みの途中で失敗すると、その枠を使うキーが、変える前とも後とも違う動作になることがあります。その時は、「再試行」か「書き込み前の状態に戻す」で直せます。
        </p>
      )}
      {'blocked' in write && changes.length > 0 && (
        <p className="write-blocked" role="status">
          {write.blocked}
        </p>
      )}
      <div className="dialog-actions">
        {confirmAll ? (
          <span className="changes-all" role="alert">
            {changes.length} 件の変更をすべて取り消して、本体から読み込んだ内容に戻します。元には戻せません。
            <button type="button" onClick={revertAll}>
              すべて取り消す
            </button>
            <button type="button" onClick={() => setConfirmAll(false)}>
              やめる
            </button>
          </span>
        ) : (
          <span className="changes-all">
            <button type="button" disabled={changes.length === 0} onClick={() => setConfirmAll(true)}>
              すべて取り消す…
            </button>
          </span>
        )}
        <button type="button" className="changes-close" onClick={onClose}>
          閉じる
        </button>
        <button
          type="button"
          className="primary"
          disabled={'blocked' in write}
          title={'blocked' in write ? write.blocked : undefined}
          onClick={'onWrite' in write ? write.onWrite : undefined}
        >
          本体に書き込む
        </button>
      </div>
    </dialog>
  )
}
