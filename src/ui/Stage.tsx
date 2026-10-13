import type { ReadProgress } from '../device/types.ts'
import type { ReadFailure } from './readReport.ts'

interface ConnectProps {
  /** このブラウザーで接続できるか（WebHID があるか） */
  supported: boolean
  connecting: boolean
  /** 接続できなかった、接続が切れた、などの知らせ */
  notice?: string
  onConnect: () => void
}

/** 接続前に、図の代わりに出すカード。つなぎ方の手順と「接続」 */
export function ConnectStage({ supported, connecting, notice, onConnect }: ConnectProps) {
  return (
    <section className="stage" aria-label="接続">
      <h2>Cornix をつないで、設定を読み込みます</h2>
      {notice && (
        <p className="stage-alert" role="alert">
          {notice}
        </p>
      )}
      <ol>
        <li>Cornix の電源を入れ、Bluetooth か USB でこのパソコンにつなぐ</li>
        <li>Vial など、キーボードの設定を開いているアプリやタブを閉じる</li>
        <li>「接続」を押し、出てきた一覧から Cornix を選ぶ</li>
      </ol>
      <button type="button" className="primary big" onClick={onConnect} disabled={connecting || !supported}>
        {connecting ? '接続中…' : '接続'}
      </button>
      {!supported && <p className="stage-note">このブラウザーでは接続できません。Chrome か Edge で開いてください。</p>}
    </section>
  )
}

/** 読み込み中のカード。進み具合の棒と、いま読んでいるもの */
export function ReadingStage({ progress }: { progress: ReadProgress | null }) {
  // 機器が知らせるのは、いま読んでいるものの中での進み具合。数えられないものを読んでいる間は、棒を動かし続ける
  const counted = progress !== null && progress.total > 1
  return (
    <section className="stage" aria-label="読み込み中">
      <h2>本体の設定を読み出しています…</h2>
      {counted ? <progress value={progress.done} max={progress.total} /> : <progress />}
      <p className="stage-note" aria-live="polite">
        {progress && `「${progress.step}」を読んでいます${counted ? `（${progress.done} / ${progress.total}）` : ''}。`}
        Bluetooth では 5 秒ほどかかります。
      </p>
    </section>
  )
}

/** 読み出しの失敗のカード。どこで・なぜ失敗したかと「もう一度読み出す」。読みかけの内容は出さない */
export function ReadFailedStage({ failure, onRetry }: { failure: ReadFailure; onRetry: () => void }) {
  return (
    <section className="stage" aria-label="読み出しの失敗">
      <h2 className="ng" role="alert">
        設定を読み出せませんでした
      </h2>
      <p>{failure.cause}</p>
      <p className="stage-note">{failure.advice}読みかけの内容は表示しません。</p>
      <button type="button" className="primary big" onClick={onRetry}>
        もう一度読み出す
      </button>
    </section>
  )
}
