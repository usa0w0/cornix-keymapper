// Vial のキーコード（数値）と動作（Action）の相互変換。
// 番号の体系は QMK 版 Vial（Vial の版 6）と同じ（docs/design.md「実機で確かめること」の 6）。
//
// 扱うのは「キーコード1つ = 動作1つ」の変換だけ。MT、LT、Tap Dance のように、1つのキーコードが
// 複数の欄（タップと長押しなど）を持つものは、ここでは unsupported になる。欄への展開は decode.ts が受け持つ
import type { LayoutDefinition } from '../device/types.ts'
import { formatKeycode, isKeyCode, MOD_KINDS, type Action, type LayerMode, type Mod } from './action.ts'

const KC_NO = 0x0000
const KC_TRANSPARENT = 0x0001
/** 修飾キーそのもののキーコード。左の Ctrl・Shift・Alt・GUI、右の Ctrl・Shift・Alt・GUI の順 */
const MODIFIER_KEYS = 0x00e0
/** 修飾キー付きのキー。下位 8 ビットがキー、その上の 4 ビットが修飾の種類、さらに上の 1 ビットが右側 */
const MODDED_KEYS = { from: 0x0100, to: 0x1fff }
const RIGHT_SIDE = 0x10

/** レイヤー切り替え。先頭の番号 + レイヤー（0〜31） */
const LAYER_BASES: Record<LayerMode, number> = {
  to: 0x5200,
  momentary: 0x5220,
  toggle: 0x5260,
  oneShot: 0x5280,
}
const LAYER_LIMIT = 32

/** 修飾の 5 ビット（Ctrl・Shift・Alt・GUI と、右側の印）を、修飾キーの組に直す */
export function modsFromBits(bits: number): Mod[] {
  const side = bits & RIGHT_SIDE ? 'right' : 'left'
  return MOD_KINDS.filter((_, i) => bits & (1 << i)).map((kind) => ({ kind, side }))
}

/**
 * 修飾キーの組を、修飾の 5 ビットに直す。
 * 左右が混ざった組と、同じ種類が重なった組は、1つのキーコードでは表せないので undefined
 */
export function modsToBits(mods: readonly Mod[]): number | undefined {
  if (mods.length === 0) return 0
  const side = mods[0].side
  let bits = side === 'right' ? RIGHT_SIDE : 0
  for (const mod of mods) {
    const bit = 1 << MOD_KINDS.indexOf(mod.kind)
    if (mod.side !== side || bits & bit) return undefined
    bits |= bit
  }
  return bits
}

/** 本体のレイアウト定義に含まれる、独自のキー（Bluetooth の切替など）の名前 */
export interface CustomKeycode {
  name?: string
}

/** レイアウト定義から、独自のキーの一覧を取り出す。本体から来る値なので、形が違えば空にする */
export function customKeycodesOf(layout: LayoutDefinition): CustomKeycode[] {
  const list = (layout.raw as { customKeycodes?: unknown } | null)?.customKeycodes
  if (!Array.isArray(list)) return []
  return list.map((entry: unknown) => {
    const name = (entry as { name?: unknown } | null)?.name
    return typeof name === 'string' ? { name } : {}
  })
}

// 対象外の機能のうち、名前を付けて見せるもの。[先頭, 個数, 表示]
const UNSUPPORTED_RANGES: [number, number, (index: number, custom: readonly CustomKeycode[]) => string][] = [
  [0x5240, 32, (n) => `DF(${n})`],
  [0x52c0, 32, (n) => `TT(${n})`],
  [0x5700, 256, (n) => `Tap Dance ${n}`],
  [0x7700, 128, (n) => `マクロ ${n}`],
  [0x7e00, 64, (n, custom) => custom[n]?.name ?? `USER${String(n).padStart(2, '0')}`],
]

function unsupported(raw: number, custom: readonly CustomKeycode[]): Action {
  const found = UNSUPPORTED_RANGES.find(([from, count]) => raw >= from && raw < from + count)
  return { kind: 'unsupported', raw, label: found ? found[2](raw - found[0], custom) : formatKeycode(raw) }
}

/**
 * キーコード1つを動作に直す。対象外の機能と解釈できないキーコードは、元の値を持った unsupported にする。
 *
 * 同じ動作を表すキーコードが複数ある時は、actionToKeycode が作る形だけを動作に直し、残りは unsupported にする
 * （数値 → Action → 数値 が必ず元に戻るように）
 */
export function keycodeToAction(keycode: number, customKeycodes: readonly CustomKeycode[] = []): Action {
  if (keycode === KC_NO) return { kind: 'none' }
  if (keycode === KC_TRANSPARENT) return { kind: 'transparent' }
  if (isKeyCode(keycode)) return { kind: 'key', code: keycode, mods: [] }
  if (keycode >= MODIFIER_KEYS && keycode < MODIFIER_KEYS + 8) {
    const index = keycode - MODIFIER_KEYS
    return { kind: 'key', mods: [{ kind: MOD_KINDS[index % 4], side: index < 4 ? 'left' : 'right' }] }
  }
  if (keycode >= MODDED_KEYS.from && keycode <= MODDED_KEYS.to) {
    const mods = modsFromBits(keycode >> 8)
    const code = keycode & 0xff
    // キーの部分が 0 のものは、修飾キーだけの動作。1つだけなら修飾キーそのもののキーコードを使うので、2つ以上の時だけ
    if (code === KC_NO && mods.length >= 2) return { kind: 'key', mods }
    if (isKeyCode(code) && mods.length >= 1) return { kind: 'key', code, mods }
    return unsupported(keycode, customKeycodes)
  }
  for (const [mode, base] of Object.entries(LAYER_BASES) as [LayerMode, number][]) {
    if (keycode >= base && keycode < base + LAYER_LIMIT) return { kind: 'layer', mode, layer: keycode - base }
  }
  return unsupported(keycode, customKeycodes)
}

/**
 * 動作1つをキーコードに直す。unsupported は元の値を返す。
 * キーコード1つで表せない動作（左右が混ざった修飾キーの組、表にないキー、範囲外のレイヤー）は undefined
 */
export function actionToKeycode(action: Action): number | undefined {
  switch (action.kind) {
    case 'none':
      return KC_NO
    case 'transparent':
      return KC_TRANSPARENT
    case 'unsupported':
      return action.raw
    case 'layer': {
      const { layer } = action
      return Number.isInteger(layer) && layer >= 0 && layer < LAYER_LIMIT ? LAYER_BASES[action.mode] + layer : undefined
    }
    case 'key': {
      const { code, mods } = action
      const bits = modsToBits(mods)
      if (bits === undefined) return undefined
      if (code !== undefined) return isKeyCode(code) ? (bits << 8) | code : undefined
      if (mods.length === 0) return undefined
      if (mods.length === 1) return MODIFIER_KEYS + MOD_KINDS.indexOf(mods[0].kind) + (bits & RIGHT_SIDE ? 4 : 0)
      return bits << 8
    }
  }
}
