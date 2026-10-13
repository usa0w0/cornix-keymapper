// テスト用。Vial の要求に、持っている設定から応答を返す
import type { ComboEntry, TapDanceEntry } from '../../types.ts'
import { REPORT_SIZE } from '../transport.ts'

export interface SimulatedState {
  viaProtocol: number
  vialProtocol: number
  /** 8 バイト */
  uid: number[]
  compressedDefinition: Uint8Array
  rows: number
  cols: number
  /** [レイヤー][行 × cols + 列] */
  keymap: number[][]
  /** [レイヤー][エンコーダー] = [左回し, 右回し] */
  encoders: [number, number][][]
  tapDances: TapDanceEntry[]
  combos: ComboEntry[]
  /** Tap Dance と Combo のコマンドに対応していない本体をまねる */
  dynamicEntriesUnsupported?: boolean
  /** この番号の Tap Dance の読み出しを失敗させる */
  failTapDanceAt?: number
  /**
   * 書くコマンドへの応答の形。実機の応答の形は確かめていないので、どの形でも書き込みが通ることをテストする。
   * 省くと QMK 版 Vial と同じ（要求をそのまま返す。Tap Dance と Combo は、先頭を結果の 0 にして返す）。
   * zero は 0 で埋めた応答、ff は 0xFF で埋めた応答
   */
  writeResponse?: 'zero' | 'ff'
  /** true の間、書くコマンドを受け取っても、中身を変えない（書き込みが効かない本体をまねる） */
  ignoreWrites?: boolean
}

const le16 = (value: number) => [value & 0xff, value >> 8]
const be16 = (value: number) => [value >> 8, value & 0xff]
const u16be = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1]
const u16le = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8)

/** 書くコマンドへの応答。QMK 版 Vial は、受け取った要求を書き換えて返すので、何もしなければ要求と同じになる */
function writeReply(state: SimulatedState, request: Uint8Array, response: Uint8Array, result?: number): void {
  if (state.writeResponse === 'ff') response.fill(0xff)
  else if (state.writeResponse !== 'zero') {
    response.set(request)
    if (result !== undefined) response[0] = result
  }
}

export function respond(state: SimulatedState, request: Uint8Array): Uint8Array {
  const response = new Uint8Array(REPORT_SIZE)
  const put = (bytes: number[], at = 0) => response.set(bytes, at)

  switch (request[0]) {
    case 0x01:
      put([0x01, ...be16(state.viaProtocol)])
      break
    case 0x05: {
      // 1キー書き込み。層、行、列、キーコード（上位バイト先）
      const [layer, row, col] = [request[1], request[2], request[3]]
      const keys = state.keymap[layer]
      if (!state.ignoreWrites && keys && row < state.rows && col < state.cols) keys[row * state.cols + col] = u16be(request, 4)
      writeReply(state, request, response)
      break
    }
    case 0x11:
      put([0x11, state.keymap.length])
      break
    case 0x12: {
      const offset = (request[1] << 8) | request[2]
      const size = request[3]
      const buffer = state.keymap.flat().flatMap(be16)
      put([0x12, request[1], request[2], size, ...buffer.slice(offset, offset + size)])
      break
    }
    case 0xfe:
      respondVial(state, request, response)
      break
    default:
      response.fill(0xff)
  }
  return response
}

function respondVial(state: SimulatedState, request: Uint8Array, response: Uint8Array): void {
  const put = (bytes: number[], at = 0) => response.set(bytes, at)
  switch (request[1]) {
    case 0x00:
      put([state.vialProtocol & 0xff, state.vialProtocol >> 8, 0, 0, ...state.uid])
      break
    case 0x01:
      put(le16(state.compressedDefinition.length))
      break
    case 0x02: {
      const block = request[2] | (request[3] << 8)
      response.set(state.compressedDefinition.slice(block * 32, block * 32 + 32))
      break
    }
    case 0x03: {
      const [left, right] = state.encoders[request[2]][request[3]]
      put([...be16(left), ...be16(right)])
      break
    }
    case 0x04: {
      // エンコーダーの1方向。層、番号、方向（0 が左回し、1 が右回し）、キーコード（上位バイト先）
      const encoder = state.encoders[request[2]]?.[request[3]]
      if (!state.ignoreWrites && encoder && request[4] < 2) encoder[request[4]] = u16be(request, 5)
      writeReply(state, request, response)
      break
    }
    case 0x05:
      // ロックの状態。解除済み
      put([1, 0])
      break
    case 0x0d:
      respondDynamicEntry(state, request, response)
      break
    default:
      response.fill(0xff)
  }
}

function respondDynamicEntry(state: SimulatedState, request: Uint8Array, response: Uint8Array): void {
  if (state.dynamicEntriesUnsupported) {
    response.fill(0xff)
    return
  }
  const index = request[3]
  switch (request[2]) {
    case 0x00:
      response.set([state.tapDances.length, state.combos.length, 0])
      break
    case 0x01: {
      const entry = state.tapDances[index]
      if (!entry || index === state.failTapDanceAt) {
        response.fill(0xff)
        break
      }
      const { onTap, onHold, onDoubleTap, onTapHold, tappingTerm } = entry
      response.set([0, ...[onTap, onHold, onDoubleTap, onTapHold, tappingTerm].flatMap(le16)])
      break
    }
    case 0x02: {
      // 本体にない枠は、結果を 0 以外にして返す
      const known = index < state.tapDances.length
      if (known && !state.ignoreWrites) {
        const [onTap, onHold, onDoubleTap, onTapHold, tappingTerm] = [4, 6, 8, 10, 12].map((at) => u16le(request, at))
        state.tapDances[index] = { onTap, onHold, onDoubleTap, onTapHold, tappingTerm }
      }
      writeReply(state, request, response, known ? 0 : 0xff)
      break
    }
    case 0x03: {
      const entry = state.combos[index]
      if (!entry) {
        response.fill(0xff)
        break
      }
      response.set([0, ...[...entry.keys, entry.output].flatMap(le16)])
      break
    }
    case 0x04: {
      const known = index < state.combos.length
      if (known && !state.ignoreWrites) {
        const [a, b, c, d, output] = [4, 6, 8, 10, 12].map((at) => u16le(request, at))
        state.combos[index] = { keys: [a, b, c, d], output }
      }
      writeReply(state, request, response, known ? 0 : 0xff)
      break
    }
    default:
      response.fill(0xff)
  }
}
