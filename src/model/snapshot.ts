// スナップショット（本体の設定を、本体の表現のままでまとめたもの）の比較と、形の確かめ
import type { ComboEntry, KeyboardSnapshot, TapDanceEntry } from '../device/types.ts'

/** 中身が同じか。値のない項目（undefined）は、ない項目と同じに扱う */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>]
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => sameValue(left[key], right[key]))
}

/** 2つのスナップショットが、機器の識別・レイアウト定義・枠数も含めて、すべて同じか */
export const sameSnapshot = (a: KeyboardSnapshot, b: KeyboardSnapshot) => sameValue(a, b)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// キーコードと数は、0 以上の整数。JSON に通すと数でなくなる値（NaN など）も、ここで外れる
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

const isListOf = <T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.every(isItem)

const isCounts = (value: unknown): value is number[] => isListOf(value, isCount)

const hasCounts = (value: unknown, names: readonly string[]): value is Record<string, unknown> =>
  isRecord(value) && names.every((name) => isCount(value[name]))

const isTapDance = (value: unknown): value is TapDanceEntry =>
  hasCounts(value, ['onTap', 'onHold', 'onDoubleTap', 'onTapHold', 'tappingTerm'])

const isCombo = (value: unknown): value is ComboEntry =>
  hasCounts(value, ['output']) && isCounts(value.keys) && value.keys.length === 4

const isEncoderLayer = (value: unknown): value is [number, number][] =>
  isListOf(value, (pair): pair is [number, number] => isCounts(pair) && pair.length === 2)

/**
 * 保存しておいたもの（ブラウザー内のバックアップなど）が、スナップショットの形をしているか。
 * 見るのは形と、数（レイヤー、キー、エンコーダー、枠）が capabilities と layout に合っていること。
 * レイアウト定義の中身（raw）は、本体から読んだものをそのまま持つので、あることだけを見る
 */
export function isKeyboardSnapshot(value: unknown): value is KeyboardSnapshot {
  if (!isRecord(value) || typeof value.uid !== 'string') return false
  const { layout, capabilities, keymap, encoders, tapDances, combos } = value
  if (!hasCounts(layout, ['rows', 'cols', 'encoderCount']) || layout.raw === undefined) return false
  if (!hasCounts(capabilities, ['viaProtocol', 'vialProtocol', 'layerCount', 'tapDanceCount', 'comboCount'])) return false
  if (!isListOf(keymap, isCounts) || !isListOf(encoders, isEncoderLayer)) return false
  if (!isListOf(tapDances, isTapDance) || !isListOf(combos, isCombo)) return false

  const keyCount = (layout.rows as number) * (layout.cols as number)
  return (
    keymap.length === capabilities.layerCount &&
    keymap.every((layer) => layer.length === keyCount) &&
    encoders.length === capabilities.layerCount &&
    encoders.every((layer) => layer.length === layout.encoderCount) &&
    tapDances.length === capabilities.tapDanceCount &&
    combos.length === capabilities.comboCount
  )
}
