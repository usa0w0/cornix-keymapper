import { useId, useMemo, useState } from 'react'
import { labelOf, layerModesFor } from '../model/action.ts'
import { COMBO_KEYS, comboKeycode } from '../model/encode.ts'
import { sameComboRef, type ComboRef } from '../model/edits.ts'
import { customKeycodesOf } from '../model/keycodes.ts'
import { placeKeys } from '../model/layout.ts'
import {
  comboKeyAt,
  comboList,
  nextAddedCombo,
  planKeys,
  tryAddCombo,
  tryEditCombo,
  type ComboItem,
  type EditState,
  type SessionAction,
} from '../session/editState.ts'
import { ActionPicker } from './ActionPicker.tsx'
import {
  blockedReason,
  comboKeyName,
  comboOrderAt,
  draftContent,
  isLockedOutput,
  missingComboKeys,
  toggleComboKey,
  type ComboDraft,
} from './comboView.ts'
import { KeyboardFigure } from './KeyboardFigure.tsx'
import { keyViewOf, type KeyTarget } from './keyView.ts'
import { KeyLegend, LayerBar } from './LayerBar.tsx'
import { useLayerView, type LayerView } from './useLayerView.ts'

interface Props {
  /** 編集中の状態。図と一覧には、出発点に編集を当てはめた内容を出す */
  state: EditState
  /** 編集を、編集中の状態に送る */
  onAction: (action: SessionAction) => void
  /** 開いているレイヤーと刻印。キーマップのタブと同じものを使う時に渡す。省くと、この部品が持つ */
  shown?: LayerView
  /** 最初から開いておく、追加中・変更中のコンボ（テスト用） */
  initialDraft?: ComboDraft
  /** 最初から図に示しておくコンボ（テスト用） */
  initialShown?: ComboRef
}

const refId = (ref: ComboRef) => ('slot' in ref ? `s${ref.slot}` : `a${ref.added}`)

/**
 * コンボのタブ。レイヤーの行とキーボード図（キーマップのタブと共通）の下に、コンボの一覧と「コンボを追加」を出す。
 * 追加と変更は、図で同時に押すキーをクリックし、動作を選ぶ部品で出す動作を選ぶ。途中でレイヤーを切り替えてよい。
 * コンボは、位置ではなくキーの中身で決まるので、一覧にレイヤーは出さず、図に、いま開いているレイヤーで当たるキーを示す
 */
export function ComboView({ state, onAction, shown, initialDraft, initialShown }: Props) {
  const { source: snapshot, edits } = state
  const own = useLayerView()
  const { layer: selectedLayer, legend, setLayer, setLegend } = shown ?? own
  // 読み直してレイヤー数が減った時に、ないレイヤーを指したままにしない
  const layer = Math.min(selectedLayer, Math.max(snapshot.keymap.length - 1, 0))
  const [draft, setDraft] = useState<ComboDraft | null>(initialDraft ?? null)
  // 一覧で選んで、図に示しているコンボ
  const [shownRef, setShownRef] = useState<ComboRef | null>(initialShown ?? null)
  // 止められた追加・変更の理由
  const [refused, setRefused] = useState<string | null>(null)
  const legendId = useId()
  const keys = useMemo(() => placeKeys(snapshot.layout), [snapshot.layout])
  const custom = useMemo(() => customKeycodesOf(snapshot.layout), [snapshot.layout])
  const plan = useMemo(() => planKeys(state), [state])
  const items = useMemo(() => comboList(state, plan), [state, plan])

  const total = snapshot.combos.length
  const picked = draft ? null : (items.find((item) => shownRef !== null && sameComboRef(item.ref, shownRef)) ?? null)
  // 図に緑で示すキーの、キーコード（押す順）
  const marked = draft ? draft.keys.map((key) => comboKeycode(plan, key)) : (picked?.keycodes ?? [])
  const viewOf = (target: KeyTarget) => keyViewOf(snapshot, layer, target, legend, custom, edits)
  const orderOf = (target: KeyTarget) => (target.kind === 'key' ? comboOrderAt(marked, plan, layer, target.index) : undefined)
  const nameOf = (item: Pick<ComboItem, 'combo'>, index: number) => comboKeyName(item.combo.keys[index], plan, custom, legend)
  const content = draft && draftContent(draft)

  const start = (next: ComboDraft) => {
    setDraft(next)
    setRefused(null)
  }
  const stop = () => {
    setDraft(null)
    setRefused(null)
  }
  // 空のキーと透過のキー、エンコーダーは選べない。4個選んだ後は、選んであるキーを外すことだけできる
  const canSelect = (target: KeyTarget) =>
    draft !== null &&
    target.kind === 'key' &&
    comboKeyAt(state, { layer, key: target.index }) !== undefined &&
    (orderOf(target) !== undefined || draft.keys.length < COMBO_KEYS.max)
  const toggle = (target: KeyTarget) => {
    if (!draft || target.kind !== 'key') return
    const key = comboKeyAt(state, { layer, key: target.index })
    if (key === undefined) return
    start({ ...draft, keys: toggleComboKey(draft.keys, key, plan) })
  }
  // 枠が足りない追加と、本体の設定に直せないコンボは、状態に反映する前に止めて、理由を見せる
  const save = () => {
    if (!draft || !content) return
    const { blocked } = draft.ref ? tryEditCombo(state, draft.ref, content) : tryAddCombo(state, content)
    if (blocked) return setRefused(blockedReason(blocked, total))
    setShownRef(draft.ref ?? { added: nextAddedCombo(state) })
    onAction(draft.ref ? { type: 'editCombo', ref: draft.ref, combo: content } : { type: 'addCombo', combo: content })
    stop()
  }

  return (
    <section className="keymap combo" aria-label="コンボ">
      <LayerBar
        snapshot={snapshot}
        keys={keys}
        edits={edits}
        layer={layer}
        legend={legend}
        legendId={legendId}
        onLayer={setLayer}
        onLegend={setLegend}
      />
      {keys.length === 0 ? (
        <p className="notice">本体のレイアウト定義から、キーの位置を読み取れませんでした。</p>
      ) : (
        <KeyboardFigure keys={keys} viewOf={viewOf} comboOrder={orderOf} onSelect={draft ? toggle : undefined} canSelect={canSelect} />
      )}
      {draft ? (
        <section className="edit" aria-label={draft.ref ? 'コンボの変更' : 'コンボの追加'}>
          <div className="edit-head">
            <h2>{draft.ref ? 'コンボを変更' : 'コンボを追加'}</h2>
            <button type="button" onClick={stop}>
              やめる
            </button>
            <button type="button" className="primary" disabled={!content} onClick={save}>
              {draft.ref ? '変更する' : '追加する'}
            </button>
          </div>
          {refused && (
            <p className="notice combo-refused" role="alert">
              {refused}
            </p>
          )}
          <div className="combo-steps">
            <div className="field">
              <span className="field-name">
                1. 同時に押すキー（上の図でクリック。{COMBO_KEYS.min}〜{COMBO_KEYS.max} 個。レイヤーを切り替えて選んでもよい）
              </span>
              <div className={`field-box combo-keys${draft.keys.length === 0 ? ' unset' : ''}`}>
                {draft.keys.length === 0 && <span className="picker-empty">まだ選んでいません</span>}
                {draft.keys.map((key, order) => {
                  const name = comboKeyName(key, plan, custom, legend)
                  return (
                    <span className="combo-chip" key={order} title={name.full}>
                      <b>{order + 1}</b>
                      {name.short}
                      <button
                        type="button"
                        aria-label={`${name.full} を外す`}
                        onClick={() => start({ ...draft, keys: draft.keys.filter((_, index) => index !== order) })}
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
            <div className="field">
              <span className="field-name">2. 同時に押した時に出す動作</span>
              <div className={`field-box active${draft.output === undefined ? ' unset' : ''}`}>
                <span className="field-value">
                  {draft.output === undefined ? '（下から選ぶ）' : labelOf(draft.output, legend).full}
                </span>
              </div>
            </div>
          </div>
          {draft.output && isLockedOutput(draft.output) && (
            <p className="edit-note">
              🔒
              いまの出す動作は、このサイトでは選べない動作です。そのままにすれば、内容は残ります。下で動作を選ぶと、選んだ動作に置き換わります。
            </p>
          )}
          <ActionPicker
            slot="combo"
            slotName="出す動作"
            current={draft.output && !isLockedOutput(draft.output) ? draft.output : undefined}
            layerCount={snapshot.keymap.length}
            layerModes={layerModesFor(snapshot.capabilities.vialProtocol).modes}
            legend={legend}
            onPick={(output) => start({ ...draft, output })}
          />
        </section>
      ) : (
        <section className="edit" aria-label="コンボの一覧">
          <div className="edit-head">
            <h2>コンボ（複数のキーを同時に押した時の動作）</h2>
            <span className="picker-empty">どのレイヤーでも、同じ中身のキーを同時に押せば働きます。</span>
            <button
              type="button"
              className="primary"
              disabled={plan.freeCombos <= 0}
              onClick={() => start({ ref: null, keys: [] })}
            >
              コンボを追加
            </button>
          </div>
          {plan.freeCombos <= 0 && (
            <p className="notice combo-refused">
              {total === 0
                ? 'この本体には、コンボの枠がありません。コンボは追加できません。'
                : `コンボの枠（${total} 個）をすべて使っているので、追加できません。追加するには、下の一覧のどれかを削除してください。`}
            </p>
          )}
          {items.length === 0 ? (
            <p className="edit-empty">
              まだコンボはありません。「コンボを追加」を押してから、上の図で同時に押すキーを選びます。
            </p>
          ) : (
            <ul className="combo-list">
              {items.map((item) => {
                const isShown = picked === item
                const missing = isShown ? missingComboKeys(item.keycodes, plan, layer) : []
                const locked = isLockedOutput(item.combo.output)
                return (
                  <li key={refId(item.ref)} className={isShown ? 'shown' : ''}>
                    <button
                      type="button"
                      className="combo-row"
                      aria-pressed={isShown}
                      title="図で、このコンボのキーを示す"
                      onClick={() => setShownRef(item.ref)}
                    >
                      {item.combo.keys.map((_, order) => (
                        <span className="combo-chip" key={order} title={nameOf(item, order).full}>
                          <b>{order + 1}</b>
                          {nameOf(item, order).short}
                        </span>
                      ))}
                      <span className="combo-arrow">→</span>
                      <strong>{labelOf(item.combo.output, legend).full}</strong>
                      {locked && (
                        <span className="combo-arrow" title="このサイトでは選べない動作。内容はそのまま残ります">
                          🔒 このサイトでは編集不可
                        </span>
                      )}
                      {item.changed && <span className="combo-changed">変更あり</span>}
                      {missing.length > 0 && (
                        <span className="combo-missing">
                          レイヤー {layer} には「{missing.map((index) => nameOf(item, index).short).join('」「')}
                          」のキーがないので、このレイヤーでは働きません
                        </span>
                      )}
                    </button>
                    <button type="button" onClick={() => start({ ref: item.ref, ...item.combo })}>
                      変更
                    </button>
                    <button type="button" onClick={() => onAction({ type: 'editCombo', ref: item.ref, combo: null })}>
                      削除
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
      <KeyLegend id={legendId} />
    </section>
  )
}
