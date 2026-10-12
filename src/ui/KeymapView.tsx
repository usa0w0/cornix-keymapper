import { useId, useMemo, useState } from 'react'
import { layerModesFor, type Legend } from '../model/action.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { customKeycodesOf } from '../model/keycodes.ts'
import { placeKeys } from '../model/layout.ts'
import { planKeys, tryEditKey, tryRevertEdit, type EditState, type SessionAction } from '../session/editState.ts'
import { KeyboardFigure, KeyFace } from './KeyboardFigure.tsx'
import { KeyEditor } from './KeyEditor.tsx'
import { behaviorAt, isChanged, isLayerEmpty, keyViewOf, type KeyTarget, type KeyView } from './keyView.ts'
import { SlotShortageDialog } from './SlotShortageDialog.tsx'
import { shortageList } from './slotShortage.ts'

const LEGENDS: readonly Legend[] = ['us', 'jis']

/** 枠が足りない時のダイアログに出すもの */
interface Shortage {
  /** 止めた編集があるか。なければ、いまの状態で枠が足りないことを見せているだけ */
  attempted: boolean
  /** 使われていない枠を上書きすれば行える、止めた編集 */
  overwrite?: { layer: number; key: number; behavior: KeyBehavior }
}

interface Props {
  /** 編集中の状態。図と編集欄には、出発点に編集を当てはめた内容を出す */
  state: EditState
  /** 編集を、編集中の状態に送る */
  onAction: (action: SessionAction) => void
}

/**
 * キーマップの表示と編集。レイヤーの行（番号、凡例を開く「?」、刻印の切り替え）、選んだレイヤーのキーボード図、
 * 図で選んだキーの編集欄
 */
export function KeymapView({ state, onAction }: Props) {
  const { source: snapshot, edits } = state
  const [selectedLayer, setLayer] = useState(0)
  // 読み直してレイヤー数が減った時に、ないレイヤーを指したままにしない
  const layer = Math.min(selectedLayer, Math.max(snapshot.keymap.length - 1, 0))
  const [legend, setLegend] = useState<Legend>('us')
  // 選んだキーの番号。レイヤーを切り替えても、同じ場所を選んだままにする
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [shortage, setShortage] = useState<Shortage | null>(null)
  const legendId = useId()
  const keys = useMemo(() => placeKeys(snapshot.layout), [snapshot.layout])
  const custom = useMemo(() => customKeycodesOf(snapshot.layout), [snapshot.layout])
  const plan = useMemo(() => planKeys(state), [state])

  const selectedPlace = keys.find((key) => key.kind === 'key' && key.index === selectedKey)
  const selected: KeyTarget | null = selectedPlace?.kind === 'key' ? { kind: 'key', index: selectedPlace.index } : null
  const viewOf = (target: KeyTarget) => keyViewOf(snapshot, layer, target, legend, custom, edits)
  const behavior = selected && behaviorAt(snapshot, layer, selected, custom, edits)

  // 枠が足りなくなる編集は、状態に反映する前に止めて、理由と、枠を使っているキーを見せる
  const change = (key: number, next: KeyBehavior) => {
    const { blocked } = tryEditKey(state, layer, key, next)
    if (!blocked) return onAction({ type: 'editKey', layer, key, behavior: next })
    const canOverwrite = blocked.invalid.length === 0 && blocked.overwritable >= blocked.missing
    setShortage({ attempted: true, overwrite: canOverwrite ? { layer, key, behavior: next } : undefined })
  }
  // 空いた枠をほかのキーが使った後で、枠を空けた編集を取り消すと、枠が足りなくなる。これも止める
  const revert = (key: number) => {
    const place = { kind: 'key', layer, key } as const
    if (tryRevertEdit(state, place).blocked) return setShortage({ attempted: true })
    onAction({ type: 'revert', place })
  }

  return (
    <section className="keymap" aria-label="キーマップ">
      <div className="layers">
        <span className="layers-title">レイヤー</span>
        {snapshot.keymap.map((_, index) => (
          <button
            type="button"
            key={index}
            aria-pressed={layer === index}
            className={isLayerEmpty(snapshot, index, keys, edits) ? 'empty' : ''}
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
      {plan.missing > 0 && (
        // 読み直した内容に編集を当て直した後など、いまの編集に枠が足りなくなった時
        <p className="notice notice-row" role="alert">
          いまの編集のうち {plan.unplaced.length} つのキーは、Tap Dance の枠が足りないので、本体に書き込めません。枠を使っているキーの動作を減らすか、変更を取り消してください。
          <button type="button" onClick={() => setShortage({ attempted: false })}>
            枠を使っているキーを見る
          </button>
        </p>
      )}
      {keys.length === 0 ? (
        <p className="notice">本体のレイアウト定義から、キーの位置を読み取れませんでした。</p>
      ) : (
        <KeyboardFigure
          keys={keys}
          viewOf={viewOf}
          isChanged={(target) => isChanged(edits, layer, target)}
          selected={selected}
          onSelect={(target) => target.kind === 'key' && setSelectedKey(target.index)}
        />
      )}
      {selectedPlace?.kind === 'key' && selected && behavior ? (
        <KeyEditor
          // 別のキーを選んだら、欄の選択を「タップ」に戻す
          key={`${layer}:${selectedPlace.index}`}
          layer={layer}
          place={selectedPlace}
          behavior={behavior}
          view={viewOf(selected)}
          changed={isChanged(edits, layer, selected)}
          legend={legend}
          layerCount={snapshot.keymap.length}
          layerModes={layerModesFor(snapshot.capabilities.vialProtocol).modes}
          onChange={(next) => change(selectedPlace.index, next)}
          onRevert={() => revert(selectedPlace.index)}
        />
      ) : (
        keys.length > 0 && (
          <section className="edit" aria-label="選んだキー">
            <p className="edit-empty">キーをクリックすると、ここで動作を変えられます。</p>
          </section>
        )
      )}
      {shortage && (
        <SlotShortageDialog
          list={shortageList(state, legend)}
          attempted={shortage.attempted}
          onJump={(toLayer, key) => {
            setLayer(toLayer)
            setSelectedKey(key)
            setShortage(null)
          }}
          onOverwrite={
            shortage.overwrite
              ? () => {
                  onAction({ type: 'editKey', ...shortage.overwrite!, overwriteUnused: true })
                  setShortage(null)
                }
              : null
          }
          onClose={() => setShortage(null)}
        />
      )}
      <KeyLegend id={legendId} />
    </section>
  )
}

const a = { short: 'A', full: 'A' }
// コンボのキー（緑の枠）は、コンボのタブを作る時に足す
const SAMPLES: readonly { name: string; view: KeyView; changed?: boolean; selected?: boolean }[] = [
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
        {SAMPLES.map(({ name, view, changed, selected }) => (
          <li key={name}>
            <span className={`key state-${view.state}${changed ? ' changed' : ''}${selected ? ' selected' : ''}`}>
              <KeyFace view={view} changed={changed} />
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
