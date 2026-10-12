import { useId, useMemo, useState } from 'react'
import type { KeyboardSnapshot } from '../device/types.ts'
import type { Legend } from '../model/action.ts'
import { customKeycodesOf } from '../model/keycodes.ts'
import { placeKeys } from '../model/layout.ts'
import { KeyboardFigure, KeyFace } from './KeyboardFigure.tsx'
import { isLayerEmpty, keyViewOf, type KeyView } from './keyView.ts'

const LEGENDS: readonly Legend[] = ['us', 'jis']

/** キーマップの表示。レイヤーの行（番号、凡例を開く「?」、刻印の切り替え）と、選んだレイヤーのキーボード図 */
export function KeymapView({ snapshot }: { snapshot: KeyboardSnapshot }) {
  const [selectedLayer, setLayer] = useState(0)
  // 読み直してレイヤー数が減った時に、ないレイヤーを指したままにしない
  const layer = Math.min(selectedLayer, Math.max(snapshot.keymap.length - 1, 0))
  const [legend, setLegend] = useState<Legend>('us')
  const legendId = useId()
  const keys = useMemo(() => placeKeys(snapshot.layout), [snapshot.layout])
  const custom = useMemo(() => customKeycodesOf(snapshot.layout), [snapshot.layout])

  return (
    <section className="keymap" aria-label="キーマップ">
      <div className="layers">
        <span className="layers-title">レイヤー</span>
        {snapshot.keymap.map((_, index) => (
          <button
            type="button"
            key={index}
            aria-pressed={layer === index}
            className={isLayerEmpty(snapshot, index, keys) ? 'empty' : ''}
            onClick={() => setLayer(index)}
          >
            {index}
          </button>
        ))}
        <button type="button" className="help" popoverTarget={legendId} aria-label="キーの見え方">
          ?
        </button>
        <span className="spacer" />
        <span
          className="layers-title"
          title="パソコン側の配列の設定に合わせて、キーの字の見え方を切り替える。本体に書く内容は変わらない"
        >
          刻印
        </span>
        {LEGENDS.map((kind) => (
          <button type="button" key={kind} aria-pressed={legend === kind} onClick={() => setLegend(kind)}>
            {kind.toUpperCase()}
          </button>
        ))}
      </div>
      {keys.length === 0 ? (
        <p className="notice">本体のレイアウト定義から、キーの位置を読み取れませんでした。</p>
      ) : (
        <KeyboardFigure keys={keys} viewOf={(target) => keyViewOf(snapshot, layer, target, legend, custom)} />
      )}
      <KeyLegend id={legendId} />
    </section>
  )
}

const a = { short: 'A', full: 'A' }
// この時点で図に出る状態だけを並べる。変更あり、選択中は、それぞれを作る時に足す
const SAMPLES: readonly { name: string; view: KeyView }[] = [
  { name: 'タップだけ', view: { state: 'normal', slots: { tap: a } } },
  { name: 'タップと長押し', view: { state: 'normal', slots: { tap: a, hold: { short: 'Ctrl', full: '左 Ctrl' } } } },
  {
    name: '4つとも',
    view: {
      state: 'normal',
      slots: {
        tap: a,
        hold: { short: 'Ctrl', full: '' },
        doubleTap: { short: 'Esc', full: '' },
        tapHold: { short: 'Shift', full: '' },
      },
    },
  },
  { name: '長押しだけ', view: { state: 'normal', slots: { hold: { short: 'レイヤー 2', note: '押している間', full: '' } } } },
  { name: '空（何もしない）', view: { state: 'none', slots: {} } },
  {
    name: '透過',
    view: {
      state: 'transparent',
      slots: { tap: { short: '透過', full: '透過' } },
      inherited: { layer: 0, state: 'normal', slots: { tap: a } },
    },
  },
  { name: '編集不可', view: { state: 'locked', slots: { tap: { short: 'BT0', full: 'BT0' } } } },
]

/** キーの見え方の見本。レイヤーの行の「?」から開く */
function KeyLegend({ id }: { id: string }) {
  return (
    <section className="legend" id={id} popover="auto" aria-label="キーの見え方">
      <div className="legend-head">
        <h2>キーの見え方</h2>
        <button type="button" className="quiet" popoverTarget={id} popoverTargetAction="hide" aria-label="閉じる">
          ×
        </button>
      </div>
      <ul>
        {SAMPLES.map(({ name, view }) => (
          <li key={name}>
            <span className={`key state-${view.state}`}>
              <KeyFace view={view} />
            </span>
            {name}
          </li>
        ))}
      </ul>
      <p className="legend-note">
        大きな字がタップ、「長押し」「2回」（2回タップ）「2回長」（タップ後長押し）の印が付いた小さな字が、ほかの押し方の動作です。透過のキーには、下のレイヤーで実際に効く動作を薄く出します。レイヤーの番号が薄いものは、キーが1つも割り当てられていないレイヤーです。
      </p>
    </section>
  )
}
