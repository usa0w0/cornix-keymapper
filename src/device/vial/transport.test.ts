import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DeviceError } from '../types.ts'
import { REPORT_SIZE, Transport, type HidDeviceLike } from './transport.ts'

type Listener = (event: { data: DataView }) => void

/** 送られた要求を記録し、テストから好きな時に応答を返せる偽の HID 機器 */
class FakeHidDevice implements HidDeviceLike {
  sent: { reportId: number; data: Uint8Array }[] = []
  failSend = false
  private listeners = new Set<Listener>()

  async sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.failSend) throw new Error('NotAllowedError')
    this.sent.push({ reportId, data: data.slice() })
  }

  addEventListener(_type: 'inputreport', listener: Listener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'inputreport', listener: Listener): void {
    this.listeners.delete(listener)
  }

  respond(...bytes: number[]): void {
    const report = new Uint8Array(REPORT_SIZE)
    report.set(bytes)
    for (const listener of this.listeners) listener({ data: new DataView(report.buffer) })
  }
}

const TIMEOUT = 1000
const SETTLE = 200
let device: FakeHidDevice
let transport: Transport

beforeEach(() => {
  vi.useFakeTimers()
  device = new FakeHidDevice()
  transport = new Transport(device, { timeoutMs: TIMEOUT, settleMs: SETTLE })
})

afterEach(() => {
  vi.useRealTimers()
})

// 要求の送信までには await が挟まるので、待ち時間 0 で進めてから応答を返す
const flush = () => vi.advanceTimersByTimeAsync(0)

test('要求を 32 バイトに詰めて送り、応答を返す', async () => {
  const result = transport.request([0x01])
  await flush()
  expect(device.sent).toHaveLength(1)
  expect(device.sent[0].reportId).toBe(0)
  expect(device.sent[0].data).toHaveLength(REPORT_SIZE)
  expect(Array.from(device.sent[0].data.slice(0, 2))).toEqual([0x01, 0x00])

  device.respond(0x01, 0x00, 0x09)
  const response = await result
  expect(response).toHaveLength(REPORT_SIZE)
  expect(Array.from(response.slice(0, 3))).toEqual([0x01, 0x00, 0x09])
})

test('指定したレポート ID で送る', async () => {
  transport = new Transport(device, { reportId: 4 })
  const result = transport.request([0x01])
  await flush()
  device.respond(0x01)
  await result
  expect(device.sent[0].reportId).toBe(4)
})

test('32 バイトを超える要求は送らずに失敗する', async () => {
  await expect(transport.request(new Uint8Array(REPORT_SIZE + 1))).rejects.toThrow(RangeError)
  expect(device.sent).toHaveLength(0)
})

test('要求は1つずつ順に送り、前の応答が来るまで次を送らない', async () => {
  const first = transport.request([0x11])
  const second = transport.request([0x12])
  await flush()
  expect(device.sent.map((s) => s.data[0])).toEqual([0x11])

  device.respond(0xa1)
  await flush()
  expect(device.sent.map((s) => s.data[0])).toEqual([0x11, 0x12])

  device.respond(0xa2)
  expect((await first)[0]).toBe(0xa1)
  expect((await second)[0]).toBe(0xa2)
})

const sentCommands = () => device.sent.map((s) => s.data[0])

test('応答がなければ、同期をやり直してから1回だけ送り直し、その応答を返す', async () => {
  const result = transport.request([0xfe, 0x00])
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  // 同期のやり直しの VIA 0x01 を先に送る
  expect(sentCommands()).toEqual([0xfe, 0x01])

  device.respond(0x01, 0x00, 0x09)
  await flush()
  // 0x01 の応答の後、ほかの応答が届かないことを確かめる間は、送り直さない
  expect(sentCommands()).toEqual([0xfe, 0x01])
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(sentCommands()).toEqual([0xfe, 0x01, 0xfe])

  device.respond(0x06, 0x00, 0x09)
  expect((await result)[0]).toBe(0x06)
  expect(transport.timeoutCount).toBe(1)
})

test('同期をやり直しても応答がなければ timeout で失敗する', async () => {
  const result = transport.request([0x11])
  const assertion = expect(result).rejects.toMatchObject({ name: 'DeviceError', kind: 'timeout' })
  await vi.advanceTimersByTimeAsync(TIMEOUT * 2)
  await assertion
  expect(sentCommands()).toEqual([0x11, 0x01])
})

test('同期をやり直した後に送り直しても応答がなければ timeout で失敗する', async () => {
  const result = transport.request([0x11])
  const assertion = expect(result).rejects.toMatchObject({ name: 'DeviceError', kind: 'timeout' })
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  device.respond(0x01)
  await vi.advanceTimersByTimeAsync(SETTLE + TIMEOUT)
  await assertion
  expect(sentCommands()).toEqual([0x11, 0x01, 0x11])
})

test('応答が待ち時間を超えて遅れて届いても、次の要求の応答と取り違えない', async () => {
  // Vial のコマンドの応答は、要求と突き合わせられない
  const result = transport.request([0xfe, 0x03])
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  expect(sentCommands()).toEqual([0xfe, 0x01])

  // 遅れていた応答が、同期のやり直しの間に届く。先頭が 0x01 でないので捨てる
  device.respond(0xa1)
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(sentCommands()).toEqual([0xfe, 0x01])

  device.respond(0x01, 0x00, 0x09)
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(sentCommands()).toEqual([0xfe, 0x01, 0xfe])
  device.respond(0xa2)
  expect((await result)[0]).toBe(0xa2)

  const next = transport.request([0xfe, 0x05])
  await flush()
  device.respond(0xa3)
  expect((await next)[0]).toBe(0xa3)
})

test('遅れて届いた応答の先頭が 0x01 でも、同期のやり直しの応答と取り違えない', async () => {
  const result = transport.request([0xfe, 0x05])
  await vi.advanceTimersByTimeAsync(TIMEOUT)

  // 遅れていた Vial の応答が、たまたま 0x01 で始まる。続けて、同期のやり直しへの応答が届く
  device.respond(0x01, 0x00)
  await vi.advanceTimersByTimeAsync(SETTLE - 1)
  device.respond(0x01, 0x00, 0x09)
  await vi.advanceTimersByTimeAsync(SETTLE - 1)
  // 最後の応答から、まだ待ち切っていない
  expect(sentCommands()).toEqual([0xfe, 0x01])
  await vi.advanceTimersByTimeAsync(1)
  expect(sentCommands()).toEqual([0xfe, 0x01, 0xfe])

  device.respond(0x00, 0x00)
  expect(Array.from((await result).slice(0, 2))).toEqual([0x00, 0x00])
})

test('タイムアウトの後、同期をやり直してから次の要求を送る', async () => {
  const failed = transport.request([0x11])
  const assertion = expect(failed).rejects.toBeInstanceOf(DeviceError)
  await vi.advanceTimersByTimeAsync(TIMEOUT * 2)
  await assertion
  device.sent = []

  const next = transport.request([0x12])
  await flush()
  // 次の要求より前に VIA 0x01 を送り、その応答が返るまで、次の要求は送らない
  expect(sentCommands()).toEqual([0x01])
  // 失敗した要求への応答が、いまごろ届く
  device.respond(0x11, 0x04)
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(sentCommands()).toEqual([0x01])

  device.respond(0x01, 0x00, 0x09)
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(sentCommands()).toEqual([0x01, 0x12])
  device.respond(0xb2)
  expect((await next)[0]).toBe(0xb2)
})

test('要求と同じ内容を返すコマンドは、先頭が合わない応答を捨てて、合う応答を待つ', async () => {
  const result = transport.request([0x12, 0x00, 0x1c, 0x1c], 4)
  await flush()
  // コマンド番号は同じでも、位置が違う（前の要求への応答）
  device.respond(0x12, 0x00, 0x00, 0x1c, 0xaa)
  device.respond(0x12, 0x00, 0x1c, 0x1c, 0xbb)
  expect((await result)[4]).toBe(0xbb)
  expect(transport.strayCount).toBe(1)
  expect(transport.timeoutCount).toBe(0)
})

test('待っている要求がない時に応答が届いたら数え、次の要求の前に同期をやり直す', async () => {
  const strays: number[] = []
  transport = new Transport(device, { timeoutMs: TIMEOUT, settleMs: SETTLE, onStray: (r) => strays.push(r[0]) })
  device.respond(0xa1)
  expect(transport.strayCount).toBe(1)
  expect(strays).toEqual([0xa1])

  const result = transport.request([0xfe, 0x00])
  await flush()
  expect(sentCommands()).toEqual([0x01])
  device.respond(0x01)
  await vi.advanceTimersByTimeAsync(SETTLE)
  device.respond(0x06)
  expect((await result)[0]).toBe(0x06)
  // 同期のやり直しは、数に入れない
  expect(transport.strayCount).toBe(1)
})

test('同期のやり直しは、0x01 でない応答が届き続けたら unexpected-response で失敗する', async () => {
  device.respond(0xa1)
  const result = transport.request([0xfe, 0x00])
  const assertion = expect(result).rejects.toMatchObject({ kind: 'unexpected-response' })
  for (let elapsed = 0; elapsed < TIMEOUT; elapsed += 100) {
    await vi.advanceTimersByTimeAsync(100)
    device.respond(0xa1)
  }
  await assertion
  expect(sentCommands()).toEqual([0x01])
})

test('同期のやり直しは、0x01 の応答が届き続けても、待ち時間のうちに終わる', async () => {
  device.respond(0xa1)
  const result = transport.request([0xfe, 0x00])
  const assertion = expect(result).rejects.toMatchObject({ kind: 'unexpected-response' })
  // ほかのタブが VIA 0x01 を送り続けている時など
  for (let elapsed = 0; elapsed < TIMEOUT + SETTLE; elapsed += SETTLE / 2) {
    await vi.advanceTimersByTimeAsync(SETTLE / 2)
    device.respond(0x01)
  }
  await assertion
  expect(sentCommands()).toEqual([0x01])
})

test('同期のやり直しに失敗した後の要求は、もう一度同期をやり直す', async () => {
  const failed = transport.request([0x11])
  const assertion = expect(failed).rejects.toBeInstanceOf(DeviceError)
  await vi.advanceTimersByTimeAsync(TIMEOUT * 2)
  await assertion

  const again = transport.request([0x11], 1)
  const againAssertion = expect(again).rejects.toMatchObject({ kind: 'timeout' })
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  await againAssertion
  expect(sentCommands()).toEqual([0x11, 0x01, 0x01])
})

test('同期のやり直しの間に close すると、disconnected で失敗する', async () => {
  const result = transport.request([0x11])
  const assertion = expect(result).rejects.toMatchObject({ kind: 'disconnected' })
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  expect(sentCommands()).toEqual([0x11, 0x01])
  transport.close()
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})

test('送信に失敗したら send-failed で失敗し、原因を保持する', async () => {
  device.failSend = true
  const error = await transport.request([0x01]).catch((e: unknown) => e)
  expect(error).toMatchObject({ name: 'DeviceError', kind: 'send-failed' })
  expect((error as DeviceError).cause).toBeInstanceOf(Error)
})

test('close すると、待っている要求と以後の要求が disconnected で失敗する', async () => {
  const waiting = transport.request([0x01])
  const queued = transport.request([0x02])
  await flush()
  transport.close()

  await expect(waiting).rejects.toMatchObject({ kind: 'disconnected' })
  await expect(queued).rejects.toMatchObject({ kind: 'disconnected' })
  await expect(transport.request([0x03])).rejects.toMatchObject({ kind: 'disconnected' })
  expect(device.sent).toHaveLength(1)
})
