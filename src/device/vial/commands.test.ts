import { expect, test } from 'vitest'
import { DeviceError } from '../types.ts'
import {
  getCombo,
  getCompressedDefinition,
  getDynamicEntryCounts,
  getEncoder,
  getKeyboardId,
  getKeymap,
  getLayerCount,
  getTapDance,
  getUnlockStatus,
  getViaProtocolVersion,
  type Requester,
} from './commands.ts'
import { sampleState } from './testing/sampleState.ts'
import { respond, type SimulatedState } from './testing/simulatedKeyboard.ts'
import { REPORT_SIZE } from './transport.ts'

function setup(state: SimulatedState = sampleState()) {
  const sent: number[][] = []
  const request: Requester = async (payload) => {
    sent.push(payload)
    const report = new Uint8Array(REPORT_SIZE)
    report.set(payload)
    return respond(state, report)
  }
  return { state, sent, request }
}

test('VIA の版、Vial の版、UID を読む', async () => {
  const { request } = setup()
  expect(await getViaProtocolVersion(request)).toBe(9)
  expect(await getKeyboardId(request)).toEqual({ vialProtocol: 6, uid: '0123456789abcdef' })
})

test('レイアウト定義を 32 バイトずつ読み、大きさぶんだけ返す', async () => {
  const { state, sent, request } = setup()
  const progress: [number, number][] = []
  const data = await getCompressedDefinition(request, (done, total) => progress.push([done, total]))
  expect(data).toEqual(state.compressedDefinition)
  const blocks = Math.ceil(state.compressedDefinition.length / 32)
  expect(sent).toHaveLength(1 + blocks)
  expect(sent[2]).toEqual([0xfe, 0x02, 1, 0, 0, 0])
  expect(progress.at(-1)).toEqual([blocks, blocks])
})

test('キーマップを 28 バイトずつ読み、レイヤーごとのキーコードにする', async () => {
  const { state, sent, request } = setup()
  expect(await getLayerCount(request)).toBe(3)
  const keymap = await getKeymap(request, 3, state.rows, state.cols)
  expect(keymap).toEqual(state.keymap)
  // 36 バイトを、28 バイトと 8 バイトの2回で読む
  expect(sent.slice(1)).toEqual([
    [0x12, 0, 0, 28],
    [0x12, 0, 28, 8],
  ])
})

test('エンコーダーの左回し・右回しを読む', async () => {
  const { sent, request } = setup()
  expect(await getEncoder(request, 1, 0)).toEqual([0x0050, 0x004f])
  expect(sent[0]).toEqual([0xfe, 0x03, 1, 0])
})

test('Tap Dance と Combo の枠数と中身を読む', async () => {
  const { state, request } = setup()
  expect(await getDynamicEntryCounts(request)).toEqual({ tapDance: 2, combo: 1, keyOverride: 0 })
  expect(await getTapDance(request, 0)).toEqual(state.tapDances[0])
  expect(await getCombo(request, 0)).toEqual(state.combos[0])
})

test('枠の読み出しが失敗の応答なら null を返す', async () => {
  const { request } = setup()
  expect(await getTapDance(request, 5)).toBeNull()
  expect(await getCombo(request, 5)).toBeNull()
})

test('Tap Dance と Combo に対応していない本体では、枠数を 0 とする', async () => {
  const { request } = setup({ ...sampleState(), dynamicEntriesUnsupported: true })
  expect(await getDynamicEntryCounts(request)).toEqual({ tapDance: 0, combo: 0, keyOverride: 0 })
})

test('ロックの状態を読む', async () => {
  const request: Requester = async () => Uint8Array.from([1, 0, 0xff, 0xff])
  expect(await getUnlockStatus(request)).toEqual({ unlocked: true, inProgress: false })
})

test('定義の大きさが 0 や大きすぎる時は、読み続けずに unexpected-response で失敗する', async () => {
  for (const sizeBytes of [[0, 0, 0, 0], [0xff, 0xff, 0xff, 0xff], [0x01, 0x00, 0x01, 0x00]]) {
    const sent: number[][] = []
    const request: Requester = async (payload) => {
      sent.push(payload)
      return Uint8Array.from(sizeBytes)
    }
    const error = await getCompressedDefinition(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeviceError)
    expect(error).toMatchObject({ kind: 'unexpected-response' })
    // 大きさを聞いた1回だけで止まる
    expect(sent).toHaveLength(1)
  }
})

test('レイヤー数が 0 や大きすぎる時は unexpected-response で失敗する', async () => {
  for (const count of [0, 33, 0xff]) {
    const request: Requester = async () => Uint8Array.from([0x11, count])
    await expect(getLayerCount(request)).rejects.toMatchObject({ kind: 'unexpected-response' })
  }
})
