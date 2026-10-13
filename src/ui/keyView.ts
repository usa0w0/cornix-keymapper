// キーボード図に出す、キー1つぶんの見え方を、本体から読んだ設定と、利用者の編集から作る
import type { CSSProperties } from 'react'
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
import { EMPTY_EDITS, type Edits } from '../model/edits.ts'
import { customKeycodesOf, keycodeToAction, type CustomKeycode } from '../model/keycodes.ts'
import type { Bounds, PlacedKey } from '../model/layout.ts'
import { firstBelow } from '../model/transparent.ts'

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

/** その場所の編集。編集していなければ undefined。編集できるのは、キーだけ（エンコーダーは #12） */
const keyEditAt = (edits: Edits, layer: number, target: KeyTarget) =>
  target.kind === 'key' ? edits.keys.find((edit) => edit.layer === layer && edit.key === target.index) : undefined

/** その場所を、利用者が変えているか */
export const isChanged = (edits: Edits, layer: number, target: KeyTarget) => keyEditAt(edits, layer, target) !== undefined

/**
 * その場所の、編集を当てはめた後の動作。本体から読んだ設定にない場所は undefined。
 * キーは4欄に展開する（MT、LT、Tap Dance は、タップと長押しなどに分かれる）。
 * エンコーダーは動作1つなので、展開せずに、その動作をタップ欄に入れて出す
 */
export function behaviorAt(
  snapshot: KeyboardSnapshot,
  layer: number,
  target: KeyTarget,
  custom: readonly CustomKeycode[] = customKeycodesOf(snapshot.layout),
  edits: Edits = EMPTY_EDITS,
): KeyBehavior | undefined {
  const keycode = keycodeAt(snapshot, layer, target)
  if (keycode === undefined) return undefined
  const edit = keyEditAt(edits, layer, target)
  if (edit) return edit.behavior
  return target.kind === 'key' ? decodeKey(keycode, snapshot.tapDances, custom) : { tap: keycodeToAction(keycode, custom) }
}

/**
 * その場所の見え方。edits を渡すと、編集を当てはめた後の内容を出す。
 * 透過キーには、下のレイヤーで実際に効く動作（編集を当てはめた後の4欄）を添える
 */
export function keyViewOf(
  snapshot: KeyboardSnapshot,
  layer: number,
  target: KeyTarget,
  legend: Legend,
  custom: readonly CustomKeycode[] = customKeycodesOf(snapshot.layout),
  edits: Edits = EMPTY_EDITS,
): KeyView {
  const at = (where: number) => behaviorAt(snapshot, where, target, custom, edits)
  const view = behaviorView(at(layer) ?? { tap: { kind: 'none' } }, legend)
  if (view.state !== 'transparent') return view
  const below = firstBelow(layer, at, isTransparent)
  return below ? { ...view, inherited: { layer: below.layer, ...behaviorView(below.value, legend) } } : view
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
export function isLayerEmpty(
  snapshot: KeyboardSnapshot,
  layer: number,
  keys: readonly PlacedKey[],
  edits: Edits = EMPTY_EDITS,
): boolean {
  return keys
    .filter((key) => key.kind === 'key')
    .every((key) => {
      const behavior = behaviorAt(snapshot, layer, targetOf(key), [], edits)
      return !behavior || isNone(behavior) || isTransparent(behavior)
    })
}

/** キーの幅に大きな字で収まらない表示か。全角の字は2つぶんに数える */
export function isLong(text: string): boolean {
  let width = 0
  for (const char of text) width += char.charCodeAt(0) > 0xff ? 2 : 1
  return width > 5
}

/** 図の上の場所の名前。読み上げと、マウスを載せた時の説明に使う */
/** キーの場所の名前。編集欄と、枠を使っているキーの一覧に出す */
export const placeName = (layer: number, key: { row: number; col: number }) =>
  `レイヤー ${layer} ・ 行 ${key.row} 列 ${key.col}`

export function targetName(key: PlacedKey): string {
  if (key.kind === 'encoder') return `エンコーダー ${key.encoder + 1} の${key.direction === 'left' ? '左回し' : '右回し'}`
  return `行 ${key.row}・列 ${key.col} のキー`
}

/**
 * 図の中での、キーの置き場所。unit はキー1つぶんの大きさ、gap はキーどうしのすき間（px）。
 * 渡すと、その大きさの図にする（共有中のキーの確認に出す、小さな図）
 */
export function placeOf(key: PlacedKey, box: Bounds, unit = 64, gap = 4): CSSProperties {
  return {
    left: (key.x - box.minX) * unit,
    top: (key.y - box.minY) * unit,
    width: key.w * unit - gap,
    height: key.h * unit - gap,
    transform: key.r ? `rotate(${key.r}deg)` : undefined,
    transformOrigin: `${(key.rx - key.x) * unit}px ${(key.ry - key.y) * unit}px`,
  }
}
