// キーの動作（4欄）の型。キー1つは、タップ・長押し・2回タップ・タップ後長押しの4つの欄を持つ。
// 本体の設定からの変換は decode.ts が受け持つ
import type { Action } from './action.ts'

/**
 * キー1つの動作。4欄はどれも、なくてもよい。
 * 何も割り当てないキーは、タップ欄に「透過」か「何もしない」を入れる。「長押しだけ」のキーは、タップ欄を空にして表す
 */
export interface KeyBehavior {
  tap?: Action
  hold?: Action
  doubleTap?: Action
  tapHold?: Action
}

export type BehaviorSlot = keyof KeyBehavior

/** 4欄。画面に出す順 */
export const BEHAVIOR_SLOTS: readonly BehaviorSlot[] = ['tap', 'hold', 'doubleTap', 'tapHold']

/** 欄の名前 */
export const BEHAVIOR_SLOT_NAMES: Record<BehaviorSlot, string> = {
  tap: 'タップ',
  hold: '長押し',
  doubleTap: '2回タップ',
  tapHold: 'タップ後長押し',
}

/** 中身のある欄を、画面に出す順に並べる */
export const filledSlots = (slots: Partial<Record<BehaviorSlot, unknown>>): BehaviorSlot[] =>
  BEHAVIOR_SLOTS.filter((slot) => slots[slot] !== undefined)

/** 透過のキーか。「透過」はタップ欄にだけ入り、ほかの欄と組み合わせられない */
export const isTransparent = (behavior: KeyBehavior) => behavior.tap?.kind === 'transparent'

/** 何もしないキーか */
export const isNone = (behavior: KeyBehavior) => behavior.tap?.kind === 'none'

/** このサイトで扱わない動作を含むキーか。編集不可として見せる */
export const isUnsupported = (behavior: KeyBehavior) =>
  BEHAVIOR_SLOTS.some((slot) => behavior[slot]?.kind === 'unsupported')

/**
 * 欄に動作を入れた後のキーの動作。
 * 何もしないキーと透過のキーは、その欄だけのキーになる（透過のキーに動作を入れると、透過ではなくなる）。
 * 編集不可のキーも、その欄だけのキーになる（別の動作での上書き。ほかの欄の内容は残さない）
 */
export function withSlot(behavior: KeyBehavior, slot: BehaviorSlot, action: Action): KeyBehavior {
  const base = isNone(behavior) || isTransparent(behavior) || isUnsupported(behavior) ? {} : behavior
  return { ...base, [slot]: action }
}

/** 欄を消した後のキーの動作。4つとも空になったら、何もしないキー */
export function withoutSlot(behavior: KeyBehavior, slot: BehaviorSlot): KeyBehavior {
  const rest = { ...behavior }
  delete rest[slot]
  return filledSlots(rest).length > 0 ? rest : { tap: { kind: 'none' } }
}
