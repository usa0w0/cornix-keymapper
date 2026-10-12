// レイアウト定義のキー配置（layouts.keymap、KLE 形式）から、キーとエンコーダーの位置を取り出す。
//
// KLE 形式は、行ごとに、次のキーの見た目の指定（オブジェクト）とキーのラベル（文字列）が並ぶ。
// ラベルは改行で区切った欄を持ち、先頭が「行,列」。エンコーダーは 10 番目の欄が "e" で、先頭が「番号,向き」。
// 9 番目の欄は配列の選択肢（「選択肢の番号,候補の番号」）で、候補 0 のキーだけを使う
import type { LayoutDefinition } from '../device/types.ts'

/** 図の上の場所。単位はキー1つぶん（1u）。回転は、中心（rx, ry）のまわりに r 度 */
interface Placement {
  x: number
  y: number
  w: number
  h: number
  r: number
  rx: number
  ry: number
}

export type PlacedKey =
  /** キー。row と col は行列上の位置で、index はキーマップの中の番号（行 × 列数 + 列） */
  | (Placement & { kind: 'key'; row: number; col: number; index: number })
  /** エンコーダーの1方向。左回しと右回しが、別々の場所として並ぶ */
  | (Placement & { kind: 'encoder'; encoder: number; direction: 'left' | 'right' })

const ENCODER_DIRECTIONS = ['left', 'right'] as const

const LABEL_OPTION = 8
const LABEL_ENCODER = 9

/** 本体から来る値なので、数でないものは指定がなかったものとして扱う */
const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** 「a,b」の形の、0 以上の整数の組。形が違えば undefined */
function pairOf(text: string | undefined): [number, number] | undefined {
  const parts = (text ?? '').split(',')
  if (parts.length !== 2) return undefined
  const [a, b] = parts.map((part) => (/^\d+$/.test(part.trim()) ? Number(part) : NaN))
  return Number.isNaN(a) || Number.isNaN(b) ? undefined : [a, b]
}

/**
 * レイアウト定義から、キーとエンコーダーの位置を、定義に書かれた順に取り出す。
 * 行列やエンコーダーの数に収まらないもの、ラベルが読めないものは、図に出せないので除く
 */
export function placeKeys(layout: LayoutDefinition): PlacedKey[] {
  const keymap = (layout.raw as { layouts?: { keymap?: unknown } } | null)?.layouts?.keymap
  const keys: PlacedKey[] = []
  const cursor = { x: 0, y: 0, r: 0, rx: 0, ry: 0 }
  for (const row of Array.isArray(keymap) ? keymap : []) {
    if (!Array.isArray(row)) continue
    let size = { w: 1, h: 1 }
    for (const item of row) {
      if (typeof item === 'string') {
        const placed = placeLabel(item, { ...cursor, ...size }, layout)
        if (placed) keys.push(placed)
        cursor.x += size.w
        size = { w: 1, h: 1 }
        continue
      }
      if (typeof item !== 'object' || item === null) continue
      const props = item as Record<string, unknown>
      const [r, rx, ry] = [numberOf(props.r), numberOf(props.rx), numberOf(props.ry)]
      if (r !== undefined) cursor.r = r
      // 回転の中心を指定すると、置く場所もその中心に戻る
      if (rx !== undefined) cursor.rx = rx
      if (ry !== undefined) cursor.ry = ry
      if (rx !== undefined || ry !== undefined) {
        cursor.x = cursor.rx
        cursor.y = cursor.ry
      }
      cursor.x += numberOf(props.x) ?? 0
      cursor.y += numberOf(props.y) ?? 0
      size = { w: numberOf(props.w) ?? size.w, h: numberOf(props.h) ?? size.h }
    }
    cursor.y += 1
    cursor.x = cursor.rx
  }
  return keys
}

function placeLabel(label: string, placement: Placement, layout: LayoutDefinition): PlacedKey | undefined {
  const labels = label.split('\n')
  const position = pairOf(labels[0])
  if (!position) return undefined
  const option = pairOf(labels[LABEL_OPTION])
  if (option && option[1] !== 0) return undefined
  const [a, b] = position
  if (labels[LABEL_ENCODER] === 'e') {
    if (a >= layout.encoderCount || b >= ENCODER_DIRECTIONS.length) return undefined
    return { ...placement, kind: 'encoder', encoder: a, direction: ENCODER_DIRECTIONS[b] }
  }
  if (a >= layout.rows || b >= layout.cols) return undefined
  return { ...placement, kind: 'key', row: a, col: b, index: a * layout.cols + b }
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 回転を含めた、図全体の大きさ（1u 単位）。キーがなければ、大きさ 0 */
export function boundsOf(keys: readonly PlacedKey[]): Bounds {
  if (keys.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  const xs: number[] = []
  const ys: number[] = []
  for (const key of keys) {
    const angle = (key.r * Math.PI) / 180
    for (const [cx, cy] of [
      [key.x, key.y],
      [key.x + key.w, key.y],
      [key.x, key.y + key.h],
      [key.x + key.w, key.y + key.h],
    ]) {
      const dx = cx - key.rx
      const dy = cy - key.ry
      xs.push(key.rx + dx * Math.cos(angle) - dy * Math.sin(angle))
      ys.push(key.ry + dx * Math.sin(angle) + dy * Math.cos(angle))
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/**
 * レイアウト定義に書かれたファームウェアの版（例: V1.12）。Cornix の定義は、配列の選択肢の欄（layouts.labels）に
 * 「Firmware Version」という名前の選択肢として持つ。書かれていなければ undefined
 */
export function firmwareVersionOf(layout: LayoutDefinition): string | undefined {
  const labels = (layout.raw as { layouts?: { labels?: unknown } } | null)?.layouts?.labels
  for (const label of Array.isArray(labels) ? labels : []) {
    if (Array.isArray(label) && label[0] === 'Firmware Version' && typeof label[1] === 'string') return label[1]
  }
  return undefined
}

/** キーの場所の名前。編集欄、枠を使っているキーの一覧、変更点の一覧に出す */
export const placeName = (layer: number, key: { row: number; col: number }) =>
  `レイヤー ${layer} ・ 行 ${key.row} 列 ${key.col}`

/** エンコーダーの1方向の名前 */
export const encoderName = (turn: { encoder: number; direction: 'left' | 'right' }) =>
  `エンコーダー ${turn.encoder + 1} の${turn.direction === 'left' ? '左回し' : '右回し'}`
