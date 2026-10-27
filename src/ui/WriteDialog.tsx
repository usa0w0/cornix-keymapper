import { useEffect, useRef } from 'react'
import {
  describeFailure,
  describeNotStarted,
  describeStage,
  isClosable,
  type WriteFlow,
} from './writeFlow.ts'

interface Props {
  /** いまの場面。idle の時は、このダイアログを出さない */
  flow: Exclude<WriteFlow, { phase: 'idle' }>
  /** キーボードとつながっているか。つながっていない間は、再試行と、戻すを押せない */
  connected: boolean
  /** 編集の数。戻した後に、編集が画面に残っているかを伝えるのに使う */
  changes: number
  onRetry: () => void
  onRestore: () => void
  /** 本体の設定が変わっていた時の「このまま上書きする」 */
  onOverwrite: () => void
  /** 本体の設定が変わっていた時の「本体から読み込み直す」 */
  onReload: () => void
  /** 失敗の後、キーボードをつなぎ直す（機器選択を開く） */
  onConnect: () => void
  /** 失敗した時の、通信の記録を保存する */
  onSaveLog: () => void
  onClose: () => void
}

/**
 * 書き込みの流れのダイアログ（docs/design.md「画面 > 書き込みの流れ」の 2〜4 と、
 * 書き込み前に本体の設定が変わっていた時、書き込みを始められなかった時）。
 * 書き込み中は閉じられない。失敗の後は、「再試行」か「書き込み前の状態に戻す」を選ぶまで閉じられない
 */
export function WriteDialog({ flow, connected, changes, onRetry, onRestore, onOverwrite, onReload, onConnect, onSaveLog, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  // 場面が替わったら、主なボタンに焦点を置く。押せるものがない間（書き込み中）は、ダイアログそのものに置く
  const { phase } = flow
  useEffect(() => {
    const element = dialog.current
    const button = element?.querySelector<HTMLButtonElement>('.dialog-actions button.primary:not(:disabled)')
    ;(button ?? element)?.focus()
  }, [phase])

  return (
    <dialog
      ref={dialog}
      className="dialog write-dialog"
      aria-labelledby="write-title"
      tabIndex={-1}
      onCancel={(event) => {
        // 書き込み中と、失敗の後は、Esc で閉じさせない
        event.preventDefault()
        if (isClosable(flow)) onClose()
      }}
    >
      <Body
        flow={flow}
        connected={connected}
        changes={changes}
        onRetry={onRetry}
        onRestore={onRestore}
        onOverwrite={onOverwrite}
        onReload={onReload}
        onConnect={onConnect}
        onSaveLog={onSaveLog}
        onClose={onClose}
      />
    </dialog>
  )
}

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <div className="dialog-actions">
    <button type="button" className="primary" onClick={onClose}>
      閉じる
    </button>
  </div>
)

// 印を消せなかった時の知らせ。書き込み（戻すこと）自体は、照合まで通っている
const MarkNote = () => (
  <p className="write-note">
    ブラウザーに残した「書き込みの途中」の印を、消せませんでした。次に接続した時に「前回の書き込みが終わっていません」と出たら、「いまの本体の状態のまま続ける」を選んでください。
  </p>
)

/** ダイアログの中身。場面ごとに、見出し、説明、ボタンを出す */
export function Body({ flow, connected, changes, onRetry, onRestore, onOverwrite, onReload, onConnect, onSaveLog, onClose }: Props) {
  switch (flow.phase) {
    case 'working': {
      const { text, bar } = describeStage(flow.action, flow.stage)
      return (
        <>
          <h2 id="write-title">{flow.action === 'restore' ? '書き込み前の状態に戻しています…' : '書き込み中…'}</h2>
          {bar ? <progress value={bar.done} max={bar.total} /> : <progress />}
          <p aria-live="polite">{text}</p>
          <p className="write-warning">
            終わるまで、キーボードの電源を切ったり、接続を外したりしないでください。このページも閉じないでください。
          </p>
        </>
      )
    }
    case 'done':
      return (
        <>
          <h2 id="write-title" className="ok">
            書き込みました
          </h2>
          <p>
            {flow.written > 0
              ? `${flow.written} 件を書き込み、本体から読み直して、内容が合っていることを確かめました。`
              : '本体は、すでに書き込む内容と同じでした（本体から読み直して確かめました）。'}
          </p>
          {flow.written > 0 && <p className="write-note">書き込む前の設定は、ヘッダーの「バックアップ」から戻せます。</p>}
          {!flow.markCleared && <MarkNote />}
          <CloseButton onClose={onClose} />
        </>
      )
    case 'restored':
      return (
        <>
          <h2 id="write-title" className="ok">
            書き込み前の状態に戻しました
          </h2>
          <p>
            本体は、書き込む前の設定に戻っています（本体から読み直して確かめました）。
            {changes > 0 && '画面の編集内容は残っているので、もう一度書き込めます。'}
          </p>
          {!flow.markCleared && <MarkNote />}
          <CloseButton onClose={onClose} />
        </>
      )
    case 'not-started': {
      const { title, body } = describeNotStarted(flow.reason)
      return (
        <>
          <h2 id="write-title" className="ng">
            {title}
          </h2>
          {body.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <CloseButton onClose={onClose} />
        </>
      )
    }
    case 'changed':
      return flow.reason === 'settings' ? (
        <>
          <h2 id="write-title" className="ng">
            本体の設定が、読み込んだ後に変わっています
          </h2>
          <p>
            書き込む前に本体を読み直したところ、この画面に読み込んだ時と内容が違っていました。Vial
            など、ほかのアプリで設定を変えた時に起きます。本体には、まだ何も書いていません。
          </p>
          <p>
            このまま書き込むと、ほかで変えた内容は、この画面の内容で上書きされます（上書きする前の本体の設定は、自動でバックアップします）。読み込み直すと、この画面で編集した内容（
            {changes} 件）は消えます。
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              やめる
            </button>
            <button type="button" onClick={onReload}>
              本体から読み込み直す
            </button>
            <button type="button" className="primary" onClick={onOverwrite}>
              このまま上書きする
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 id="write-title" className="ng">
            {flow.reason === 'other-device' ? '読み込んだ時とは、別のキーボードです' : 'キーボードの構成が、読み込んだ後に変わっています'}
          </h2>
          <p>
            {flow.reason === 'other-device'
              ? '書き込む前に本体を読み直したところ、この画面に読み込んだものとは別のキーボードでした。'
              : '書き込む前に本体を読み直したところ、レイヤーや枠の数が、この画面に読み込んだ時と違っていました。'}
            この画面の内容は、このキーボードには書き込めません。本体には、何も書いていません。
          </p>
          <p>読み込み直すと、この画面で編集した内容（{changes} 件）は消えます。</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              やめる
            </button>
            <button type="button" className="primary" onClick={onReload}>
              本体から読み込み直す
            </button>
          </div>
        </>
      )
    case 'failed': {
      const { title, cause, places, morePlaces, advice } = describeFailure(flow.action, flow.job, flow.failure)
      return (
        <>
          <h2 id="write-title" className="ng" role="alert">
            {title}
          </h2>
          <p>{cause}</p>
          {places.length > 0 && (
            <ul className="write-places">
              {places.map((place) => (
                <li key={place}>{place}</li>
              ))}
              {morePlaces > 0 && <li>ほか {morePlaces} か所</li>}
            </ul>
          )}
          <p>{advice}</p>
          {!connected && (
            <p className="write-warning" role="status">
              いまは、キーボードとつながっていません。つなぎ直してから「接続」を押すと、選べるようになります。
            </p>
          )}
          <p className="write-note">
            書き込む前の設定は、自動バックアップに残っています。どちらもうまくいかない時は、キーボードをつなぎ直してください。それでもだめなら、このページを再読み込みしてつなぎ直すと、書き込み前の状態に戻すかを、もう一度選べます（再読み込みすると、編集した内容は消えます）。
          </p>
          <div className="dialog-actions">
            <span className="write-extra">
              <button type="button" className="quiet" onClick={onSaveLog} title="うまくいかない原因を調べるための、通信の記録を保存する">
                通信の記録を保存
              </button>
              <button type="button" className={connected ? 'quiet' : 'primary'} onClick={onConnect}>
                {connected ? '接続し直す' : '接続'}
              </button>
            </span>
            <button type="button" disabled={!connected} onClick={onRestore}>
              書き込み前の状態に戻す
            </button>
            <button type="button" className="primary" disabled={!connected} onClick={onRetry}>
              再試行
            </button>
          </div>
        </>
      )
    }
  }
}
