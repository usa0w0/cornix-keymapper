import { useEffect, useRef } from 'react'
import { boundsOf, type PlacedKey } from '../model/layout.ts'
import { placeOf, targetId, targetOf } from './keyView.ts'
import type { SharedKeyList } from './sharedKey.ts'

/** 小さな図の、キー1つぶんの大きさと、キーどうしのすき間（px） */
const UNIT = 18
const GAP = 2

interface Props {
  list: SharedKeyList
  /** キーボード図のキーの場所。同じ枠を指すキーの位置を、レイヤーごとの小さな図で示す */
  places: readonly PlacedKey[]
  /** 同じ枠を指すキーすべてを、連動して変える */
  onTogether: () => void
  /** 選んだキーだけを変える */
  onOnly: () => void
  onClose: () => void
}

/**
 * 共有中のキー（同じ Tap Dance の枠を指しているキーがほかにあるキー）を変える時の確認。
 * 同じ枠を指すキーの場所の一覧と、その位置を示す図を出し、「n つとも変更」「このキーだけ変更」「やめる」を選ばせる
 */
export function SharedKeyDialog({ list, places, onTogether, onOnly, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    element?.querySelector<HTMLButtonElement>('.dialog-actions button.primary')?.focus()
    return () => element?.close()
  }, [])
  const others = list.keys.length - 1
  const layers = [...new Set(list.keys.map((key) => key.layer))]

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="shared-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id="shared-title">このキーと同じ内容のキーが、ほかに {others} つあります</h2>
      <p>
        「{list.name}」のキーは、次の {list.keys.length} か所にあり、本体の中で1つの枠を共有しています。
      </p>
      <ul className="plain-list">
        {list.keys.map(({ layer, key, place, current }) => (
          <li key={`${layer}:${key}`}>
            {place}
            {current && <span className="plain-list-note">（いま変えようとしているキー）</span>}
          </li>
        ))}
      </ul>
      {places.length > 0 && (
        <div className="mini-figures">
          {layers.map((layer) => (
            <MiniFigure key={layer} layer={layer} places={places} list={list} />
          ))}
        </div>
      )}
      {places.length > 0 && (
        <p className="mini-note">色を付けたキーが、同じ内容のキーです。いま変えようとしているキーは、枠で囲んであります。</p>
      )}
      <p>
        いま変えようとしているキーを「{list.next}」にします。ほかの {others} つも同じように変えますか？
        {list.only === 'new' && `「このキーだけ変更」を選ぶと、枠を1つ新しく使います（残り ${list.free}）。`}
        {list.only === 'short' && '「このキーだけ変更」には枠が1つ要りますが、空いている枠がありません。'}
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          やめる
        </button>
        <button type="button" onClick={onOnly}>
          このキーだけ変更
        </button>
        <button type="button" className="primary" onClick={onTogether}>
          {list.keys.length} つとも変更
        </button>
      </div>
    </dialog>
  )
}

/** レイヤー1枚ぶんの小さな図。同じ枠を指すキーに色を付け、いま変えようとしているキーを枠で囲む */
function MiniFigure({ layer, places, list }: { layer: number; places: readonly PlacedKey[]; list: SharedKeyList }) {
  const box = boundsOf(places)
  const shared = list.keys.filter((key) => key.layer === layer)
  const names = shared.map((key) => (key.current ? `${key.place}（いま変えようとしているキー）` : key.place))
  return (
    <figure className="mini-figure">
      <figcaption>レイヤー {layer}</figcaption>
      <div
        className="mini-board"
        role="img"
        aria-label={`同じ内容のキーの位置: ${names.join('、')}`}
        style={{ width: (box.maxX - box.minX) * UNIT, height: (box.maxY - box.minY) * UNIT }}
      >
        {places.map((key) => {
          const found = key.kind === 'key' ? shared.find((item) => item.key === key.index) : undefined
          const mark = found ? (found.current ? ' shared current' : ' shared') : ''
          return (
            <span
              key={targetId(targetOf(key))}
              className={`mini-key${key.kind === 'encoder' ? ' encoder' : ''}${mark}`}
              style={placeOf(key, box, UNIT, GAP)}
            />
          )
        })}
      </div>
    </figure>
  )
}
