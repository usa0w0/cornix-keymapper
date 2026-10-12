import type { CSSProperties } from 'react'
import { boundsOf, type Bounds, type PlacedKey } from '../model/layout.ts'
import { isLong, targetId, targetName, targetOf, type KeyTarget, type KeyView } from './keyView.ts'

/** キー1つぶんの大きさと、キーどうしのすき間（px） */
const UNIT = 64
const GAP = 4

function placeOf(key: PlacedKey, box: Bounds): CSSProperties {
  return {
    left: (key.x - box.minX) * UNIT,
    top: (key.y - box.minY) * UNIT,
    width: key.w * UNIT - GAP,
    height: key.h * UNIT - GAP,
    transform: key.r ? `rotate(${key.r}deg)` : undefined,
    transformOrigin: `${(key.rx - key.x) * UNIT}px ${(key.ry - key.y) * UNIT}px`,
  }
}

/** キーボード図。レイアウト定義から取り出した場所に、キーとエンコーダーを並べる */
export function KeyboardFigure({ keys, viewOf }: { keys: readonly PlacedKey[]; viewOf: (target: KeyTarget) => KeyView }) {
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
          const shape = key.kind === 'encoder' ? ` encoder encoder-${key.direction}` : ''
          return (
            <div
              key={targetId(target)}
              className={`key state-${view.state}${shape}`}
              style={placeOf(key, box)}
              title={`${targetName(key)}: ${titleOf(view)}`}
            >
              {key.kind === 'encoder' && (
                <span className="encoder-turn">{key.direction === 'left' ? '↺ 左回し' : '右回し ↻'}</span>
              )}
              <KeyFace view={view} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** マウスを載せた時に出す、省略しない名前 */
function titleOf(view: KeyView): string {
  if (view.state === 'locked') return `${view.label.full}（このサイトでは編集不可）`
  if (view.state !== 'transparent') return view.label.full
  if (!view.inherited) return '透過（下のレイヤーに、効く動作がありません）'
  return `透過（レイヤー ${view.inherited.layer} の「${view.inherited.label.full}」が効きます）`
}

/** キーの上の表示。透過キーは、下のレイヤーで実際に効く動作を出す（薄くするのはスタイルの側） */
export function KeyFace({ view }: { view: KeyView }) {
  const shown = view.state === 'transparent' ? view.inherited : view
  return (
    <>
      {view.state === 'locked' && (
        <span className="mark-locked" title="このサイトでは編集不可">
          🔒
        </span>
      )}
      {view.state === 'transparent' && <span className="mark-transparent">透過</span>}
      {shown?.label.shifted && (
        <span className="face-shifted" title="Shift を押しながら打った時に出る字">
          {shown.label.shifted}
        </span>
      )}
      {shown && shown.label.short !== '' && (
        <span className="face-main">
          <b className={isLong(shown.label.short) ? 'long' : ''}>{shown.label.short}</b>
          {shown.label.note && <small>{shown.label.note}</small>}
        </span>
      )}
    </>
  )
}
