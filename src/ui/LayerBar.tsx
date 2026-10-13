import type { KeyboardSnapshot } from '../device/types.ts'
import type { Legend } from '../model/action.ts'
import type { Edits } from '../model/edits.ts'
import type { PlacedKey } from '../model/layout.ts'
import { KeyFace } from './KeyboardFigure.tsx'
import { isLayerEmpty, type KeyView } from './keyView.ts'

const LEGENDS: readonly Legend[] = ['us', 'jis']

interface Props {
  snapshot: KeyboardSnapshot
  keys: readonly PlacedKey[]
  edits: Edits
  layer: number
  legend: Legend
  /** 凡例（KeyLegend）の id。「?」で開く */
  legendId: string
  onLayer: (layer: number) => void
  onLegend: (legend: Legend) => void
}

/** レイヤーの行。番号のボタン、凡例を開く「?」、刻印の切り替え */
export function LayerBar({ snapshot, keys, edits, layer, legend, legendId, onLayer, onLegend }: Props) {
  return (
    <div className="layers">
      <span className="layers-title">レイヤー</span>
      {snapshot.keymap.map((_, index) => (
        <button
          type="button"
          key={index}
          aria-pressed={layer === index}
          className={isLayerEmpty(snapshot, index, keys, edits) ? 'empty' : ''}
          onClick={() => onLayer(index)}
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
        <button type="button" key={kind} aria-pressed={legend === kind} onClick={() => onLegend(kind)}>
          {kind.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

const a = { short: 'A', full: 'A' }
const SAMPLES: readonly { name: string; view: KeyView; changed?: boolean; selected?: boolean; combo?: number }[] = [
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
  { name: '変更あり', view: { state: 'normal', slots: { tap: a } }, changed: true },
  { name: '選択中', view: { state: 'normal', slots: { tap: a } }, selected: true },
  { name: 'コンボのキー（コンボのタブ）', view: { state: 'normal', slots: { tap: a } }, combo: 1 },
]

/** キーの見え方の見本。レイヤーの行の「?」から開く */
export function KeyLegend({ id }: { id: string }) {
  return (
    <section className="legend" id={id} popover="auto" aria-label="キーの見え方">
      <div className="legend-head">
        <h2>キーの見え方</h2>
        <button type="button" className="quiet" popoverTarget={id} popoverTargetAction="hide" aria-label="閉じる">
          ×
        </button>
      </div>
      <ul>
        {SAMPLES.map(({ name, view, changed, selected, combo }) => (
          <li key={name}>
            <span
              className={`key state-${view.state}${changed ? ' changed' : ''}${selected ? ' selected' : ''}${combo ? ' in-combo' : ''}`}
            >
              {combo && <span className="mark-combo">{combo}</span>}
              <KeyFace view={view} changed={changed} />
            </span>
            {name}
          </li>
        ))}
      </ul>
      <p className="legend-note">
        大きな字がタップ、「長押し」「2回」（2回タップ）「2回長」（タップ後長押し）の印が付いた小さな字が、ほかの押し方の動作です。透過のキーには、下のレイヤーで実際に効く動作を薄く出します。コンボのタブでは、コンボのキーを緑で示し、押す順の番号を付けます。レイヤーの番号が薄いものは、キーが1つも割り当てられていないレイヤーです。
      </p>
    </section>
  )
}
