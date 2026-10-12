// コンボのタブに出すものを、編集を当てはめた後の内容から作る。
// コンボは、位置ではなく、キーの中身（本体のキーコード）で決まる（docs/design.md「コンボ」）
import { canPlace, type Action, type Legend } from '../model/action.ts'
import { filledSlots } from '../model/behavior.ts'
import { decodeKey, TAP_DANCE } from '../model/decode.ts'
import { COMBO_KEYS, comboKeycode, encodeComboOutput, type KeyEditPlan } from '../model/encode.ts'
import type { ComboContent, ComboKey, ComboRef } from '../model/edits.ts'
import type { CustomKeycode } from '../model/keycodes.ts'
import { behaviorView, slotsName } from './keyView.ts'

/** 追加中、または変更中のコンボ。ref が null なら、追加中 */
export interface ComboDraft {
  ref: ComboRef | null
  keys: ComboKey[]
  /** 出す動作。まだ選んでいなければ、ない */
  output?: Action
}

/**
 * コンボのキー1つの名前。short は、いちばん上の欄の動作（ほかの欄があれば「ほか」を添える）。full は、省略しない名前。
 * Tap Dance を指すキーコードは、編集を当てはめた後の枠の中身で出す
 */
export function comboKeyName(
  key: ComboKey,
  plan: Pick<KeyEditPlan, 'tapDances'>,
  custom: readonly CustomKeycode[],
  legend: Legend,
): { short: string; full: string } {
  const behavior =
    typeof key === 'number'
      ? decodeKey(key, plan.tapDances, custom)
      : decodeKey(TAP_DANCE.from, [{ ...key.tapDance, tappingTerm: 0 }], custom)
  const { slots } = behaviorView(behavior, legend)
  const [main, ...others] = filledSlots(slots).filter((slot) => slots[slot]!.short !== '')
  if (!main) return { short: '（空）', full: '（空）' }
  return { short: slots[main]!.short + (others.length > 0 ? ' ほか' : ''), full: slotsName(slots) }
}

/**
 * そのレイヤーのキーが、コンボの何番目のキーに当たるか（0 から）。当たらなければ undefined。
 * keycodes は、コンボの同時に押すキーのキーコード。同じ中身のキーがレイヤーに複数あれば、どれも当たる
 */
export function comboOrderAt(
  keycodes: readonly (number | undefined)[],
  plan: Pick<KeyEditPlan, 'keymap'>,
  layer: number,
  key: number,
): number | undefined {
  const keycode = plan.keymap[layer]?.[key]
  if (!keycode) return undefined
  const order = keycodes.indexOf(keycode)
  return order < 0 ? undefined : order
}

/** そのレイヤーに、同じ中身のキーがない、コンボのキーの番号（combo.keys の中の位置）。空なら、そのレイヤーで働く */
export function missingComboKeys(
  keycodes: readonly (number | undefined)[],
  plan: Pick<KeyEditPlan, 'keymap'>,
  layer: number,
): number[] {
  const present = new Set(plan.keymap[layer] ?? [])
  return keycodes.flatMap((keycode, index) => (keycode !== undefined && present.has(keycode) ? [] : [index]))
}

/**
 * 図でキーを押した時の、同時に押すキーの組。もう入っている中身のキーなら外し、なければ最後に足す（4個まで）。
 * 同じ中身かは、編集を当てはめた後のキーコードで比べる
 */
export function toggleComboKey(keys: readonly ComboKey[], key: ComboKey, plan: Pick<KeyEditPlan, 'tapDanceSlots'>): ComboKey[] {
  const keycode = comboKeycode(plan, key)
  const at = keys.findIndex((item) => comboKeycode(plan, item) === keycode)
  if (at >= 0) return keys.filter((_, index) => index !== at)
  return keys.length < COMBO_KEYS.max ? [...keys, key] : [...keys]
}

/** 出す動作が、このサイトで選べない動作か（本体から読んだ Tap Dance、マクロなど）。内容は保ち、別の動作で上書きはできる */
export const isLockedOutput = (output: Action) => !canPlace(output, 'combo')

/** 追加・変更できる中身になっているか。なっていれば、そのコンボ */
export function draftContent(draft: ComboDraft): ComboContent | undefined {
  const { keys, output } = draft
  if (keys.length < COMBO_KEYS.min || keys.length > COMBO_KEYS.max) return undefined
  return output && encodeComboOutput(output) !== undefined ? { keys, output } : undefined
}

/** 止められた追加・変更の理由 */
export function blockedReason(blocked: Pick<KeyEditPlan, 'missingCombos' | 'missing'>, total: number): string {
  if (blocked.missingCombos > 0) return `コンボの枠が足りません（本体の枠は ${total} 個）。ほかのコンボを削除してから、追加してください。`
  if (blocked.missing > 0) return 'Tap Dance の枠が足りないので、このキーの組み合わせでは追加できません。'
  return 'このコンボは、本体の設定に直せません。同時に押すキーと、出す動作を選び直してください。'
}
