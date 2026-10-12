// 画面デザインの試作（#22）。ふだんの操作では出にくい場面（接続前、失敗、確認など）を、見本として表示する
import { useEffect, useRef, type ReactNode } from 'react'
import { SCENES, type SceneId } from './sceneList.ts'

/** 試作用の、場面を選ぶ帯。本実装には入らない */
export function SceneBar({ scene, onScene }: { scene: SceneId; onScene: (scene: SceneId) => void }) {
  return (
    <label className="scene-bar">
      試作用: 場面を選ぶ
      <select value={scene} onChange={(event) => onScene(event.target.value as SceneId)}>
        {SCENES.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <span>（この帯は試作だけのもので、実際の画面には出ません）</span>
    </label>
  )
}

/** 画面のいちばん上に、常に出す知らせ */
export function SceneBanner({ scene, changes }: { scene: SceneId; changes: number }) {
  if (scene === 'unsupported') {
    return (
      <p className="banner banner-danger" role="alert">
        このブラウザーでは、キーボードに接続できません。デスクトップ版の Chrome か Edge で開いてください。
      </p>
    )
  }
  if (scene === 'lost') {
    return (
      <p className="banner banner-warning" role="alert">
        キーボードとの接続が切れました。
        {changes > 0 ? `編集した内容（${changes} 件）は画面に残っています。` : ''}
        つなぎ直してから「接続」を押してください。
        <button type="button" className="primary">
          接続
        </button>
      </p>
    )
  }
  return null
}

/** 接続していない時に、図の代わりに出す画面。出さない場面では null */
export function SceneBody({ scene }: { scene: SceneId }) {
  if (scene === 'disconnected' || scene === 'unsupported') {
    const unsupported = scene === 'unsupported'
    return (
      <section className="stage">
        <h2>Cornix をつないで、設定を読み込みます</h2>
        <ol>
          <li>Cornix の電源を入れ、Bluetooth か USB でこのパソコンにつなぐ</li>
          <li>Vial など、キーボードの設定を開いているアプリやタブを閉じる</li>
          <li>「接続」を押し、出てきた一覧から Cornix を選ぶ</li>
        </ol>
        <button type="button" className="primary big" disabled={unsupported}>
          接続
        </button>
        {unsupported && <p className="stage-note">このブラウザーでは接続できません。Chrome か Edge で開いてください。</p>}
      </section>
    )
  }
  if (scene === 'reading') {
    return (
      <section className="stage">
        <h2>本体の設定を読み出しています…</h2>
        <progress value={3} max={7} />
        <p className="stage-note">キーマップを読んでいます（7 段階中 3 段階め）。Bluetooth では 5 秒ほどかかります。</p>
      </section>
    )
  }
  if (scene === 'read-failed') {
    return (
      <section className="stage">
        <h2 className="ng">設定を読み出せませんでした</h2>
        <p>「キーマップ」を読んでいる途中で、キーボードから応答がなくなりました。</p>
        <p className="stage-note">電源と接続を確かめてから、もう一度読み出してください。読みかけの内容は表示しません。</p>
        <button type="button" className="primary big">
          もう一度読み出す
        </button>
      </section>
    )
  }
  return null
}

interface DialogContent {
  title: string
  tone?: 'ng'
  body: ReactNode
  actions: { label: string; primary?: boolean }[]
}

const DIALOGS: Partial<Record<SceneId, DialogContent>> = {
  'no-slots': {
    title: 'この変更は、枠が足りないのでできません',
    tone: 'ng',
    body: (
      <>
        <p>
          長押しや2回タップを組み合わせたキーは、本体の「Tap Dance の枠」を1つ使います。枠は 32 個あり、いまはすべて使われています。
        </p>
        <p>どれかのキーの動作を減らすと、枠が空きます。枠を使っているキー:</p>
        <ul className="plain-list">
          <li>
            <button type="button">レイヤー 0 ・ 行 3 列 5</button> タップ: Space ／ 長押し: 左 GUI（ほかに 3 つのキーが同じ枠を共有）
          </li>
          <li>
            <button type="button">レイヤー 0 ・ 行 7 列 5</button> タップ: B ／ 長押し: 右 GUI
          </li>
          <li>（以下、残りの 30 件が続く）</li>
        </ul>
      </>
    ),
    actions: [{ label: '閉じる', primary: true }],
  },
  shared: {
    title: 'このキーと同じ内容のキーが、ほかに 3 つあります',
    body: (
      <>
        <p>「タップ: Space ／ 長押し: 左 GUI」のキーは、次の 4 か所にあり、本体の中で1つの枠を共有しています。</p>
        <ul className="plain-list">
          <li>レイヤー 0 ・ 行 3 列 5（いま変えようとしているキー）</li>
          <li>レイヤー 1 ・ 行 3 列 5</li>
          <li>レイヤー 1 ・ 行 7 列 5</li>
          <li>レイヤー 2 ・ 行 3 列 5</li>
        </ul>
        <p>ほかの 3 つも同じように変えますか？「このキーだけ変更」を選ぶと、枠を1つ新しく使います（残り 30）。</p>
      </>
    ),
    actions: [{ label: 'やめる' }, { label: 'このキーだけ変更' }, { label: '4 つとも変更', primary: true }],
  },
  'device-changed': {
    title: '本体の設定が、読み込んだ後に変わっています',
    tone: 'ng',
    body: (
      <>
        <p>
          書き込む前に本体を読み直したところ、この画面に読み込んだ時と内容が違っていました。Vial など、ほかのアプリで設定を変えた時に起きます。
        </p>
        <p>
          このまま書き込むと、ほかで変えた内容は、この画面の内容で上書きされます。読み込み直すと、この画面で編集した内容（3
          件）は消えます。
        </p>
      </>
    ),
    actions: [{ label: 'やめる' }, { label: '本体から読み込み直す' }, { label: 'このまま上書きする', primary: true }],
  },
  unfinished: {
    title: '前回の書き込みが終わっていません',
    tone: 'ng',
    body: (
      <>
        <p>
          2026-10-12 10:32 に始めた書き込みが、途中で止まっています（ページを閉じた、接続が切れた、など）。本体は、書きかけの状態かもしれません。
        </p>
        <p>書き込みを始める前の設定は、自動バックアップに残っています。</p>
      </>
    ),
    actions: [{ label: 'いまの本体の状態のまま続ける' }, { label: '書き込み前の状態に戻す', primary: true }],
  },
  backups: {
    title: '自動バックアップ',
    body: (
      <>
        <p>書き込むたびに、その直前の本体の設定を、このブラウザーの中に保存しています（直近 5 回ぶん）。</p>
        <table className="changes">
          <thead>
            <tr>
              <th>保存した時</th>
              <th>内容</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>2026-10-12 10:32</th>
              <td>書き込みの直前の設定</td>
              <td>
                <button type="button">.vil に書き出す</button> <button type="button">この状態に戻す</button>
              </td>
            </tr>
            <tr>
              <th>2026-10-11 23:48</th>
              <td>書き込みの直前の設定</td>
              <td>
                <button type="button">.vil に書き出す</button> <button type="button">この状態に戻す</button>
              </td>
            </tr>
            <tr>
              <th>2026-10-10 21:05</th>
              <td className="ng">読み込めません（データが壊れています）</td>
              <td>
                <button type="button">削除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="write-note">
          「この状態に戻す」は、すぐには書き込みません。変更点を確かめてから「書き込み」を押します。
          <br />
          バックアップは、開発版とリリース版で別々に保存されます（いま見ているのは開発版）。ブラウザーのサイトのデータを消すと、バックアップも消えます。残しておきたいものは、.vil
          に書き出してください。
        </p>
      </>
    ),
    actions: [{ label: '閉じる', primary: true }],
  },
  'vil-save': {
    title: '.vil ファイルに保存',
    body: (
      <>
        <p>この画面の内容（編集中の 3 件を含む）を、Vial と同じ形式のファイルに保存します。</p>
        <p className="write-note">
          マクロ、Key Override、QMK Settings は、このファイルに含まれません。このファイルを Vial で本体に書き戻すと、それらは空になることがあります。
        </p>
      </>
    ),
    actions: [{ label: 'やめる' }, { label: '保存する', primary: true }],
  },
  'vil-load': {
    title: 'cornix_261012.vil を読み込みました',
    body: (
      <>
        <p>ファイルの内容を、この画面に入れました。本体には、まだ書き込んでいません。</p>
        <p>
          いまの本体と違う所は 12 件です。右上の「書き込み（変更 12 件）」で、変更点を確かめてから書き込んでください。読み込みをやめる時は、変更点の一覧で「読み込みを取り消す」を選びます。
        </p>
        <p className="write-note">このファイルに入っていた QMK Settings など 9 件は、本体に書き込まれません。</p>
      </>
    ),
    actions: [{ label: '閉じる', primary: true }],
  },
  'vil-mismatch': {
    title: 'この .vil は読み込めません',
    tone: 'ng',
    body: (
      <>
        <p>ファイルが、接続中のキーボードのものではありません（機器の識別が違います）。</p>
        <p className="write-note">Cornix LP で保存した .vil を選んでください。画面の内容は変えていません。</p>
      </>
    ),
    actions: [{ label: '閉じる', primary: true }],
  },
  'device-info': {
    title: '接続中のキーボード',
    body: (
      <table className="changes">
        <tbody>
          <tr>
            <th>機器</th>
            <td>Cornix（ファームウェア V1.12）</td>
          </tr>
          <tr>
            <th>接続</th>
            <td>Bluetooth ・ Vial プロトコル 6</td>
          </tr>
          <tr>
            <th>レイヤー</th>
            <td>10</td>
          </tr>
          <tr>
            <th>長押し・2回タップの組み合わせ</th>
            <td>使える（Tap Dance の枠 32 個、残り 30）</td>
          </tr>
          <tr>
            <th>コンボ</th>
            <td>使える（枠 32 個、残り 32）</td>
          </tr>
          <tr>
            <th>ロータリーエンコーダー</th>
            <td>2 つ</td>
          </tr>
          <tr>
            <th>レイヤー切り替え</th>
            <td>押している間だけ ・ 押すたびにオン・オフ ・ そのレイヤーに移動 ・ 次の1キーだけ（実機で確認済み）</td>
          </tr>
        </tbody>
      </table>
    ),
    actions: [{ label: '閉じる', primary: true }],
  },
}

/** 確認や知らせのダイアログ。ボタンは、どれを押しても閉じるだけ（見本） */
export function SceneDialog({ scene, onClose }: { scene: SceneId; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const content = DIALOGS[scene]
  useEffect(() => {
    if (content && !ref.current?.open) ref.current?.showModal()
  }, [content])
  if (!content) return null
  return (
    <dialog ref={ref} className="write-dialog" onClose={onClose}>
      <h2 className={content.tone ?? ''}>{content.title}</h2>
      {content.body}
      <div className="write-actions">
        {content.actions.map((action) => (
          <button type="button" key={action.label} className={action.primary ? 'primary' : ''} onClick={() => ref.current?.close()}>
            {action.label}
          </button>
        ))}
      </div>
    </dialog>
  )
}
