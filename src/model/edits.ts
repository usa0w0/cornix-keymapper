// 編集（利用者が変えたものだけ）の型。編集中の状態（session/editState.ts）が持ち、
// 本体の設定への変換（encode.ts）と変更点の一覧（diff.ts）が読む。
// Tap Dance の番号と、足したコンボの枠の番号は持たない（目標を作る時に決める）
import type { Action } from './action.ts'
import type { KeyBehavior } from './behavior.ts'

/** キー1つの編集。key はキーマップの中の番号（行 × 列数 + 列） */
export interface KeyEdit {
  layer: number
  key: number
  behavior: KeyBehavior
}

/** エンコーダーの1方向の編集 */
export interface EncoderEdit {
  layer: number
  encoder: number
  direction: 'left' | 'right'
  action: Action
}

/** コンボ1つの中身。同時に押すキーは、位置ではなく、キーの中身（キーコード。2〜4個）で持つ */
export interface ComboContent {
  keys: number[]
  output: Action
}

/**
 * どのコンボか。出発点にあるコンボは、その枠の番号（slot）で指す。
 * 足したコンボは、足した順の番号（added）で指す。枠の番号ではなく、枠は目標を作る時に決める
 */
export type ComboRef = { slot: number } | { added: number }

/** コンボ1つの編集。combo が null なら、そのコンボを消す（足したコンボを消す時は、編集ごと取り除く） */
export interface ComboEdit {
  ref: ComboRef
  combo: ComboContent | null
}

/** 編集。同じ場所（キー、エンコーダーの1方向、コンボ）は1つだけ持つ */
export interface Edits {
  keys: KeyEdit[]
  encoders: EncoderEdit[]
  combos: ComboEdit[]
}

/** 編集の場所。取り消す時に使う */
export type EditPlace =
  | { kind: 'key'; layer: number; key: number }
  | { kind: 'encoder'; layer: number; encoder: number; direction: 'left' | 'right' }
  | { kind: 'combo'; ref: ComboRef }

export const EMPTY_EDITS: Edits = { keys: [], encoders: [], combos: [] }

export const isEmptyEdits = (edits: Edits) =>
  edits.keys.length === 0 && edits.encoders.length === 0 && edits.combos.length === 0

export const sameComboRef = (a: ComboRef, b: ComboRef) =>
  'slot' in a ? 'slot' in b && a.slot === b.slot : 'added' in b && a.added === b.added
