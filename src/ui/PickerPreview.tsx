import { useState } from 'react'
import {
  formatKeycode,
  labelOf,
  LAYER_MODES,
  layerModeName,
  type Action,
  type ActionSlot,
  type LayerMode,
  type Legend,
} from '../model/action.ts'
import { actionToKeycode } from '../model/keycodes.ts'
import { ActionPicker } from './ActionPicker.tsx'

const SLOTS: readonly { id: ActionSlot; name: string }[] = [
  { id: 'tap', name: 'タップ' },
  { id: 'hold', name: '長押し' },
  { id: 'doubleTap', name: '2回タップ' },
  { id: 'tapHold', name: 'タップ後長押し' },
  { id: 'encoder', name: '回した時' },
  { id: 'combo', name: 'コンボの出力' },
]

const LAYER_COUNTS = [1, 4, 10, 16]
const LEGENDS: readonly Legend[] = ['us', 'jis']

/**
 * 動作を選ぶ部品だけを出す、仮の見本（URL に ?picker を付けた時だけ開く）。
 * 編集欄（#10）につないだら消す
 */
export function PickerPreview() {
  const [slot, setSlot] = useState<ActionSlot>('tap')
  const [layerCount, setLayerCount] = useState(10)
  const [layerModes, setLayerModes] = useState<readonly LayerMode[]>(LAYER_MODES)
  const [legend, setLegend] = useState<Legend>('us')
  // 欄ごとに、選ばれた動作を持つ
  const [picked, setPicked] = useState<Partial<Record<ActionSlot, Action>>>({})
  const current = picked[slot]
  const keycode = current && actionToKeycode(current)
  const toggleMode = (mode: LayerMode) =>
    setLayerModes(layerModes.includes(mode) ? layerModes.filter((other) => other !== mode) : [...layerModes, mode])

  return (
    <main className="picker-preview">
      <h1>動作を選ぶ部品（見本）</h1>
      <div className="picker-row">
        <span>入れる欄</span>
        {SLOTS.map(({ id, name }) => (
          <button type="button" key={id} aria-pressed={slot === id} onClick={() => setSlot(id)}>
            {name}
          </button>
        ))}
      </div>
      <div className="picker-row">
        <span>レイヤー数</span>
        {LAYER_COUNTS.map((count) => (
          <button type="button" key={count} aria-pressed={layerCount === count} onClick={() => setLayerCount(count)}>
            {count}
          </button>
        ))}
      </div>
      <div className="picker-row">
        <span>使える切り替え方</span>
        {LAYER_MODES.map((mode) => (
          <button type="button" key={mode} aria-pressed={layerModes.includes(mode)} onClick={() => toggleMode(mode)}>
            {layerModeName(mode)}
          </button>
        ))}
      </div>
      <div className="picker-row">
        <span>刻印</span>
        {LEGENDS.map((kind) => (
          <button type="button" key={kind} aria-pressed={legend === kind} onClick={() => setLegend(kind)}>
            {kind.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="picker-preview-result" aria-live="polite">
        選ばれた動作: {current ? labelOf(current, legend).full : '（なし）'}
        {keycode !== undefined && `（キーコード ${formatKeycode(keycode)}）`}
      </p>
      <section className="picker-preview-panel">
        <ActionPicker
          slot={slot}
          slotName={SLOTS.find(({ id }) => id === slot)!.name}
          current={current}
          layerCount={layerCount}
          layerModes={layerModes}
          legend={legend}
          onPick={(action) => setPicked({ ...picked, [slot]: action })}
        />
      </section>
    </main>
  )
}
