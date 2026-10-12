import { useEffect, useRef, useState } from 'react'
import type { KeyboardSnapshot } from '../device/types.ts'
import { sameShape, sameSnapshot } from '../model/snapshot.ts'
import { BACKUP_LIMIT, type BackupItem, type BackupStorage } from '../storage/backup.ts'
import { snapshotToVil } from '../storage/vil.ts'
import { downloadText } from './download.ts'
import { isDevSite } from './site.ts'
import { NOT_INCLUDED, vilFileName } from './vilFlow.ts'
import { formatDateTime, storageFailureText, unreadableText } from './writeFlow.ts'

interface Props {
  backups: BackupStorage
  /** 基準（本体から読んだもの）。その機器のバックアップを出す */
  baseline: KeyboardSnapshot
  /** 出発点（編集の土台）。すでに画面に入っているバックアップを見分けるのに使う */
  source: KeyboardSnapshot
  /** 編集の数 */
  changes: number
  /** バックアップの内容を、編集中の状態の出発点に入れる。すぐには書き込まない */
  onRestore: (snapshot: KeyboardSnapshot) => void
  onClose: () => void
  /** ファイルとして保存させる。省くと、ブラウザーのダウンロード（テスト用） */
  onDownload?: (name: string, text: string) => void
  /** 開発版の表示にするか。省くと、公開先のパスで決める（テスト用） */
  devSite?: boolean
}

/** そのバックアップを、画面に入れられない理由。入れられる時は null */
function blockedReason(item: Extract<BackupItem, { readable: true }>, baseline: KeyboardSnapshot, source: KeyboardSnapshot): string | null {
  if (!sameShape(item.snapshot, baseline)) return 'いまのキーボードとは、レイヤーや枠の数が違うので、戻せません'
  if (sameSnapshot(item.snapshot, source)) return source === baseline ? 'いまの本体と同じ内容です' : 'この画面に読み込んであります'
  return null
}

/**
 * 自動バックアップの一覧。ヘッダーの「バックアップ」から開く。
 * 「この状態に戻す」は、すぐには書き込まず、内容を編集中の状態の出発点に入れる（変更点を確かめてから書き込む）。
 * 読み込めないものは、その旨と「削除」を出す。「.vil に書き出す」は、そのバックアップを .vil のファイルとして保存させる
 */
export function BackupDialog({
  backups,
  baseline,
  source,
  changes,
  onRestore,
  onClose,
  onDownload = downloadText,
  devSite = isDevSite,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { uid } = baseline
  const [items, setItems] = useState(() => backups.list(uid))
  const [failure, setFailure] = useState<string | null>(null)
  // 書き出したファイルの名前
  const [exported, setExported] = useState<string | null>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    // 最初の押せる部品（行のボタン）ではなく、「閉じる」に焦点を置く
    element?.querySelector<HTMLButtonElement>('.dialog-actions button.primary')?.focus()
    return () => element?.close()
  }, [])

  const exportVil = (item: Extract<BackupItem, { readable: true }>) => {
    const text = snapshotToVil(item.snapshot)
    setExported(null)
    if (text === null) return setFailure('書き出せませんでした。バックアップの、機器の識別が読み取れません。')
    const name = vilFileName(new Date(item.savedAt), 'backup')
    onDownload(name, text)
    setFailure(null)
    setExported(name)
  }

  const remove = (id: string) => {
    setExported(null)
    const result = backups.remove(uid, id)
    setFailure(result.ok ? null : `削除できませんでした。${storageFailureText(result.reason)}`)
    setItems(backups.list(uid))
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="backups-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id="backups-title">自動バックアップ</h2>
      <p>書き込むたびに、その直前の本体の設定を、このブラウザーの中に保存しています（直近 {BACKUP_LIMIT} 回ぶん）。</p>
      {items.length === 0 ? (
        <p className="changes-empty">このキーボードのバックアップは、まだありません。本体に書き込むと、その直前の設定がここに残ります。</p>
      ) : (
        <div className="changes-scroll">
          <table className="changes backups">
            <thead>
              <tr>
                <th scope="col">保存した時</th>
                <th scope="col">内容</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const when = item.savedAt ? formatDateTime(item.savedAt) : '（日時不明）'
                if (!item.readable) {
                  return (
                    <tr key={item.id}>
                      <th scope="row">{when}</th>
                      <td className="ng">読み込めません（{unreadableText(item.reason)}）</td>
                      <td>
                        <button type="button" aria-label={`${when} の、読み込めないバックアップを削除`} onClick={() => remove(item.id)}>
                          削除
                        </button>
                      </td>
                    </tr>
                  )
                }
                const blocked = blockedReason(item, baseline, source)
                return (
                  <tr key={item.id}>
                    <th scope="row">{when}</th>
                    <td>
                      書き込みの直前の設定
                      {blocked && <span className="backups-note">（{blocked}）</span>}
                    </td>
                    <td>
                      <button type="button" aria-label={`${when} のバックアップを .vil に書き出す`} onClick={() => exportVil(item)}>
                        .vil に書き出す
                      </button>{' '}
                      <button
                        type="button"
                        disabled={blocked !== null}
                        aria-label={`${when} の状態に戻す`}
                        onClick={() => onRestore(item.snapshot)}
                      >
                        この状態に戻す
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {failure && (
        <p className="ng" role="alert">
          {failure}
        </p>
      )}
      {exported && (
        <p className="ok" role="status">
          {exported} に書き出しました。{NOT_INCLUDED}。
        </p>
      )}
      <p className="write-note">
        「この状態に戻す」は、すぐには書き込みません。変更点を確かめてから「本体に書き込む」を押します。
        {changes > 0 && `いま編集している内容（${changes} 件）は、戻した設定の上に残ります。`}
        <br />
        バックアップは、開発版とリリース版で別々に保存されます（いま見ているのは{devSite ? '開発版' : 'リリース版'}
        ）。ブラウザーで、このサイトのデータを消すと、バックアップも消えます。残しておきたいものは、.vil
        に書き出してください。
      </p>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  )
}
