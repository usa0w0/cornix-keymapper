import { useEffect, useRef } from 'react'
import { extrasText, NOT_INCLUDED, NOT_INCLUDED_ITEMS, vilFailureText, vilFileName, type LoadSummary, type VilScene } from './vilFlow.ts'

interface Props {
  scene: VilScene
  /** 変更の件数（変更点の一覧の行数） */
  changes: number
  /** 読み込んだ後の、変更点の一覧のまとめ。scene が loaded の時に使う */
  summary: LoadSummary
  /** 保存できない理由。保存できる時は null。scene が save の時に使う */
  saveBlocked: string | null
  /** ファイルに保存する（ブラウザーのダウンロード） */
  onSave: (name: string) => void
  /** 変更点の確認を開く */
  onReview: () => void
  onClose: () => void
}

/**
 * .vil の保存と読み込みのダイアログ。
 * 保存の前の確認（マクロなどが含まれない旨）、読み込んだ後の知らせ（本体にはまだ書き込んでいない旨、変更点の数、
 * 書き込まれない項目の数）、読み込めなかった理由の3つの場面を持つ
 */
export function VilDialog({ scene, changes, summary, saveBlocked, onSave, onReview, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    element?.querySelector<HTMLButtonElement>('.dialog-actions button.primary')?.focus()
    return () => element?.close()
  }, [])
  const close = (
    <button type="button" className="primary" onClick={onClose}>
      閉じる
    </button>
  )

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="vil-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      {scene.scene === 'save' && <Save at={scene.at} changes={changes} blocked={saveBlocked} onSave={onSave} onClose={onClose} />}
      {scene.scene === 'loaded' && (
        <>
          <h2 id="vil-title">{scene.name} を読み込みました</h2>
          <Loaded scene={scene} changes={changes} summary={summary} />
          <div className="dialog-actions">
            {changes > 0 && (
              <button type="button" onClick={onReview}>
                変更点を確かめる
              </button>
            )}
            {close}
          </div>
        </>
      )}
      {scene.scene === 'failed' && (
        <>
          <h2 id="vil-title" className="ng">
            この .vil は読み込めません
          </h2>
          <p>
            {scene.name}: {vilFailureText(scene.failure).cause}
          </p>
          <p className="write-note">{vilFailureText(scene.failure).advice}画面の内容は変えていません。</p>
          <div className="dialog-actions">{close}</div>
        </>
      )}
    </dialog>
  )
}

function Save({
  at,
  changes,
  blocked,
  onSave,
  onClose,
}: {
  at: Date
  changes: number
  blocked: string | null
  onSave: (name: string) => void
  onClose: () => void
}) {
  const name = vilFileName(at)
  return (
    <>
      <h2 id="vil-title">.vil ファイルに保存</h2>
      <p>
        この画面の内容{changes > 0 && `（まだ本体に書き込んでいない変更 ${changes} 件を含む）`}
        を、Vial と同じ形式のファイルに保存します。
      </p>
      <p>ファイル名: {name}</p>
      {blocked && (
        <p className="ng" role="alert">
          {blocked}
        </p>
      )}
      <p className="write-note">
        {NOT_INCLUDED}（{NOT_INCLUDED_ITEMS}）。このファイルを Vial で本体に書き戻すと、それらは空になることがあります。
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="primary" disabled={blocked !== null} onClick={() => onSave(name)}>
          保存する
        </button>
      </div>
    </>
  )
}

function Loaded({ scene, changes, summary }: { scene: Extract<VilScene, { scene: 'loaded' }>; changes: number; summary: LoadSummary }) {
  const { places, hidden, edits } = summary
  const dropped = scene.editsBefore - edits
  const extras = extrasText(scene.extras)
  return (
    <>
      {places === null ? (
        <p>ファイルの内容は、いまの本体と同じでした。このファイルから書き込むものは、ありません。</p>
      ) : (
        <>
          <p>ファイルの内容を、この画面に入れました。本体には、まだ書き込んでいません。</p>
          <p>
            {places > 0
              ? `いまの本体と違う所は ${places} か所です`
              : 'キーの動作は、いまの本体と同じです。本体の中での持ち方だけが違います'}
            {places > 0 && hidden && '（ほかに、動作は同じで、本体の中での持ち方だけが違う所があります）'}
            。変更点の一覧では、「読み込んだ設定」として、まとめて 1 件になります。
          </p>
          <p>
            右上の「書き込み（変更 {changes}{' '}
            件）」で、変更点を確かめてから書き込んでください。読み込みをやめる時は、変更点の一覧で「読み込みを取り消す」を選びます。
          </p>
        </>
      )}
      {scene.editsBefore > 0 && (
        <p>
          読み込む前に編集していた内容（{scene.editsBefore} 件）は、
          {dropped <= 0
            ? '読み込んだ設定の上に、そのまま残しています。'
            : edits > 0
              ? `読み込んだ設定の上に残しています。そのうち ${dropped} 件は、読み込んだ設定と同じ内容だったので、編集ではなくなりました。`
              : '読み込んだ設定と同じ内容だったので、編集ではなくなりました。'}
        </p>
      )}
      {extras && <p className="write-note">{extras}</p>}
    </>
  )
}
