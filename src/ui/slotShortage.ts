// Tap Dance の枠が足りない時に出す、枠を使っているキーの一覧
import type { Legend } from '../model/action.ts'
import { decodeKey, TAP_DANCE } from '../model/decode.ts'
import { tapDanceUses } from '../model/encode.ts'
import { customKeycodesOf } from '../model/keycodes.ts'
import { planKeys, type EditState } from '../session/editState.ts'
import { behaviorView, placeName, slotsName } from './keyView.ts'

/** 枠1つぶんの行 */
export interface ShortageRow {
  slot: number
  /** 枠の中身（「タップ: Space ／ 長押し: 左 GUI」の形）。番号は出さない */
  name: string
  /** この枠を使っているキー。押すと、そのキーへ移る */
  keys: { layer: number; key: number; place: string }[]
  /** この枠を使っている、エンコーダーの方向とコンボの出力の数 */
  others: number
}

export interface ShortageList {
  /** 本体の枠数 */
  total: number
  rows: ShortageRow[]
  /** 中身はあるが、どこからも使われていない枠の数（まだ上書きに使っていないもの） */
  unused: number
}

/** いまの編集中の状態で、枠を使っているキーの一覧。枠の番号順 */
export function shortageList(state: EditState, legend: Legend): ShortageList {
  const { source } = state
  const plan = planKeys(state)
  const custom = customKeycodesOf(source.layout)
  const { cols } = source.layout
  const rows = tapDanceUses({ ...source, keymap: plan.keymap, encoders: plan.encoders, tapDances: plan.tapDances }).map((use): ShortageRow => {
    const behavior = decodeKey(TAP_DANCE.from + use.slot, plan.tapDances, custom)
    return {
      slot: use.slot,
      name: slotsName(behaviorView(behavior, legend).slots),
      keys: use.keys.map(({ layer, key }) => ({
        layer,
        key,
        place: placeName(layer, { row: Math.floor(key / cols), col: key % cols }),
      })),
      others: use.others,
    }
  })
  return { total: source.tapDances.length, rows, unused: plan.overwritable }
}
