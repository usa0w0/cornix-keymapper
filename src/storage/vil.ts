// .vil（Vial が保存する設定のファイル）と、スナップショットの相互変換。
// 形式は、実物の .vil（src/device/fixtures/cornix/cornix.vil）に合わせてある（docs/design.md「保存 > .vil」）。
//
// - キーコードは名前の文字列（model/keycodeNames.ts）。キーのない位置は数値の -1
// - uid は、本体の 8 バイトを下位のバイトから並べた整数。JavaScript の数値では正確に表せないので、文字列のまま読み書きする
// - マクロ、Key Override、Alt Repeat Key、QMK Settings は扱わない。保存する時は空の値を入れ、読み込む時は数だけを数える
import type { ComboEntry, KeyboardSnapshot, TapDanceEntry } from '../device/types.ts'
import { keycodeToName, nameToKeycode } from '../model/keycodeNames.ts'
import { definedKeys } from '../model/layout.ts'

/** .vil の形式の版。Vial が書く値 */
const VIL_VERSION = 1
/** .vil で、キーのない位置に入る値 */
const NO_KEY = -1
const KEYCODE_LIMIT = 0x10000
/** uid は 8 バイト */
const UID_LIMIT = 1n << 64n

// ---- uid ----

/** スナップショットの uid（8 バイトを先頭から並べた 16 進）を、.vil の整数（10 進の文字列）にする。形が違えば null */
export function uidToVil(uid: string): string | null {
  if (!/^[0-9a-f]{16}$/i.test(uid)) return null
  const bytes = uid.match(/../g) ?? []
  return BigInt(`0x${bytes.reverse().join('')}`).toString()
}

/** .vil の整数（10 進の文字列）を、スナップショットの uid にする。8 バイトに収まらなければ null */
export function uidFromVil(digits: string): string | null {
  if (!/^\d{1,20}$/.test(digits)) return null
  const value = BigInt(digits)
  if (value >= UID_LIMIT) return null
  const bytes = value.toString(16).padStart(16, '0').match(/../g) ?? []
  return bytes.reverse().join('')
}

/** JSON の文字列が始まる位置から、閉じる引用符の位置を返す。閉じていなければ -1 */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i
  }
  return -1
}

/**
 * いちばん外側の "uid" の値（整数）を、引用符で囲んだ JSON にする。
 * JSON.parse は、大きな整数を近い値に丸めるので、通す前に文字列にしておく。文字列の中身に現れる "uid" には触らない
 */
function quoteUid(text: string): string {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--
    else if (char === '"') {
      const end = stringEnd(text, i)
      if (end < 0) return text
      if (depth === 1 && text.slice(i, end + 1) === '"uid"') {
        const match = /^(\s*:\s*)(\d+)(?=\s*[,}])/.exec(text.slice(end + 1))
        if (match) {
          const from = end + 1 + match[1].length
          return `${text.slice(0, from)}"${match[2]}"${text.slice(from + match[2].length)}`
        }
      }
      i = end
    }
  }
  return text
}

// ---- 保存 ----

type VilValue = string | number | VilValue[]

/** Python の json.dumps と同じ区切り（", " と ": "）で書く。Vial が保存するファイルと、同じ見た目にするため */
const dump = (value: VilValue): string =>
  Array.isArray(value) ? `[${value.map(dump).join(', ')}]` : JSON.stringify(value)

/**
 * スナップショットを .vil の文字列にする。uid が 8 バイトの 16 進でなければ null（偽の機器を、別の機器に見せかけた時など）。
 *
 * マクロ、Key Override、Alt Repeat Key、QMK Settings は、空の値を入れる。配列の選択肢（layout_options）は、
 * 本体から読んでいないので 0 を入れる
 */
export function snapshotToVil(snapshot: KeyboardSnapshot): string | null {
  const uid = uidToVil(snapshot.uid)
  if (uid === null) return null
  const { rows, cols } = snapshot.layout
  const defined = definedKeys(snapshot.layout)
  const layout = snapshot.keymap.map((layer) =>
    Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const key = row * cols + col
        const keycode = layer[key] ?? 0
        // キーのない位置は -1。本体から読んだ値は 0 だが、もし 0 でなければ、失わないように名前で書く（Vial は、キーのない位置を読まない）
        return !defined.has(key) && keycode === 0 ? NO_KEY : keycodeToName(keycode)
      }),
    ),
  )
  const fields: [string, string][] = [
    ['version', String(VIL_VERSION)],
    ['uid', uid],
    ['layout', dump(layout)],
    ['encoder_layout', dump(snapshot.encoders.map((layer) => layer.map((turns) => turns.map(keycodeToName))))],
    ['layout_options', '0'],
    ['macro', '[]'],
    ['vial_protocol', String(snapshot.capabilities.vialProtocol)],
    ['via_protocol', String(snapshot.capabilities.viaProtocol)],
    [
      'tap_dance',
      dump(
        snapshot.tapDances.map((entry) => [
          ...[entry.onTap, entry.onHold, entry.onDoubleTap, entry.onTapHold].map(keycodeToName),
          entry.tappingTerm,
        ]),
      ),
    ],
    ['combo', dump(snapshot.combos.map((entry) => [...entry.keys, entry.output].map(keycodeToName)))],
    ['key_override', '[]'],
    ['alt_repeat_key', '[]'],
    ['settings', '{}'],
  ]
  return `{${fields.map(([name, value]) => `${JSON.stringify(name)}: ${value}`).join(', ')}}`
}

// ---- 読み込み ----

/** .vil に入っていたが、このサイトが扱わない（本体に書き込まない）ものの数 */
export interface VilExtras {
  /** 中身のあるマクロの数（空の枠は数えない） */
  macros: number
  keyOverrides: number
  altRepeatKeys: number
  /** QMK Settings の項目の数 */
  settings: number
}

/** 扱わないものの合計。「このファイルのマクロなど N 件」の N */
export const countExtras = (extras: VilExtras) =>
  extras.macros + extras.keyOverrides + extras.altRepeatKeys + extras.settings

/** .vil の中の場所。解釈できない名前が、どこにあったかを示す */
export type VilPlace =
  | { kind: 'key'; layer: number; row: number; col: number }
  | { kind: 'encoder'; layer: number; encoder: number }
  | { kind: 'tapDance'; index: number }
  | { kind: 'combo'; index: number }

/** 読み込みを止める理由 */
export type VilFailure =
  /** JSON として読めない */
  | { reason: 'not-json' }
  /** .vil の形でない。what は、形が違っていた項目（layout など） */
  | { reason: 'not-vil'; what: string }
  /** UID が、接続中の本体と違う（別のキーボードで保存したファイル） */
  | { reason: 'uid' }
  /** 数が本体と合わない。actual はファイルの数、expected は本体の数 */
  | { reason: 'layers' | 'rows' | 'cols' | 'encoders' | 'tap-dance' | 'combo'; actual: number; expected: number }
  /** キーのある位置が、ファイルでは「キーなし」（-1）になっている */
  | { reason: 'missing-key'; place: VilPlace }
  /** 解釈できないキーコードの名前がある。names は、名前ごとの最初の場所 */
  | { reason: 'keycode'; names: { name: string; place: VilPlace }[] }

export type ReadVilResult =
  | { ok: true; snapshot: KeyboardSnapshot; extras: VilExtras }
  | { ok: false; failure: VilFailure }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** ある項目の形が違う、という失敗を投げて、読み込みを止める */
class Stop extends Error {
  readonly failure: VilFailure
  constructor(failure: VilFailure) {
    super(failure.reason)
    this.failure = failure
  }
}

const stop = (failure: VilFailure): never => {
  throw new Stop(failure)
}

/** 配列であることを確かめる。項目がない時は、空の配列として扱う（古い Vial が書かない項目のため） */
function listOf(value: unknown, what: string): unknown[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : stop({ reason: 'not-vil', what })
}

function sized(value: unknown, what: string, reason: 'layers' | 'rows' | 'cols' | 'encoders' | 'tap-dance' | 'combo', expected: number) {
  const list = listOf(value, what)
  return list.length === expected ? list : stop({ reason, actual: list.length, expected })
}

function extrasOf(data: Record<string, unknown>): VilExtras {
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  const { macro, settings } = data
  return {
    macros: Array.isArray(macro) ? macro.filter((entry) => !Array.isArray(entry) || entry.length > 0).length : 0,
    keyOverrides: count(data.key_override),
    altRepeatKeys: count(data.alt_repeat_key),
    settings: isRecord(settings) ? Object.keys(settings).length : 0,
  }
}

/**
 * .vil の文字列を、スナップショットにする。device は、接続中の本体から読んだスナップショット（基準）で、
 * 機器の識別、レイアウト定義、枠数は、そこから取る。ファイルから取るのは、キーマップ、エンコーダー、Tap Dance、コンボ。
 *
 * 本体と合わないファイル（UID、レイヤー・キー・エンコーダーの数、枠数）と、解釈できないキーコードの名前があるファイルは、
 * 読み込まずに理由を返す。分からない名前を、黙って「何もしない」にはしない
 */
export function vilToSnapshot(text: string, device: KeyboardSnapshot): ReadVilResult {
  let data: unknown
  try {
    data = JSON.parse(quoteUid(text))
  } catch {
    return { ok: false, failure: { reason: 'not-json' } }
  }
  try {
    return { ok: true, ...convert(data, device) }
  } catch (error) {
    if (error instanceof Stop) return { ok: false, failure: error.failure }
    throw error
  }
}

function convert(data: unknown, device: KeyboardSnapshot): { snapshot: KeyboardSnapshot; extras: VilExtras } {
  if (!isRecord(data)) return stop({ reason: 'not-vil', what: '全体' })
  if (!Array.isArray(data.layout)) return stop({ reason: 'not-vil', what: 'layout' })
  // 整数の uid は、quoteUid が文字列にしてある。数値のままなのは、整数でない書き方（小数、指数）の時
  const uid = typeof data.uid === 'string' ? uidFromVil(data.uid) : null
  if (uid === null) return stop({ reason: 'not-vil', what: 'uid' })
  if (uid !== device.uid.toLowerCase()) return stop({ reason: 'uid' })

  const { rows, cols, encoderCount } = device.layout
  const { layerCount, tapDanceCount, comboCount } = device.capabilities
  const defined = definedKeys(device.layout)
  const unknown = new Map<string, VilPlace>()

  const keycodeOf = (value: unknown, place: VilPlace, what: string): number => {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 && value < KEYCODE_LIMIT ? value : stop({ reason: 'not-vil', what })
    }
    if (typeof value !== 'string') return stop({ reason: 'not-vil', what })
    const keycode = nameToKeycode(value)
    if (keycode === undefined && !unknown.has(value)) unknown.set(value, place)
    return keycode ?? 0
  }

  const keymap = sized(data.layout, 'layout', 'layers', layerCount).map((rowsOfLayer, layer) =>
    sized(rowsOfLayer, 'layout', 'rows', rows).flatMap((row, r) =>
      sized(row, 'layout', 'cols', cols).map((value, c) => {
        const place: VilPlace = { kind: 'key', layer, row: r, col: c }
        if (value !== NO_KEY) return keycodeOf(value, place, 'layout')
        return defined.has(r * cols + c) ? stop({ reason: 'missing-key', place }) : 0
      }),
    ),
  )

  // エンコーダーのない本体では、項目がなくてもよい
  const encoderLayers = encoderCount === 0 && data.encoder_layout === undefined ? keymap.map(() => []) : data.encoder_layout
  const encoders = sized(encoderLayers, 'encoder_layout', 'layers', layerCount).map((turnsOfLayer, layer) =>
    sized(turnsOfLayer, 'encoder_layout', 'encoders', encoderCount).map((turns, encoder): [number, number] => {
      if (!Array.isArray(turns) || turns.length !== 2) return stop({ reason: 'not-vil', what: 'encoder_layout' })
      const place: VilPlace = { kind: 'encoder', layer, encoder }
      return [keycodeOf(turns[0], place, 'encoder_layout'), keycodeOf(turns[1], place, 'encoder_layout')]
    }),
  )

  const tapDances = sized(data.tap_dance, 'tap_dance', 'tap-dance', tapDanceCount).map((entry, index): TapDanceEntry => {
    if (!Array.isArray(entry) || entry.length !== 5) return stop({ reason: 'not-vil', what: 'tap_dance' })
    const place: VilPlace = { kind: 'tapDance', index }
    const [onTap, onHold, onDoubleTap, onTapHold] = entry.slice(0, 4).map((value) => keycodeOf(value, place, 'tap_dance'))
    const tappingTerm: unknown = entry[4]
    if (typeof tappingTerm !== 'number' || !Number.isInteger(tappingTerm) || tappingTerm < 0 || tappingTerm >= KEYCODE_LIMIT) {
      return stop({ reason: 'not-vil', what: 'tap_dance' })
    }
    return { onTap, onHold, onDoubleTap, onTapHold, tappingTerm }
  })

  const combos = sized(data.combo, 'combo', 'combo', comboCount).map((entry, index): ComboEntry => {
    if (!Array.isArray(entry) || entry.length !== 5) return stop({ reason: 'not-vil', what: 'combo' })
    const [a, b, c, d, output] = entry.map((value) => keycodeOf(value, { kind: 'combo', index }, 'combo'))
    return { keys: [a, b, c, d], output }
  })

  if (unknown.size > 0) {
    return stop({ reason: 'keycode', names: [...unknown].map(([name, place]) => ({ name, place })) })
  }
  const { uid: deviceUid, layout, capabilities } = device
  return {
    snapshot: { uid: deviceUid, layout, capabilities, keymap, encoders, tapDances, combos },
    extras: extrasOf(data),
  }
}
