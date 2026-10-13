// キーボード図に出す、キー1つぶんの見え方を、本体から読んだ設定から作る
import type { KeyboardSnapshot } from '../device/types.ts'
import { labelOf, type ActionLabel, type Legend } from '../model/action.ts'
import { customKeycodesOf, keycodeToAction, KC_TRANSPARENT, type CustomKeycode } from '../model/keycodes.ts'
import type { PlacedKey } from '../model/layout.ts'
import { effectiveBelow } from '../model/transparent.ts'

/** 図の上の場所1つ。キーか、エンコーダーの1方向 */
export type KeyTarget =
  | { kind: 'key'; index: number }
  | { kind: 'encoder'; encoder: number; direction: 'left' | 'right' }

/** 空（何もしない）、透過、編集不可（このサイトで扱わないキーコード）、それ以外 */
export type KeyState = 'normal' | 'none' | 'transparent' | 'locked'

export interface KeyView {
  state: KeyState
  label: ActionLabel
  /** 透過キーで、下のレイヤーで実際に効く動作。レイヤー 0 まですべて透過なら、ない */
  inherited?: { layer: number; state: KeyState; label: ActionLabel }
}

export const targetOf = (key: PlacedKey): KeyTarget =>
  key.kind === 'key'
    ? { kind: 'key', index: key.index }
    : { kind: 'encoder', encoder: key.encoder, direction: key.direction }

/** 場所を表す文字列。React の key に使う */
export const targetId = (target: KeyTarget) =>
  target.kind === 'key' ? `k${target.index}` : `e${target.encoder}-${target.direction}`

/** その場所の、そのレイヤーでのキーコード。本体から読んだ設定にない場所は undefined */
export function keycodeAt(snapshot: KeyboardSnapshot, layer: number, target: KeyTarget): number | undefined {
  if (target.kind === 'key') return snapshot.keymap[layer]?.[target.index]
  return snapshot.encoders[layer]?.[target.encoder]?.[target.direction === 'left' ? 0 : 1]
}

function describe(keycode: number, custom: readonly CustomKeycode[], legend: Legend) {
  const action = keycodeToAction(keycode, custom)
  const state: KeyState =
    action.kind === 'none'
      ? 'none'
      : action.kind === 'transparent'
        ? 'transparent'
        : action.kind === 'unsupported'
          ? 'locked'
          : 'normal'
  return { state, label: labelOf(action, legend) }
}

/**
 * その場所の見え方。この時点では、キーコード1つを動作1つとして出す
 * （MT、LT、Tap Dance を4欄に展開するまでは、キーコードの label を出す）
 */
export function keyViewOf(
  snapshot: KeyboardSnapshot,
  layer: number,
  target: KeyTarget,
  legend: Legend,
  custom: readonly CustomKeycode[] = customKeycodesOf(snapshot.layout),
): KeyView {
  const view = describe(keycodeAt(snapshot, layer, target) ?? 0, custom, legend)
  if (view.state !== 'transparent') return view
  const below = effectiveBelow(layer, (lower) => keycodeAt(snapshot, lower, target))
  return below ? { ...view, inherited: { layer: below.layer, ...describe(below.keycode, custom, legend) } } : view
}

/** キーが1つも割り当てられていないレイヤーか。図に出るキーが、すべて「何もしない」か透過の時 */
export function isLayerEmpty(snapshot: KeyboardSnapshot, layer: number, keys: readonly PlacedKey[]): boolean {
  return keys
    .filter((key) => key.kind === 'key')
    .every((key) => {
      const keycode = keycodeAt(snapshot, layer, targetOf(key)) ?? 0
      return keycode === 0 || keycode === KC_TRANSPARENT
    })
}

/** キーの幅に大きな字で収まらない表示か。全角の字は2つぶんに数える */
export function isLong(text: string): boolean {
  let width = 0
  for (const char of text) width += char.charCodeAt(0) > 0xff ? 2 : 1
  return width > 5
}

/** 図の上の場所の名前。読み上げと、マウスを載せた時の説明に使う */
export function targetName(key: PlacedKey): string {
  if (key.kind === 'encoder') return `エンコーダー ${key.encoder + 1} の${key.direction === 'left' ? '左回し' : '右回し'}`
  return `行 ${key.row}・列 ${key.col} のキー`
}
