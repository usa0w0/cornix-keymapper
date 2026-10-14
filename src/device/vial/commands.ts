// VIA / Vial のコマンド。要求のバイト列を作り、応答を読み解く
// 数値の並びは、キーマップ（VIA）が上位バイト先、Vial のコマンドが下位バイト先

import { DeviceError } from '../types.ts'

/**
 * 要求を送り、応答（32 バイト）を返すもの。Transport.request を渡す。
 * echo は、応答の先頭が要求と同じ内容になるバイト数（Transport が、合わない応答を捨てる）
 */
export type Requester = (payload: number[], echo?: number) => Promise<Uint8Array>

const VIA_GET_PROTOCOL_VERSION = 0x01
const VIA_SET_KEYCODE = 0x05
const VIA_GET_LAYER_COUNT = 0x11
const VIA_GET_KEYMAP_BUFFER = 0x12
const VIAL_PREFIX = 0xfe
const VIAL_GET_KEYBOARD_ID = 0x00
const VIAL_GET_SIZE = 0x01
const VIAL_GET_DEFINITION = 0x02
const VIAL_GET_ENCODER = 0x03
const VIAL_SET_ENCODER = 0x04
const VIAL_GET_UNLOCK_STATUS = 0x05
const VIAL_DYNAMIC_ENTRY = 0x0d
const DYNAMIC_GET_COUNTS = 0x00
const DYNAMIC_TAP_DANCE_GET = 0x01
const DYNAMIC_TAP_DANCE_SET = 0x02
const DYNAMIC_COMBO_GET = 0x03
const DYNAMIC_COMBO_SET = 0x04

// 応答の先頭が、要求と同じ内容になるバイト数。実機（Cornix LP）で確かめたのは、VIA の 0x01、0x11（コマンド番号）と
// 0x12（コマンド番号・位置・大きさ）だけ。Vial（0xFE）のコマンドは返さないので、指定しない
const ECHO_COMMAND = 1
const ECHO_KEYMAP_BUFFER = 4

/** キーマップのまとめ読みで、1回に読めるバイト数（32 バイトの応答から先頭 4 バイトを引いた数） */
const KEYMAP_CHUNK = 28
const DEFINITION_BLOCK = 32
/** 圧縮されたレイアウト定義の大きさの上限。実物は数 kB なので、十分に大きい値 */
const MAX_DEFINITION_SIZE = 64 * 1024
/** キーマップ全体の大きさの上限。読む位置を 2 バイトで送るため */
const MAX_KEYMAP_SIZE = 0x10000
/** レイヤー数の上限。Vial のキーコードで指せるレイヤーは 32 まで */
const MAX_LAYER_COUNT = 32

const u16be = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1]
const u16le = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8)
const u32le = (bytes: Uint8Array, at: number) =>
  (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff]
const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24]

export async function getViaProtocolVersion(request: Requester): Promise<number> {
  return u16be(await request([VIA_GET_PROTOCOL_VERSION], ECHO_COMMAND), 1)
}

export interface KeyboardId {
  vialProtocol: number
  /** 8 バイトを 16 進で並べたもの */
  uid: string
}

export async function getKeyboardId(request: Requester): Promise<KeyboardId> {
  const response = await request([VIAL_PREFIX, VIAL_GET_KEYBOARD_ID])
  const uid = Array.from(response.slice(4, 12), (b) => b.toString(16).padStart(2, '0')).join('')
  return { vialProtocol: u32le(response, 0), uid }
}

/** XZ 圧縮されたレイアウト定義を、32 バイトずつ読む */
export async function getCompressedDefinition(
  request: Requester,
  onBlock?: (done: number, total: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const size = u32le(await request([VIAL_PREFIX, VIAL_GET_SIZE]), 0)
  // 別の要求への応答や、対応していない本体の応答（0xFF で埋まる）を大きさとして読むと、
  // 巨大な領域を確保して読み続けてしまう
  if (size === 0 || size > MAX_DEFINITION_SIZE) throw new DeviceError('unexpected-response')
  const blocks = Math.ceil(size / DEFINITION_BLOCK)
  const data = new Uint8Array(blocks * DEFINITION_BLOCK)
  for (let block = 0; block < blocks; block++) {
    const response = await request([VIAL_PREFIX, VIAL_GET_DEFINITION, ...le32(block)])
    data.set(response.slice(0, DEFINITION_BLOCK), block * DEFINITION_BLOCK)
    onBlock?.(block + 1, blocks)
  }
  return data.slice(0, size)
}

export async function getLayerCount(request: Requester): Promise<number> {
  const count = (await request([VIA_GET_LAYER_COUNT], ECHO_COMMAND))[1]
  if (count === 0 || count > MAX_LAYER_COUNT) throw new DeviceError('unexpected-response')
  return count
}

/** 全レイヤーのキーマップ。[レイヤー][行 × cols + 列] = キーコード */
export async function getKeymap(
  request: Requester,
  layerCount: number,
  rows: number,
  cols: number,
  onChunk?: (done: number, total: number) => void,
): Promise<number[][]> {
  const keysPerLayer = rows * cols
  const size = layerCount * keysPerLayer * 2
  // 読む位置は 2 バイトで送るので、それを超える大きさは読めない
  if (!Number.isInteger(size) || size <= 0 || size > MAX_KEYMAP_SIZE) {
    throw new DeviceError('unexpected-response')
  }
  const buffer = new Uint8Array(size)
  for (let offset = 0; offset < size; offset += KEYMAP_CHUNK) {
    const length = Math.min(KEYMAP_CHUNK, size - offset)
    const response = await request([VIA_GET_KEYMAP_BUFFER, offset >> 8, offset & 0xff, length], ECHO_KEYMAP_BUFFER)
    buffer.set(response.slice(4, 4 + length), offset)
    onChunk?.(Math.min(offset + length, size), size)
  }
  return Array.from({ length: layerCount }, (_, layer) =>
    Array.from({ length: keysPerLayer }, (_, key) => u16be(buffer, (layer * keysPerLayer + key) * 2)),
  )
}

/** エンコーダー1つの [左回し, 右回し] のキーコード */
export async function getEncoder(
  request: Requester,
  layer: number,
  index: number,
): Promise<[number, number]> {
  const response = await request([VIAL_PREFIX, VIAL_GET_ENCODER, layer, index])
  return [u16be(response, 0), u16be(response, 2)]
}

export interface DynamicEntryCounts {
  tapDance: number
  combo: number
  keyOverride: number
}

export async function getDynamicEntryCounts(request: Requester): Promise<DynamicEntryCounts> {
  const response = await request([VIAL_PREFIX, VIAL_DYNAMIC_ENTRY, DYNAMIC_GET_COUNTS])
  // 対応していない本体は、応答を 0xFF で埋めて返す
  if (response[0] === 0xff && response[1] === 0xff && response[2] === 0xff) {
    return { tapDance: 0, combo: 0, keyOverride: 0 }
  }
  return { tapDance: response[0], combo: response[1], keyOverride: response[2] }
}

/** 枠1つぶんの応答。先頭の 1 バイトは結果（0 が成功）で、続く 10 バイトが中身 */
async function getDynamicEntry(request: Requester, kind: number, index: number): Promise<number[] | null> {
  const response = await request([VIAL_PREFIX, VIAL_DYNAMIC_ENTRY, kind, index])
  if (response[0] !== 0) return null
  return [1, 3, 5, 7, 9].map((at) => u16le(response, at))
}

export async function getTapDance(request: Requester, index: number) {
  const values = await getDynamicEntry(request, DYNAMIC_TAP_DANCE_GET, index)
  if (!values) return null
  const [onTap, onHold, onDoubleTap, onTapHold, tappingTerm] = values
  return { onTap, onHold, onDoubleTap, onTapHold, tappingTerm }
}

export async function getCombo(request: Requester, index: number) {
  const values = await getDynamicEntry(request, DYNAMIC_COMBO_GET, index)
  if (!values) return null
  const [a, b, c, d, output] = values
  return { keys: [a, b, c, d] as [number, number, number, number], output }
}

export interface UnlockStatus {
  unlocked: boolean
  inProgress: boolean
}

/** 書き込みにロック解除が要るかを見るための状態。読むだけで、解除はしない */
export async function getUnlockStatus(request: Requester): Promise<UnlockStatus> {
  const response = await request([VIAL_PREFIX, VIAL_GET_UNLOCK_STATUS])
  return { unlocked: response[0] !== 0, inProgress: response[1] !== 0 }
}

// ---- 書くコマンド ----
// バイトの並びは、読むコマンド（実機で確かめ済み）と対になる形で、QMK 版 Vial のとおりにしてある。
// 応答の形は、実機（Cornix LP、RMK）で確かめていない（docs/design.md「実機で確かめること」の 19）。
// そのため、応答の中身は見ず、突き合わせ（echo）にも使わない。書けたかどうかは、呼び出し側が読み直して確かめる

/** キー1つを書く。位置は、行列の行と列。キーコードは上位バイト先（キーマップのまとめ読みと同じ） */
export async function setKeycode(request: Requester, layer: number, row: number, col: number, keycode: number): Promise<void> {
  await request([VIA_SET_KEYCODE, layer, row, col, ...be16(keycode)])
}

/** エンコーダーの1方向を書く。direction は、読むコマンドの応答の並びと同じで、0 が左回し、1 が右回し */
export async function setEncoder(
  request: Requester,
  layer: number,
  index: number,
  direction: 0 | 1,
  keycode: number,
): Promise<void> {
  await request([VIAL_PREFIX, VIAL_SET_ENCODER, layer, index, direction, ...be16(keycode)])
}

/** 枠1つぶんを書く。中身は、読むコマンドの応答（結果の 1 バイトの後ろ）と同じ 10 バイト */
async function setDynamicEntry(request: Requester, kind: number, index: number, values: number[]): Promise<void> {
  await request([VIAL_PREFIX, VIAL_DYNAMIC_ENTRY, kind, index, ...values.flatMap(le16)])
}

export function setTapDance(
  request: Requester,
  index: number,
  entry: { onTap: number; onHold: number; onDoubleTap: number; onTapHold: number; tappingTerm: number },
): Promise<void> {
  const { onTap, onHold, onDoubleTap, onTapHold, tappingTerm } = entry
  return setDynamicEntry(request, DYNAMIC_TAP_DANCE_SET, index, [onTap, onHold, onDoubleTap, onTapHold, tappingTerm])
}

export function setCombo(request: Requester, index: number, entry: { keys: readonly number[]; output: number }): Promise<void> {
  const [a = 0, b = 0, c = 0, d = 0] = entry.keys
  return setDynamicEntry(request, DYNAMIC_COMBO_SET, index, [a, b, c, d, entry.output])
}
