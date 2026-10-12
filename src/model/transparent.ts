// 透過キーで実際に効く動作の解決
import { KC_TRANSPARENT } from './keycodes.ts'

/** 透過キーで実際に効くキーコードと、それが割り当てられているレイヤー */
export interface EffectiveKeycode {
  layer: number
  keycode: number
}

/**
 * 透過キーで実際に効くキーコードを探す。1つ下のレイヤーから順にレイヤー 0 までたどり、
 * 最初に見つかった透過でないキーコードを返す。レイヤー 0 まですべて透過なら undefined。
 *
 * どのレイヤーが有効かは使っている時の切り替えで変わるので、下のレイヤーがすべて有効な場合の結果である。
 * keycodeAt は、同じ場所（キー、またはエンコーダーの1方向）の、そのレイヤーでのキーコードを返す
 */
export function effectiveBelow(
  layer: number,
  keycodeAt: (layer: number) => number | undefined,
): EffectiveKeycode | undefined {
  const found = firstBelow(layer, keycodeAt, (keycode) => keycode === KC_TRANSPARENT)
  return found && { layer: found.layer, keycode: found.value }
}

/**
 * effectiveBelow と同じたどり方を、キーコード以外の値（編集を当てはめた後のキーの動作など）で行う。
 * valueAt は、同じ場所の、そのレイヤーでの値を返す（その場所がなければ undefined）
 */
export function firstBelow<T>(
  layer: number,
  valueAt: (layer: number) => T | undefined,
  isTransparent: (value: T) => boolean,
): { layer: number; value: T } | undefined {
  for (let below = layer - 1; below >= 0; below--) {
    const value = valueAt(below)
    if (value !== undefined && !isTransparent(value)) return { layer: below, value }
  }
  return undefined
}
