import { useState } from 'react'
import type { Action, LayerMode, Legend } from '../model/action.ts'
import {
  BEHAVIOR_SLOT_NAMES,
  BEHAVIOR_SLOTS,
  withoutSlot,
  withSlot,
  type BehaviorSlot,
  type KeyBehavior,
} from '../model/behavior.ts'
import { ActionPicker } from './ActionPicker.tsx'
import { KeyFace } from './KeyboardFigure.tsx'
import { placeName, slotsName, type KeyView } from './keyView.ts'

interface Props {
  layer: number
  /** 選んだキーの、行列上の位置 */
  place: { row: number; col: number }
  /** 選んだキーの、編集を当てはめた後の動作と、その見え方 */
  behavior: KeyBehavior
  view: KeyView
  /** 利用者が変えたキーか */
  changed: boolean
  /** 連動して変えたキーの数（このキーを含む）。2 以上なら、「変更を取り消す」で、その数のキーがまとめて戻る */
  linked?: number
  legend: Legend
  /** 本体のレイヤー数と、選べるレイヤー切り替えの方式。動作を選ぶ部品に渡す */
  layerCount: number
  layerModes: readonly LayerMode[]
  onChange: (behavior: KeyBehavior) => void
  /** このキーの変更を取り消す */
  onRevert: () => void
}

/**
 * 編集欄。図の下に、選んだキーの見た目・場所・4つの欄と、動作を選ぶ部品を出す。
 * 欄を押すと選ばれ、動作を選ぶ部品で選んだ動作が、その欄に入る。
 * 4つとも空のキーは何もしないキーで、その時だけ「透過」のスイッチを出す
 */
export function KeyEditor(props: Props) {
  const { layer, place, behavior, view, changed, linked = 1, legend, layerCount, layerModes, onChange, onRevert } = props
  const [active, setActive] = useState<BehaviorSlot>('tap')
  const locked = view.state === 'locked'
  const empty = view.state === 'none' || view.state === 'transparent'
  // 何もしないキーと透過のキーは、欄をすべて空として見せる
  const slots = empty ? {} : view.slots
  // いま入っている動作。編集不可の動作は、動作を選ぶ部品の選択肢にない
  const current: Action | undefined = view.state === 'normal' ? behavior[active] : undefined

  return (
    <section className="edit" aria-label="選んだキー">
      <div className="edit-head">
        <span className={`key state-${view.state}${changed ? ' changed' : ''}`}>
          <KeyFace view={view} changed={changed} />
        </span>
        <h2>{placeName(layer, place)} のキー</h2>
        {changed && (
          <button type="button" onClick={onRevert}>
            {linked > 1 ? `変更を取り消す（連動して変えた ${linked} つとも）` : '変更を取り消す'}
          </button>
        )}
      </div>
      {locked && (
        <p className="edit-note">
          🔒
          このキーの動作は、このサイトでは編集できません。内容はそのまま残ります。別の動作で上書きすることはできます（下で動作を選ぶと、このキーの元の内容は、選んだ動作に置き換わります）。
        </p>
      )}
      {empty && (
        <p className="edit-note">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={view.state === 'transparent'}
            title="オンにすると、下のレイヤーの動作がそのまま効く"
            onClick={() => onChange({ tap: { kind: view.state === 'transparent' ? 'none' : 'transparent' } })}
          >
            <span className="switch-track" />
            透過
          </button>
          {view.state === 'none'
            ? '欄がすべて空なので、このキーは押しても何も起きません。'
            : view.inherited
              ? `下のレイヤーの動作（レイヤー ${view.inherited.layer} の「${slotsName(view.inherited.slots)}」）がそのまま効きます。`
              : '下のレイヤーに、効く動作がありません。'}
        </p>
      )}
      <div className="fields">
        {BEHAVIOR_SLOTS.map((slot) => {
          const label = slots[slot]
          const name = BEHAVIOR_SLOT_NAMES[slot]
          return (
            <div className="field" key={slot}>
              <span className="field-name">{name}</span>
              <div className={`field-box${label ? '' : ' unset'}${active === slot ? ' active' : ''}`}>
                <button
                  type="button"
                  className="field-value"
                  aria-pressed={active === slot}
                  aria-label={`${name}: ${label?.full ?? '（なし）'}`}
                  onClick={() => setActive(slot)}
                >
                  {label?.full ?? '（なし）'}
                </button>
                {label && !locked && (
                  <button
                    type="button"
                    className="field-clear"
                    aria-label={`${name}を消す`}
                    title="この欄を消す"
                    onClick={() => onChange(withoutSlot(behavior, slot))}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ActionPicker
        slot={active}
        slotName={BEHAVIOR_SLOT_NAMES[active]}
        current={current}
        layerCount={layerCount}
        layerModes={layerModes}
        legend={legend}
        onPick={(action) => onChange(withSlot(behavior, active, action))}
      />
    </section>
  )
}
