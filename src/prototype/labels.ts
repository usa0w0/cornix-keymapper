// 試作用。キーコードを、キーの上に出す短い表示と、編集欄に出す日本語の名前に直す。
// 本実装では model/keycodes.ts と model/action.ts（#6）が受け持つ
import type { KeyboardSnapshot } from '../device/types.ts'

export interface Label {
  /** キーの上に出す短い表示 */
  short: string
  /** キーの上で、short の下に添える小さな説明（レイヤー切替の方式など） */
  note?: string
  /** 編集欄に出す名前 */
  full: string
  /** Shift を押しながら打った時に出る字（数字と記号のキー。US 配列） */
  shifted?: string
}

export type Slot = 'tap' | 'hold' | 'doubleTap' | 'tapHold'

export const SLOT_NAMES: Record<Slot, string> = {
  tap: 'タップ',
  hold: '長押し',
  doubleTap: '2回タップ',
  tapHold: 'タップ後長押し',
}

export interface KeyView {
  state: 'normal' | 'none' | 'transparent' | 'locked'
  slots: Partial<Record<Slot, Label>>
  /** 透過キーで、実際に効く下のレイヤーの表示 */
  inherited?: KeyView
}

const BASIC: Record<number, [string, string?]> = {
  40: ['Enter'], 41: ['Esc'], 42: ['BS', 'Backspace'], 43: ['Tab'], 44: ['Space'],
  45: ['-'], 46: ['='], 47: ['['], 48: [']'], 49: ['\\'], 51: [';'], 52: ["'"], 53: ['`'],
  54: [','], 55: ['.'], 56: ['/'], 57: ['Caps', 'Caps Lock'], 70: ['PrtSc', 'Print Screen'],
  73: ['Ins', 'Insert'], 74: ['Home'], 75: ['PgUp', 'Page Up'], 76: ['Del', 'Delete'], 77: ['End'],
  78: ['PgDn', 'Page Down'], 79: ['→'], 80: ['←'], 81: ['↓'], 82: ['↑'],
  144: ['かな', 'かな（LANG1）'], 145: ['英数', '英数（LANG2）'],
  168: ['消音'], 169: ['音量＋', '音量を上げる'], 170: ['音量−', '音量を下げる'],
  211: ['中クリック', 'マウスの中ボタン'], 217: ['ホイール↑', 'マウスのホイールを上へ'], 218: ['ホイール↓', 'マウスのホイールを下へ'],
  224: ['Ctrl', '左 Ctrl'], 225: ['Shift', '左 Shift'], 226: ['Alt', '左 Alt'], 227: ['GUI', '左 GUI（Cmd / Win）'],
  228: ['Ctrl', '右 Ctrl'], 229: ['Shift', '右 Shift'], 230: ['Alt', '右 Alt'], 231: ['GUI', '右 GUI（Cmd / Win）'],
}

/** キーの刻印を、どの配列で表すか。本体に書く内容は変わらず、見え方だけが変わる */
export type Legend = 'us' | 'jis'

// 接続先の OS が JIS 配列の時に、同じキーコードで出る字。[そのまま, Shift を押しながら]
const JIS: Record<number, [string, string?]> = {
  31: ['2', '"'], 35: ['6', '&'], 36: ['7', "'"], 37: ['8', '('], 38: ['9', ')'], 39: ['0'],
  45: ['-', '='], 46: ['^', '~'], 47: ['@', '`'], 48: ['[', '{'], 49: [']', '}'],
  51: [';', '+'], 52: [':', '*'], 53: ['半/全'],
}

const SHIFTED: Record<number, string> = {
  30: '!', 31: '@', 32: '#', 33: '$', 34: '%', 35: '^', 36: '&', 37: '*', 38: '(', 39: ')',
  45: '_', 46: '+', 47: '{', 48: '}', 49: '|', 51: ':', 52: '"', 53: '~', 54: '<', 55: '>', 56: '?',
}

function basic(code: number, legend: Legend): Label {
  const jis = legend === 'jis' ? JIS[code] : undefined
  if (jis) return { short: jis[0], full: jis[0], shifted: jis[1] }
  if (code >= 4 && code <= 29) {
    const letter = String.fromCharCode(61 + code)
    return { short: letter, full: letter }
  }
  if (code >= 30 && code <= 39) {
    const digit = String((code - 29) % 10)
    return { short: digit, full: digit, shifted: SHIFTED[code] }
  }
  if (code >= 58 && code <= 69) return { short: `F${code - 57}`, full: `F${code - 57}` }
  const entry = BASIC[code]
  if (entry) return { short: entry[0], full: entry[1] ?? entry[0], shifted: SHIFTED[code] }
  return { short: hex(code), full: `キーコード ${hex(code)}` }
}

const hex = (code: number) => `0x${code.toString(16).toUpperCase().padStart(4, '0')}`

function modifierNames(bits: number): string[] {
  return ['Ctrl', 'Shift', 'Alt', 'GUI'].filter((_, i) => bits & (1 << i))
}

const LAYER_MODES: [number, string, (layer: number) => string][] = [
  [0x5220, '押している間', (n) => `押している間だけレイヤー ${n}`],
  [0x5260, 'オン / オフ', (n) => `押すたびにレイヤー ${n} をオン・オフ`],
  [0x5200, '移動', (n) => `レイヤー ${n} に移動`],
  [0x5280, '次の1キー', (n) => `次の1キーだけレイヤー ${n}`],
]

function layerAction(code: number): Label | undefined {
  for (const [base, note, full] of LAYER_MODES) {
    if (code >= base && code < base + 32) {
      return { short: `レイヤー ${code - base}`, note, full: full(code - base) }
    }
  }
}

/** キー1つの動作を、欄ごとのキーコードで持つ（試作用の簡単な形。本実装では model/behavior.ts） */
export interface Behavior {
  state: 'normal' | 'none' | 'transparent'
  slots: Partial<Record<Slot, number>>
}

const isMomentary = (code: number) => code >= 0x5220 && code < 0x5240
const isUnsupported = (code: number) => code >= 0x2000 && !layerAction(code)

/** 動作1つの表示。修飾キー付きのキー（ショートカット）とレイヤー切替を含む */
export function labelOf(code: number, snapshot: KeyboardSnapshot, legend: Legend): Label {
  const layer = layerAction(code)
  if (layer) return layer
  if (code < 0x0100) return basic(code, legend)
  if (code < 0x2000) {
    const mods = modifierNames((code >> 8) & 0x0f)
    const key = basic(code & 0xff, legend)
    if (mods.length === 1 && mods[0] === 'Shift' && key.shifted) {
      return { short: key.shifted, full: `${key.shifted}（Shift + ${key.full}）` }
    }
    return { short: [...mods, key.short].join('+'), full: [...mods, key.full].join(' + ') }
  }
  if (code >= 0x7e00 && code < 0x7e20) {
    const custom = customKeycodes(snapshot)[code - 0x7e00]
    return { short: custom?.name ?? hex(code), full: custom?.title ?? `キーコード ${hex(code)}` }
  }
  return { short: hex(code), full: `キーコード ${hex(code)}` }
}

/** 本体のキーコード1つを、欄ごとの動作に分ける（MT、LT、Tap Dance をほどく） */
export function behaviorOf(code: number, snapshot: KeyboardSnapshot): Behavior {
  if (code === 0) return { state: 'none', slots: {} }
  if (code === 1) return { state: 'transparent', slots: {} }
  // 長押しだけのレイヤー切替（MO）は「長押し」の欄
  if (isMomentary(code)) return { state: 'normal', slots: { hold: code } }
  if (code >= 0x2000 && code < 0x4000) {
    // 修飾キーが複数の MT は、試作では最初の1つだけを出す
    const bits = (code >> 8) & 0x0f
    const right = (code >> 8) & 0x10 ? 4 : 0
    const index = [0, 1, 2, 3].find((i) => bits & (1 << i)) ?? 0
    return { state: 'normal', slots: { tap: code & 0xff, hold: 224 + index + right } }
  }
  if (code >= 0x4000 && code < 0x5000) {
    return { state: 'normal', slots: { tap: code & 0xff, hold: 0x5220 + ((code >> 8) & 0x0f) } }
  }
  const entry = code >= 0x5700 && code < 0x5800 ? snapshot.tapDances[code - 0x5700] : undefined
  if (entry) {
    const slots: Behavior['slots'] = {}
    if (entry.onTap) slots.tap = entry.onTap
    if (entry.onHold) slots.hold = entry.onHold
    if (entry.onDoubleTap) slots.doubleTap = entry.onDoubleTap
    if (entry.onTapHold) slots.tapHold = entry.onTapHold
    return { state: 'normal', slots }
  }
  return { state: 'normal', slots: { tap: code } }
}

export function viewBehavior(behavior: Behavior, snapshot: KeyboardSnapshot, legend: Legend): KeyView {
  const slots: KeyView['slots'] = {}
  for (const [slot, code] of Object.entries(behavior.slots) as [Slot, number][]) {
    slots[slot] = labelOf(code, snapshot, legend)
  }
  const { tap, ...others } = behavior.slots
  const locked = tap !== undefined && isUnsupported(tap) && Object.keys(others).length === 0
  return { state: locked ? 'locked' : behavior.state, slots }
}

export function viewKey(code: number, snapshot: KeyboardSnapshot, legend: Legend = 'us'): KeyView {
  return viewBehavior(behaviorOf(code, snapshot), snapshot, legend)
}

function customKeycodes(snapshot: KeyboardSnapshot): { name?: string; title?: string }[] {
  const raw = snapshot.layout.raw as { customKeycodes?: { name?: string; title?: string }[] }
  return raw.customKeycodes ?? []
}

/** 動作を選ぶ部品に並べる候補。キーコードで持ち、表示は labelOf で作る */
export interface Category {
  id: string
  name: string
  codes: number[]
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const SYMBOL_KEYS = [45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56]

export const CATEGORIES: Category[] = [
  { id: 'letters', name: '文字・数字', codes: [...range(4, 29), ...range(30, 39)] },
  { id: 'symbols', name: '記号', codes: [...SYMBOL_KEYS, ...[...range(30, 39), ...SYMBOL_KEYS].map((code) => 0x0200 | code)] },
  { id: 'edit', name: '入力・移動', codes: [40, 41, 42, 43, 44, 76, 145, 144, 80, 81, 82, 79, 74, 77, 75, 78, 73, 57, ...range(58, 69)] },
  { id: 'mods', name: '修飾キー', codes: range(224, 231) },
  { id: 'media', name: 'メディア・その他', codes: [168, 170, 169, 217, 218, 211, 70] },
]

/** 動作を選ぶ部品に出す、標準的なキーボード（US 配列、行ごとに少しずつずれた並び）。[キーコード, 幅] の列。0 はすき間 */
export const PICKER_KEYBOARD: [number, number][][] = [
  [[41, 1], [0, 1], ...range(58, 61).map((c): [number, number] => [c, 1]), [0, 0.5], ...range(62, 65).map((c): [number, number] => [c, 1]), [0, 0.5], ...range(66, 69).map((c): [number, number] => [c, 1])],
  [[53, 1], ...range(30, 39).map((c): [number, number] => [c, 1]), [45, 1], [46, 1], [42, 2]],
  [[43, 1.5], ...[20, 26, 8, 21, 23, 28, 24, 12, 18, 19, 47, 48].map((c): [number, number] => [c, 1]), [49, 1.5]],
  [[57, 1.75], ...[4, 22, 7, 9, 10, 11, 13, 14, 15, 51, 52].map((c): [number, number] => [c, 1]), [40, 2.25]],
  [[225, 2.25], ...[29, 27, 6, 25, 5, 17, 16, 54, 55, 56].map((c): [number, number] => [c, 1]), [229, 2.75]],
  [[224, 1.25], [227, 1.25], [226, 1.25], [145, 1.25], [44, 5], [144, 1.25], [230, 1.25], [231, 1.25], [228, 1.25]],
]

/** キーボードの右に置く、移動のキー。行は PICKER_KEYBOARD と同じ高さに並べる */
export const PICKER_NAVIGATION: [number, number][][] = [
  [],
  [[73, 1], [74, 1], [75, 1]],
  [[76, 1], [77, 1], [78, 1]],
  [],
  [[0, 1], [82, 1]],
  [[80, 1], [81, 1], [79, 1]],
]

export const isModifier = (code: number) => code >= 224 && code <= 231

export const LAYER_MODE_CHOICES: { base: number; name: string; momentary: boolean }[] = [
  { base: 0x5220, name: '押している間だけ', momentary: true },
  { base: 0x5260, name: '押すたびにオン・オフ', momentary: false },
  { base: 0x5200, name: 'そのレイヤーに移動', momentary: false },
  { base: 0x5280, name: '次の1キーだけ', momentary: false },
]

/** 透過キーで実際に効く、下のレイヤーの動作。behaviorAt は、編集を反映した後の動作を返す */
export function inheritedView(
  behaviorAt: (layer: number) => Behavior,
  layer: number,
  snapshot: KeyboardSnapshot,
  legend: Legend,
): KeyView | undefined {
  for (let below = layer - 1; below >= 0; below--) {
    const lower = behaviorAt(below)
    if (lower.state !== 'transparent') return viewBehavior(lower, snapshot, legend)
  }
}
