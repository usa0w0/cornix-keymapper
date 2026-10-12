import { boundsOf, type PlacedKey } from '../model/layout.ts'
import { filledSlots, type BehaviorSlot } from '../model/behavior.ts'
import { isLong, placeOf, slotsName, targetId, targetName, targetOf, type KeyTarget, type KeyView } from './keyView.ts'

/** キー1つぶんの大きさ（px） */
const UNIT = 64

interface FigureProps {
  keys: readonly PlacedKey[]
  viewOf: (target: KeyTarget) => KeyView
  /** 利用者が変えた場所か。変更ありの印を出す */
  isChanged?: (target: KeyTarget) => boolean
  /** 選択中の場所 */
  selected?: KeyTarget | null
  /** キーを押した時。渡すと、キーを押せる部品にする。エンコーダーは、まだ選べない（#12） */
  onSelect?: (target: KeyTarget) => void
}

/** キーボード図。レイアウト定義から取り出した場所に、キーとエンコーダーを並べる */
export function KeyboardFigure({ keys, viewOf, isChanged, selected, onSelect }: FigureProps) {
  const box = boundsOf(keys)
  return (
    <div className="figure-scroll">
      <div
        className="figure"
        role="group"
        aria-label="キーボード図"
        style={{ width: (box.maxX - box.minX) * UNIT, height: (box.maxY - box.minY) * UNIT }}
      >
        {keys.map((key) => {
          const target = targetOf(key)
          const view = viewOf(target)
          const changed = isChanged?.(target) ?? false
          const shape = key.kind === 'encoder' ? ` encoder encoder-${key.direction}` : ''
          const name = `${targetName(key)}: ${titleOf(view)}${changed ? '（変更あり）' : ''}`
          const className = `key state-${view.state}${shape}${changed ? ' changed' : ''}`
          if (key.kind === 'key' && onSelect) {
            return (
              <button
                type="button"
                key={targetId(target)}
                className={className}
                style={placeOf(key, box)}
                aria-pressed={selected != null && targetId(selected) === targetId(target)}
                aria-label={name}
                title={name}
                onClick={() => onSelect(target)}
              >
                <KeyFace view={view} changed={changed} />
              </button>
            )
          }
          return (
            <div
              key={targetId(target)}
              className={className}
              style={placeOf(key, box)}
              // 押せない場所は、場所と動作をまとめた1つの絵として読み上げさせる
              role="img"
              aria-label={name}
              title={name}
            >
              {key.kind === 'encoder' && (
                <span className="encoder-turn">{key.direction === 'left' ? '↺ 左回し' : '右回し ↻'}</span>
              )}
              <KeyFace view={view} changed={changed} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** マウスを載せた時に出す、省略しない名前 */
function titleOf(view: KeyView): string {
  if (view.state === 'locked') return `${slotsName(view.slots)}（このサイトでは編集不可）`
  if (view.state !== 'transparent') return slotsName(view.slots)
  if (!view.inherited) return '透過（下のレイヤーに、効く動作がありません）'
  return `透過（レイヤー ${view.inherited.layer} の「${slotsName(view.inherited.slots)}」が効きます）`
}

/** 小さく出す欄に付ける印。タップには付けない */
const SLOT_TAGS: Record<BehaviorSlot, string> = { tap: '', hold: '長押し', doubleTap: '2回', tapHold: '2回長' }

/**
 * キーの上の表示。タップを大きく、ほかの欄を、印を付けて小さく出す。タップのないキーは、最初の欄を、印を付けて大きく出す。
 * 透過キーは、下のレイヤーで実際に効く動作を出す（薄くするのはスタイルの側）。changed は、変更ありの印（右下の点）
 */
export function KeyFace({ view, changed = false }: { view: KeyView; changed?: boolean }) {
  const slots = (view.state === 'transparent' ? view.inherited?.slots : view.slots) ?? {}
  // 「何もしない」は字を出さない
  const shown = filledSlots(slots).filter((slot) => slots[slot]!.short !== '')
  const main = shown[0]
  return (
    <>
      {changed && <span className="mark-changed" title="変更あり" />}
      {view.state === 'locked' && (
        <span className="mark-locked" title="このサイトでは編集不可">
          🔒
        </span>
      )}
      {view.state === 'transparent' && <span className="mark-transparent">透過</span>}
      {main === 'tap' && slots.tap!.shifted && (
        <span className="face-shifted" title="Shift を押しながら打った時に出る字">
          {slots.tap!.shifted}
        </span>
      )}
      {main && (
        <span className="face-main">
          {main !== 'tap' && <i>{SLOT_TAGS[main]}</i>}
          <b className={isLong(slots[main]!.short) ? 'long' : ''}>{slots[main]!.short}</b>
          {slots[main]!.note && <small>{slots[main]!.note}</small>}
        </span>
      )}
      {shown.slice(1).map((slot) => (
        <span className="face-extra" key={slot}>
          <i>{SLOT_TAGS[slot]}</i>
          {slots[slot]!.short}
        </span>
      ))}
    </>
  )
}
