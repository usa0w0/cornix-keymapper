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
  for (let below = layer - 1; below >= 0; below--) {
    const keycode = keycodeAt(below)
    if (keycode !== undefined && keycode !== KC_TRANSPARENT) return { layer: below, keycode }
  }
  return undefined
}
