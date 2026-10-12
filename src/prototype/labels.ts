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

const SHIFTED: Record<number, string> = {
  30: '!', 31: '@', 32: '#', 33: '$', 34: '%', 35: '^', 36: '&', 37: '*', 38: '(', 39: ')',
  45: '_', 46: '+', 47: '{', 48: '}', 49: '|', 51: ':', 52: '"', 53: '~', 54: '<', 55: '>', 56: '?',
}

function basic(code: number): Label {
  if (code >= 4 && code <= 29) {
    const letter = String.fromCharCode(61 + code)
    return { short: letter, full: letter }
  }
  if (code >= 30 && code <= 39) {
    const digit = String((code - 29) % 10)
    return { short: digit, full: digit }
  }
  if (code >= 58 && code <= 69) return { short: `F${code - 57}`, full: `F${code - 57}` }
  const entry = BASIC[code]
  if (entry) return { short: entry[0], full: entry[1] ?? entry[0] }
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

export function viewKey(code: number, snapshot: KeyboardSnapshot): KeyView {
  if (code === 0) return { state: 'none', slots: {} }
  if (code === 1) return { state: 'transparent', slots: {} }
  const layer = layerAction(code)
  // 長押しだけのレイヤー切替（MO）は「長押し」の欄、それ以外は「タップ」の欄
  if (layer) return { state: 'normal', slots: code >= 0x5220 && code < 0x5240 ? { hold: layer } : { tap: layer } }
  if (code < 0x0100) return { state: 'normal', slots: { tap: basic(code) } }
  if (code < 0x2000) {
    const mods = modifierNames((code >> 8) & 0x0f)
    const key = code & 0xff
    if (mods.length === 1 && mods[0] === 'Shift' && SHIFTED[key]) {
      return { state: 'normal', slots: { tap: { short: SHIFTED[key], full: `${SHIFTED[key]}（Shift + ${basic(key).full}）` } } }
    }
    const name = [...mods, basic(key).short].join('+')
    return { state: 'normal', slots: { tap: { short: name, full: [...mods, basic(key).full].join(' + ') } } }
  }
  if (code >= 0x2000 && code < 0x4000) {
    const mods = modifierNames((code >> 8) & 0x0f)
    return { state: 'normal', slots: { tap: basic(code & 0xff), hold: { short: mods.join('+'), full: mods.join(' + ') } } }
  }
  if (code >= 0x4000 && code < 0x5000) {
    const n = (code >> 8) & 0x0f
    return {
      state: 'normal',
      slots: { tap: basic(code & 0xff), hold: { short: `レイヤー ${n}`, note: '押している間', full: `押している間だけレイヤー ${n}` } },
    }
  }
  if (code >= 0x5700 && code < 0x5800) {
    const entry = snapshot.tapDances[code - 0x5700]
    if (!entry) return { state: 'locked', slots: { tap: { short: hex(code), full: `キーコード ${hex(code)}` } } }
    const slots: KeyView['slots'] = {}
    for (const [slot, value] of [
      ['tap', entry.onTap],
      ['hold', entry.onHold],
      ['doubleTap', entry.onDoubleTap],
      ['tapHold', entry.onTapHold],
    ] as const) {
      if (value === 0) continue
      const inner = viewKey(value, snapshot)
      slots[slot] = inner.slots.tap ?? inner.slots.hold
    }
    return { state: 'normal', slots }
  }
  if (code >= 0x7e00 && code < 0x7e20) {
    const custom = customKeycodes(snapshot)[code - 0x7e00]
    return {
      state: 'locked',
      slots: { tap: { short: custom?.name ?? hex(code), full: custom?.title ?? `キーコード ${hex(code)}` } },
    }
  }
  return { state: 'locked', slots: { tap: { short: hex(code), full: `キーコード ${hex(code)}` } } }
}

function customKeycodes(snapshot: KeyboardSnapshot): { name?: string; title?: string }[] {
  const raw = snapshot.layout.raw as { customKeycodes?: { name?: string; title?: string }[] }
  return raw.customKeycodes ?? []
}

/** 透過キーに、下のレイヤーで実際に効く動作を添える */
export function viewKeyAt(snapshot: KeyboardSnapshot, layer: number, key: number): KeyView {
  const view = viewKey(snapshot.keymap[layer][key], snapshot)
  if (view.state !== 'transparent') return view
  for (let below = layer - 1; below >= 0; below--) {
    const lower = viewKey(snapshot.keymap[below][key], snapshot)
    if (lower.state !== 'transparent') return { ...view, inherited: lower }
  }
  return view
}
