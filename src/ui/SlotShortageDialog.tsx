import { useEffect, useRef } from 'react'
import type { ShortageList } from './slotShortage.ts'

interface Props {
  list: ShortageList
  /** 止めた編集があるか。ない時は、いまの編集中の状態で枠が足りないことの知らせ */
  attempted: boolean
  /** 一覧のキーを押した時。そのキーへ移る */
  onJump: (layer: number, key: number) => void
  /** 使われていない枠を上書きして、止めた編集を行う。上書きしても足りない時と、止めた編集がない時は null */
  onOverwrite: (() => void) | null
  onClose: () => void
}

/**
 * Tap Dance の枠が足りない時のダイアログ。理由と、枠を使っているキーの一覧を出す。
 * 枠が足りない編集は、状態に反映する前に止めている。中身はあるがどこからも使われていない枠があれば、上書きして使うかを選ばせる
 */
export function SlotShortageDialog({ list, attempted, onJump, onOverwrite, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    // 最初の押せる部品（一覧のキー）ではなく、「閉じる」に焦点を置く
    element?.querySelector<HTMLButtonElement>('.dialog-actions button.primary')?.focus()
    return () => element?.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="shortage-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id="shortage-title" className="ng">
        {attempted ? 'この変更は、枠が足りないのでできません' : 'Tap Dance の枠が足りません'}
      </h2>
      <p>
        長押しや2回タップを組み合わせたキーは、本体の「Tap Dance の枠」を1つ使います。
        {list.total > 0 ? `枠は ${list.total} 個あり、いまはすべて使われています。` : 'この本体には、枠がありません。'}
      </p>
      {list.rows.length > 0 && (
        <>
          <p>どれかのキーの動作を減らすと、枠が空きます。枠を使っているキー（押すと、そのキーへ移ります）:</p>
          <ul className="plain-list">
            {list.rows.map((row) => (
              <li key={row.slot}>
                {row.keys.map(({ layer, key, place }) => (
                  <button type="button" key={`${layer}:${key}`} onClick={() => onJump(layer, key)}>
                    {place}
                  </button>
                ))}
                {row.keys.length === 0 && <span className="plain-list-note">キーからは使われていません</span>}
                <span>{row.name}</span>
                {row.keys.length > 1 && <span className="plain-list-note">（{row.keys.length} つのキーが同じ枠を共有）</span>}
                {row.others > 0 && (
                  <span className="plain-list-note">（エンコーダーかコンボ {row.others} か所からも使われています）</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {list.unused > 0 && (
        <p>
          このほかに、中身は入っているが、どのキーからも使われていない枠が {list.unused} 個あります（Vial
          などで作った内容です）。
          {onOverwrite && 'この枠を上書きして使うと、この変更を行えます。上書きした枠の元の内容は、書き込むと消えます。'}
        </p>
      )}
      <div className="dialog-actions">
        {onOverwrite && (
          <button type="button" onClick={onOverwrite}>
            使われていない枠を上書きして、変更する
          </button>
        )}
        <button type="button" className="primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  )
}
