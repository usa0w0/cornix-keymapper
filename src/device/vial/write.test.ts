import { expect, test } from 'vitest'
import { DeviceError, type KeyboardSnapshot, type WriteOperation } from '../types.ts'
import { setCombo, setEncoder, setKeycode, setTapDance, type Requester } from './commands.ts'
import { openVialDevice } from './connect.ts'
import { FakeHid, FakeHidDevice } from './testing/fakeHid.ts'
import { sampleState } from './testing/sampleState.ts'
import { respond, type SimulatedState } from './testing/simulatedKeyboard.ts'
import { REPORT_SIZE } from './transport.ts'

/** 送った要求を、末尾の 0 を除いた形で控える */
function recorder() {
  const sent: number[][] = []
  const request: Requester = async (payload, echo) => {
    // 書くコマンドの応答の形は確かめていないので、突き合わせを頼まない
    expect(echo).toBeUndefined()
    sent.push([...payload])
    return new Uint8Array(REPORT_SIZE)
  }
  return { sent, request }
}

test('書くコマンドのバイトの並び: QMK 版 Vial と同じ', async () => {
  const { sent, request } = recorder()
  // VIA 0x05: レイヤー、行、列、キーコード（上位バイト先）
  await setKeycode(request, 2, 1, 5, 0x5221)
  // Vial 0xFE 0x04: レイヤー、番号、方向（0 が左回し、1 が右回し）、キーコード（上位バイト先）
  await setEncoder(request, 3, 1, 0, 0x00e9)
  await setEncoder(request, 3, 1, 1, 0x12ab)
  // Vial 0xFE 0x0D 0x02: 番号、タップ、長押し、2回タップ、タップ後長押し、時間（どれも下位バイト先）
  await setTapDance(request, 7, { onTap: 0x0004, onHold: 0x00e0, onDoubleTap: 0x0229, onTapHold: 0x5221, tappingTerm: 250 })
  // Vial 0xFE 0x0D 0x04: 番号、同時に押すキー 4 つ、出力（どれも下位バイト先）
  await setCombo(request, 31, { keys: [0x0004, 0x2205, 0, 0], output: 0x0029 })

  expect(sent).toEqual([
    [0x05, 2, 1, 5, 0x52, 0x21],
    [0xfe, 0x04, 3, 1, 0, 0x00, 0xe9],
    [0xfe, 0x04, 3, 1, 1, 0x12, 0xab],
    [0xfe, 0x0d, 0x02, 7, 0x04, 0x00, 0xe0, 0x00, 0x29, 0x02, 0x21, 0x52, 0xfa, 0x00],
    [0xfe, 0x0d, 0x04, 31, 0x04, 0x00, 0x05, 0x22, 0x00, 0x00, 0x00, 0x00, 0x29, 0x00],
  ])
})

async function connect(state: SimulatedState = sampleState()) {
  const requests: number[][] = []
  const hidDevice = new FakeHidDevice((request) => {
    requests.push([...request])
    return respond(state, request)
  })
  const hid = new FakeHid()
  const device = await openVialDevice(hidDevice, hid, { timeoutMs: 20, settleMs: 5 })
  return { state, device, hid, hidDevice, requests }
}

/** キー、エンコーダーの両方向、Tap Dance、コンボを1つずつ変える操作 */
const OPERATIONS: WriteOperation[] = [
  { type: 'setTapDance', index: 1, entry: { onTap: 0x0007, onHold: 0x00e1, onDoubleTap: 0x0008, onTapHold: 0x5222, tappingTerm: 200 } },
  // レイヤー 1 の、行 1 列 2（2 行 3 列なので、キーの番号は 5）
  { type: 'setKey', layer: 1, key: 5, keycode: 0x5701 },
  { type: 'setKey', layer: 0, key: 0, keycode: 0x2c1d },
  { type: 'setEncoder', layer: 2, encoder: 0, direction: 'left', keycode: 0x00e9 },
  { type: 'setEncoder', layer: 2, encoder: 0, direction: 'right', keycode: 0x00ea },
  { type: 'setCombo', index: 0, entry: { keys: [0x0006, 0x0007, 0x0008, 0], output: 0x5701 } },
]

function expected(before: KeyboardSnapshot): KeyboardSnapshot {
  const after = structuredClone(before)
  after.tapDances[1] = { onTap: 0x0007, onHold: 0x00e1, onDoubleTap: 0x0008, onTapHold: 0x5222, tappingTerm: 200 }
  after.keymap[1][5] = 0x5701
  after.keymap[0][0] = 0x2c1d
  after.encoders[2][0] = [0x00e9, 0x00ea]
  after.combos[0] = { keys: [0x0006, 0x0007, 0x0008, 0], output: 0x5701 }
  return after
}

test('書いた後に読むと、書いた値が返る。触っていない所は変わらない', async () => {
  const { device } = await connect()
  const before = await device.read()
  const progress: [number, number][] = []
  await device.write(OPERATIONS, ({ done, total }) => progress.push([done, total]))

  expect(await device.read()).toEqual(expected(before))
  expect(progress).toEqual([1, 2, 3, 4, 5, 6].map((done) => [done, 6]))
})

test('渡された順に、1つずつ送る。キーの番号は、行と列に直す', async () => {
  const { device, requests } = await connect()
  await device.read()
  requests.length = 0
  await device.write(OPERATIONS)

  expect(requests.map((request) => request.slice(0, 7))).toEqual([
    [0xfe, 0x0d, 0x02, 1, 0x07, 0x00, 0xe1],
    [0x05, 1, 1, 2, 0x57, 0x01, 0],
    [0x05, 0, 0, 0, 0x2c, 0x1d, 0],
    [0xfe, 0x04, 2, 0, 0, 0x00, 0xe9],
    [0xfe, 0x04, 2, 0, 1, 0x00, 0xea],
    [0xfe, 0x0d, 0x04, 0, 0x06, 0x00, 0x07],
  ])
})

test.each(['zero', 'ff'] as const)('書くコマンドの応答の形（%s）で、成否を決めない', async (writeResponse) => {
  const { device } = await connect({ ...sampleState(), writeResponse })
  const before = await device.read()
  await device.write(OPERATIONS)
  expect(await device.read()).toEqual(expected(before))
})

test('書き込みが効かなくても、書き込みは失敗にしない（読み直した側が気づく）', async () => {
  const { device } = await connect({ ...sampleState(), ignoreWrites: true })
  const before = await device.read()
  await device.write(OPERATIONS)
  expect(await device.read()).toEqual(before)
})

test('途中で応答がなくなったら、何番目の操作かを添えて timeout で失敗する。それより前の操作は書けている', async () => {
  const state = sampleState()
  let silent = false
  const hidDevice = new (class extends FakeHidDevice {
    override async sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
      // 3つ目の操作（レイヤー 0 のキー）から、応答しなくなる
      if (data[0] === 0x05 && data[1] === 0) silent = true
      if (!silent) await super.sendReport(reportId, data)
    }
  })((request) => respond(state, request))
  const device = await openVialDevice(hidDevice, new FakeHid(), { timeoutMs: 20, settleMs: 5 })
  await device.read()
  const progress: number[] = []
  const error = await device.write(OPERATIONS, ({ done }) => progress.push(done)).catch((e: unknown) => e)

  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'timeout', operation: 2 })
  expect(progress).toEqual([1, 2])
  expect(state.tapDances[1].onTap).toBe(0x0007)
  expect(state.keymap[1][5]).toBe(0x5701)
  expect(state.keymap[0][0]).toBe(0x0004)
  expect(state.encoders[2][0]).toEqual([0x0001, 0x0001])
})

test('途中で機器がなくなったら、何番目の操作かを添えて disconnected で失敗する', async () => {
  const state = sampleState()
  const hid = new FakeHid()
  const hidDevice: FakeHidDevice = new FakeHidDevice((request) => {
    // 2つ目の操作を受け取った所で、機器がなくなる
    if (request[0] === 0x05) queueMicrotask(() => hid.disconnect(hidDevice))
    return respond(state, request)
  })
  const device = await openVialDevice(hidDevice, hid, { timeoutMs: 20, settleMs: 5 })
  await device.read()
  const error = await device.write(OPERATIONS).catch((e: unknown) => e)

  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'disconnected' })
  expect((error as DeviceError).operation).toBeGreaterThanOrEqual(1)
  expect((error as DeviceError).operation).toBeLessThanOrEqual(2)
})

test('送信に失敗したら、何番目の操作かを添えて send-failed で失敗する', async () => {
  const state = sampleState()
  let reading = true
  const hidDevice = new (class extends FakeHidDevice {
    override async sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
      if (!reading) throw new Error('NotAllowedError')
      await super.sendReport(reportId, data)
    }
  })((request) => respond(state, request))
  const device = await openVialDevice(hidDevice, new FakeHid(), { timeoutMs: 20, settleMs: 5 })
  await device.read()
  reading = false

  await expect(device.write(OPERATIONS)).rejects.toMatchObject({ kind: 'send-failed', operation: 0 })
})

test.each<[string, WriteOperation]>([
  ['本体にないレイヤー', { type: 'setKey', layer: 3, key: 0, keycode: 4 }],
  ['本体にないキー', { type: 'setKey', layer: 0, key: 6, keycode: 4 }],
  ['2 バイトに入らないキーコード', { type: 'setKey', layer: 0, key: 0, keycode: 0x10000 }],
  ['本体にないエンコーダー', { type: 'setEncoder', layer: 0, encoder: 1, direction: 'left', keycode: 4 }],
  ['本体にない Tap Dance の枠', { type: 'setTapDance', index: 2, entry: { onTap: 4, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 200 } }],
  ['本体にないコンボの枠', { type: 'setCombo', index: 1, entry: { keys: [4, 5, 0, 0], output: 6 } }],
])('%s を指す操作が混じっていたら、何も書かずに RangeError にする', async (_name, bad) => {
  const { device, state, requests } = await connect()
  await device.read()
  requests.length = 0
  await expect(device.write([OPERATIONS[1], bad])).rejects.toBeInstanceOf(RangeError)
  expect(requests).toEqual([])
  expect(state.keymap[1][5]).toBe(0x0000)
})

test('1回も読み出していない機器には、書けない（本体の構成が分からない）', async () => {
  const { device, requests } = await connect()
  requests.length = 0
  await expect(device.write(OPERATIONS)).rejects.toThrow('read')
  expect(requests).toEqual([])
})
