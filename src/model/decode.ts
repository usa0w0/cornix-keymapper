// 本体の設定（キーコードと Tap Dance の枠）を、キーの動作（4欄）に直す。
// この変換は、画面に出すためだけに使う。編集していないキーは、読んだキーコードのまま書くので、ここを通らない
import type { TapDanceEntry } from '../device/types.ts'
import { formatKeycode, isKeyCode, type Action } from './action.ts'
import type { KeyBehavior } from './behavior.ts'
import { KC_TRANSPARENT, keycodeToAction, modsFromBits, type CustomKeycode } from './keycodes.ts'

const KC_NO = 0x0000
/** MT（タップでキー、長押しで修飾キー）。下位 8 ビットがキー、その上の 5 ビットが修飾 */
const MOD_TAP = { from: 0x2000, to: 0x3fff }
/** LT（タップでキー、長押しでレイヤー）。下位 8 ビットがキー、その上の 4 ビットがレイヤー（0〜15） */
const LAYER_TAP = { from: 0x4000, to: 0x4fff }
/** Tap Dance。先頭の番号 + 枠の番号 */
const TAP_DANCE = { from: 0x5700, count: 256 }

/** MT と LT のタップ側。修飾なしの基本キーだけを動作に直す */
function tapKeyOf(keycode: number): Action | undefined {
  const code = keycode & 0xff
  return isKeyCode(code) ? { kind: 'key', code, mods: [] } : undefined
}

function decodeModTap(keycode: number): KeyBehavior | undefined {
  const tap = tapKeyOf(keycode)
  const mods = modsFromBits((keycode >> 8) & 0x1f)
  return tap && mods.length > 0 ? { tap, hold: { kind: 'key', mods } } : undefined
}

function decodeLayerTap(keycode: number): KeyBehavior | undefined {
  const tap = tapKeyOf(keycode)
  return tap ? { tap, hold: { kind: 'layer', mode: 'momentary', layer: (keycode >> 8) & 0x0f } } : undefined
}

/**
 * Tap Dance の枠の値1つを、欄の動作に直す。0 は、その欄が空。
 * 透過は、枠の中では下のレイヤーの動作にならないので、このサイトで扱わない値として残す
 */
function fieldOf(keycode: number, custom: readonly CustomKeycode[]): Action | undefined {
  if (keycode === KC_NO) return undefined
  if (keycode === KC_TRANSPARENT) return { kind: 'unsupported', raw: keycode, label: formatKeycode(keycode) }
  return keycodeToAction(keycode, custom)
}

function decodeTapDance(entry: TapDanceEntry, custom: readonly CustomKeycode[]): KeyBehavior {
  const behavior: KeyBehavior = {}
  const tap = fieldOf(entry.onTap, custom)
  const hold = fieldOf(entry.onHold, custom)
  const doubleTap = fieldOf(entry.onDoubleTap, custom)
  const tapHold = fieldOf(entry.onTapHold, custom)
  if (tap) behavior.tap = tap
  if (hold) behavior.hold = hold
  if (doubleTap) behavior.doubleTap = doubleTap
  if (tapHold) behavior.tapHold = tapHold
  // 4つとも空の枠を指すキーは、押しても何も起きない
  return tap || hold || doubleTap || tapHold ? behavior : { tap: { kind: 'none' } }
}

/**
 * キーのキーコード1つを、キーの動作（4欄）に直す。
 *
 * - MO は長押し欄、TG・TO・OSL はタップ欄のレイヤー切り替え
 * - MT と LT は、タップ欄と長押し欄
 * - Tap Dance は、指している枠の4つの値を4欄に
 * - 対象外の機能と解釈できないキーコードは、タップ欄の unsupported（元の値を保つ）。
 *   本体にない枠を指す Tap Dance と、タップ側が表にないキーの MT・LT も同じ
 */
export function decodeKey(
  keycode: number,
  tapDances: readonly TapDanceEntry[],
  customKeycodes: readonly CustomKeycode[] = [],
): KeyBehavior {
  if (keycode >= TAP_DANCE.from && keycode < TAP_DANCE.from + TAP_DANCE.count) {
    const entry = tapDances[keycode - TAP_DANCE.from]
    if (entry) return decodeTapDance(entry, customKeycodes)
  }
  const expanded =
    keycode >= MOD_TAP.from && keycode <= MOD_TAP.to
      ? decodeModTap(keycode)
      : keycode >= LAYER_TAP.from && keycode <= LAYER_TAP.to
        ? decodeLayerTap(keycode)
        : undefined
  if (expanded) return expanded
  const action = keycodeToAction(keycode, customKeycodes)
  return action.kind === 'layer' && action.mode === 'momentary' ? { hold: action } : { tap: action }
}
