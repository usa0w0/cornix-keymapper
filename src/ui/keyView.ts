// キーボード図に出す、キー1つぶんの見え方を、本体から読んだ設定から作る
import type { KeyboardSnapshot } from '../device/types.ts'
import { labelOf, type ActionLabel, type Legend } from '../model/action.ts'
import {
  BEHAVIOR_SLOT_NAMES,
  filledSlots,
  isNone,
  isTransparent,
  isUnsupported,
  type BehaviorSlot,
  type KeyBehavior,
} from '../model/behavior.ts'
import { decodeKey } from '../model/decode.ts'
import { customKeycodesOf, keycodeToAction, type CustomKeycode } from '../model/keycodes.ts'
import type { PlacedKey } from '../model/layout.ts'
import { effectiveBelow } from '../model/transparent.ts'

/** 図の上の場所1つ。キーか、エンコーダーの1方向 */
export type KeyTarget =
  | { kind: 'key'; index: number }
  | { kind: 'encoder'; encoder: number; direction: 'left' | 'right' }

/** 空（何もしない）、透過、編集不可（このサイトで扱わないキーコード）、それ以外 */
export type KeyState = 'normal' | 'none' | 'transparent' | 'locked'

/** 欄ごとの表示名。中身のある欄だけを持つ */
export type SlotLabels = Partial<Record<BehaviorSlot, ActionLabel>>

export interface KeyView {
  state: KeyState
  slots: SlotLabels
  /** 透過キーで、下のレイヤーで実際に効く動作。レイヤー 0 まですべて透過なら、ない */
  inherited?: { layer: number; state: KeyState; slots: SlotLabels }
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

/** キーの動作（4欄）の見え方 */
export function behaviorView(behavior: KeyBehavior, legend: Legend): { state: KeyState; slots: SlotLabels } {
  const state: KeyState = isNone(behavior)
    ? 'none'
    : isTransparent(behavior)
      ? 'transparent'
      : isUnsupported(behavior)
        ? 'locked'
        : 'normal'
  const slots: SlotLabels = {}
  for (const slot of filledSlots(behavior)) slots[slot] = labelOf(behavior[slot]!, legend)
  return { state, slots }
}

/**
 * その場所の、キーコード1つの見え方。キーは4欄に展開する（MT、LT、Tap Dance は、タップと長押しなどに分かれる）。
 * エンコーダーは動作1つなので、展開せずに、その動作をタップ欄に入れて出す
 */
function describe(snapshot: KeyboardSnapshot, target: KeyTarget, keycode: number, custom: readonly CustomKeycode[], legend: Legend) {
  const behavior =
    target.kind === 'key' ? decodeKey(keycode, snapshot.tapDances, custom) : { tap: keycodeToAction(keycode, custom) }
  return behaviorView(behavior, legend)
}

/** その場所の見え方。透過キーには、下のレイヤーで実際に効く動作（展開した後の4欄）を添える */
export function keyViewOf(
  snapshot: KeyboardSnapshot,
  layer: number,
  target: KeyTarget,
  legend: Legend,
  custom: readonly CustomKeycode[] = customKeycodesOf(snapshot.layout),
): KeyView {
  const view = describe(snapshot, target, keycodeAt(snapshot, layer, target) ?? 0, custom, legend)
  if (view.state !== 'transparent') return view
  const below = effectiveBelow(layer, (lower) => keycodeAt(snapshot, lower, target))
  return below
    ? { ...view, inherited: { layer: below.layer, ...describe(snapshot, target, below.keycode, custom, legend) } }
    : view
}

/**
 * 省略しない名前。読み上げと、マウスを載せた時の説明に使う。
 * タップだけなら動作の名前、ほかの欄があれば「タップ: Space ／ 長押し: 左 GUI」の形
 */
export function slotsName(slots: SlotLabels): string {
  const filled = filledSlots(slots)
  if (filled.length === 1 && filled[0] === 'tap') return slots.tap!.full
  return filled.map((slot) => `${BEHAVIOR_SLOT_NAMES[slot]}: ${slots[slot]!.full}`).join(' ／ ')
}

/**
 * キーが1つも割り当てられていないレイヤーか。図に出るキーが、すべて「何もしない」か透過の時。
 * 図の見え方と合わせるため、欄に展開した後の動作で見る（4つとも空の枠を指す Tap Dance も、何もしないキー）
 */
export function isLayerEmpty(snapshot: KeyboardSnapshot, layer: number, keys: readonly PlacedKey[]): boolean {
  return keys
    .filter((key) => key.kind === 'key')
    .every((key) => {
      const behavior = decodeKey(keycodeAt(snapshot, layer, targetOf(key)) ?? 0, snapshot.tapDances)
      return isNone(behavior) || isTransparent(behavior)
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
