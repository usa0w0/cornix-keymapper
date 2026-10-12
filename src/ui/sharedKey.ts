// 共有中のキー（同じ Tap Dance の枠を指しているキーがほかにあるキー）を変える時の、確認の出し方と、確認に出す内容
import type { KeyboardSnapshot } from '../device/types.ts'
import type { Legend } from '../model/action.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { decodeKey } from '../model/decode.ts'
import type { KeyPlace } from '../model/edits.ts'
import { customKeycodesOf } from '../model/keycodes.ts'
import { planKeys, sharedKeys, tryEditKey, type EditState } from '../session/editState.ts'
import { behaviorView, placeName, slotsName } from './keyView.ts'

/**
 * 選んでいるキーについて、覚えている答え。そのキーを選んでいる間だけ持つ（欄を1つ変えるたびに、確認を出さないため）。
 * together は、連動して変えるキー（そのキー自身を含む）。このキーだけを変えるなら null
 */
export interface SharedAnswer extends KeyPlace {
  /** 答えた時の出発点。読み直しなどで出発点が替わったら、答えは使わない */
  source: KeyboardSnapshot
  together: KeyPlace[] | null
}

/** キーの編集の進め方。only はこのキーだけ、together は keys を連動して変える、ask は keys（同じ枠を指すキー）を見せて確認する */
export type SharedDecision =
  | { kind: 'only' }
  | { kind: 'together'; keys: KeyPlace[] }
  | { kind: 'ask'; keys: KeyPlace[] }

const samePlace = (a: KeyPlace, b: KeyPlace) => a.layer === b.layer && a.key === b.key

/**
 * キーを変える前に、確認が要るかを決める。
 * - 同じ枠を指すキーがほかになければ、このキーだけを変える
 * - あれば、確認する。ただし、そのキーを選んでから1回答えていれば、同じ答えで進める
 * - 「n つとも変更」と答えた後は、その時のキーを連動して変え続ける（途中で MT などになり、枠を使わなくなっても続ける）。
 *   その時になかったキーが同じ枠を指すようになっていたら、もう一度確認する
 */
export function decideSharedEdit(state: EditState, place: KeyPlace, answer: SharedAnswer | null): SharedDecision {
  const shared = sharedKeys(state, place)
  if (answer && answer.source === state.source && samePlace(answer, place)) {
    const { together } = answer
    if (!together) return { kind: 'only' }
    if (shared.every((key) => together.some((known) => samePlace(known, key)))) return { kind: 'together', keys: together }
  }
  return shared.length > 1 ? { kind: 'ask', keys: shared } : { kind: 'only' }
}

/** 確認のダイアログに出すもの */
export interface SharedKeyList {
  /** いまの内容と、変えた後の内容（「タップ: Space ／ 長押し: 左 GUI」の形） */
  name: string
  next: string
  /** 同じ枠を指しているキー。current は、いま変えようとしているキー */
  keys: (KeyPlace & { place: string; current: boolean })[]
  /**
   * 「このキーだけ変更」を選んだ時の枠。new は枠を1つ新しく使う、short は枠が要るが足りない（選んでも、枠が足りない旨を出して止まる）、
   * none は枠が要らない（通常のキー、MT、LT になるか、同じ内容の枠がすでにある）
   */
  only: 'none' | 'new' | 'short'
  /** いまの残り枠数 */
  free: number
}

/** 同じ枠を指しているキー（keys）のうちの1つ（place）を、next に変えようとした時の、確認の内容 */
export function sharedKeyList(
  state: EditState,
  place: KeyPlace,
  keys: readonly KeyPlace[],
  next: KeyBehavior,
  legend: Legend,
): SharedKeyList {
  const { source } = state
  const plan = planKeys(state)
  const nameOf = (behavior: KeyBehavior) => slotsName(behaviorView(behavior, legend).slots) || '何もしない'
  const current = decodeKey(plan.keymap[place.layer][place.key], plan.tapDances, customKeycodesOf(source.layout))
  const { cols } = source.layout
  const alone = tryEditKey(state, place.layer, place.key, next)
  return {
    name: nameOf(current),
    next: nameOf(next),
    keys: keys.map(({ layer, key }) => ({
      layer,
      key,
      place: placeName(layer, { row: Math.floor(key / cols), col: key % cols }),
      current: samePlace({ layer, key }, place),
    })),
    only: alone.blocked ? 'short' : planKeys(alone.state).free < plan.free ? 'new' : 'none',
    free: plan.free,
  }
}
