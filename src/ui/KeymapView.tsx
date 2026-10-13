import { useId, useMemo, useState } from 'react'
import { layerModesFor, type Action, type Legend } from '../model/action.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { linkedKeys, type EditPlace, type KeyPlace } from '../model/edits.ts'
import { customKeycodesOf } from '../model/keycodes.ts'
import { placeKeys } from '../model/layout.ts'
import {
  planKeys,
  tryEditEncoder,
  tryEditKey,
  tryEditKeysTogether,
  tryRevertEdit,
  type EditState,
  type SessionAction,
} from '../session/editState.ts'
import { KeyboardFigure, KeyFace } from './KeyboardFigure.tsx'
import { KeyEditor } from './KeyEditor.tsx'
import { behaviorAt, isChanged, isLayerEmpty, keyViewOf, targetId, targetOf, type KeyTarget, type KeyView } from './keyView.ts'
import { decideSharedEdit, sharedKeyList, type SharedAnswer } from './sharedKey.ts'
import { SharedKeyDialog } from './SharedKeyDialog.tsx'
import { SlotShortageDialog } from './SlotShortageDialog.tsx'
import { shortageList } from './slotShortage.ts'

const LEGENDS: readonly Legend[] = ['us', 'jis']

/** 枠が足りない時のダイアログに出すもの */
interface Shortage {
  /** 止めた編集があるか。なければ、いまの状態で枠が足りないことを見せているだけ */
  attempted: boolean
  /** 使われていない枠を上書きすれば行える、止めた編集 */
  overwrite?: KeyChange
}

/** キーの編集1回。together があれば、そのキー（place を含む）を連動して変える。なければ、place だけを変える */
interface KeyChange {
  place: KeyPlace
  behavior: KeyBehavior
  together: KeyPlace[] | null
}

/** 共有中のキーを変える前の確認。keys は、同じ枠を指しているキー（place を含む） */
interface SharedConfirm {
  place: KeyPlace
  behavior: KeyBehavior
  keys: KeyPlace[]
}

interface Props {
  /** 編集中の状態。図と編集欄には、出発点に編集を当てはめた内容を出す */
  state: EditState
  /** 編集を、編集中の状態に送る */
  onAction: (action: SessionAction) => void
}

/**
 * キーマップの表示と編集。レイヤーの行（番号、凡例を開く「?」、刻印の切り替え）、選んだレイヤーのキーボード図、
 * 図で選んだキー（か、エンコーダーの1方向）の編集欄
 */
export function KeymapView({ state, onAction }: Props) {
  const { source: snapshot, edits } = state
  const [selectedLayer, setLayer] = useState(0)
  // 読み直してレイヤー数が減った時に、ないレイヤーを指したままにしない
  const layer = Math.min(selectedLayer, Math.max(snapshot.keymap.length - 1, 0))
  const [legend, setLegend] = useState<Legend>('us')
  // 選んだ場所（キーか、エンコーダーの1方向）。レイヤーを切り替えても、同じ場所を選んだままにする
  const [selectedTarget, setSelectedTarget] = useState<KeyTarget | null>(null)
  const [shortage, setShortage] = useState<Shortage | null>(null)
  const [confirm, setConfirm] = useState<SharedConfirm | null>(null)
  // 共有中のキーの確認への答え。そのキーを選んでいる間だけ覚える（欄を1つ変えるたびに、確認を出さないため）
  const [answer, setAnswer] = useState<SharedAnswer | null>(null)
  const legendId = useId()
  const keys = useMemo(() => placeKeys(snapshot.layout), [snapshot.layout])
  const custom = useMemo(() => customKeycodesOf(snapshot.layout), [snapshot.layout])
  const plan = useMemo(() => planKeys(state), [state])

  // 読み直してレイアウトが変わった時に、ない場所を選んだままにしない
  const selectedPlace = selectedTarget && keys.find((key) => targetId(targetOf(key)) === targetId(selectedTarget))
  const selected: KeyTarget | null = selectedPlace ? targetOf(selectedPlace) : null
  const viewOf = (target: KeyTarget) => keyViewOf(snapshot, layer, target, legend, custom, edits)
  const behavior = selected && behaviorAt(snapshot, layer, selected, custom, edits)

  // キーとレイヤーを選び直したら、共有中のキーの確認への答えを忘れる
  const selectLayer = (index: number) => {
    setLayer(index)
    setAnswer(null)
  }
  const select = (target: KeyTarget) => {
    setSelectedTarget(target)
    setAnswer(null)
  }

  const send = ({ place, behavior, together }: KeyChange, overwriteUnused?: boolean) => {
    onAction(
      together
        ? { type: 'editKeysTogether', keys: together, behavior, overwriteUnused }
        : { type: 'editKey', ...place, behavior, overwriteUnused },
    )
    setAnswer({ ...place, source: snapshot, together })
  }
  // 枠が足りなくなる編集は、状態に反映する前に止めて、理由と、枠を使っているキーを見せる
  const apply = (change: KeyChange) => {
    const { place, behavior, together } = change
    const { blocked } = together
      ? tryEditKeysTogether(state, together, behavior)
      : tryEditKey(state, place.layer, place.key, behavior)
    if (!blocked) return send(change)
    const canOverwrite = blocked.invalid.length === 0 && blocked.overwritable >= blocked.missing
    setShortage({ attempted: true, overwrite: canOverwrite ? change : undefined })
  }
  // 同じ枠を指すキーがほかにあれば、連動して変えるか、このキーだけを変えるかを、先に確認する
  const change = (key: number, next: KeyBehavior) => {
    const place = { layer, key }
    const decision = decideSharedEdit(state, place, answer)
    if (decision.kind === 'ask') return setConfirm({ place, behavior: next, keys: decision.keys })
    apply({ place, behavior: next, together: decision.kind === 'together' ? decision.keys : null })
  }
  // エンコーダーは動作1つで、枠を使わないので、共有の確認は要らない
  const changeEncoder = (encoder: number, direction: 'left' | 'right', action: Action) => {
    if (tryEditEncoder(state, layer, encoder, direction, action).blocked) return setShortage({ attempted: true })
    onAction({ type: 'editEncoder', layer, encoder, direction, action })
  }
  // 空いた枠をほかのキーが使った後で、枠を空けた編集を取り消すと、枠が足りなくなる。これも止める
  const revert = (target: KeyTarget) => {
    const place: EditPlace = target.kind === 'key' ? { kind: 'key', layer, key: target.index } : { ...target, layer }
    if (tryRevertEdit(state, place).blocked) return setShortage({ attempted: true })
    onAction({ type: 'revert', place })
    setAnswer(null)
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
            onClick={() => selectLayer(index)}
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
          onSelect={select}
        />
      )}
      {selectedPlace && selected && behavior ? (
        <KeyEditor
          // 別のキーを選んだら、欄の選択を「タップ」に戻す
          key={`${layer}:${targetId(selected)}`}
          layer={layer}
          place={selectedPlace}
          behavior={behavior}
          view={viewOf(selected)}
          changed={isChanged(edits, layer, selected)}
          linked={selected.kind === 'key' ? linkedKeys(edits.keys, { layer, key: selected.index }).length : 1}
          legend={legend}
          layerCount={snapshot.keymap.length}
          layerModes={layerModesFor(snapshot.capabilities.vialProtocol).modes}
          onChange={(next) =>
            selected.kind === 'key'
              ? change(selected.index, next)
              : changeEncoder(selected.encoder, selected.direction, next.tap ?? { kind: 'none' })
          }
          onRevert={() => revert(selected)}
        />
      ) : (
        keys.length > 0 && (
          <section className="edit" aria-label="選んだキー">
            <p className="edit-empty">キーかエンコーダーをクリックすると、ここで動作を変えられます。</p>
          </section>
        )
      )}
      {confirm && (
        <SharedKeyDialog
          list={sharedKeyList(state, confirm.place, confirm.keys, confirm.behavior, legend)}
          places={keys}
          onTogether={() => {
            setConfirm(null)
            apply({ place: confirm.place, behavior: confirm.behavior, together: confirm.keys })
          }}
          onOnly={() => {
            setConfirm(null)
            apply({ place: confirm.place, behavior: confirm.behavior, together: null })
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {shortage && (
        <SlotShortageDialog
          list={shortageList(state, legend)}
          attempted={shortage.attempted}
          onJump={(toLayer, key) => {
            selectLayer(toLayer)
            select({ kind: 'key', index: key })
            setShortage(null)
          }}
          onOverwrite={
            shortage.overwrite
              ? () => {
                  send(shortage.overwrite!, true)
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
