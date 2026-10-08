import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { REPORT_SIZE, Transport, TransportError, type HidDeviceLike } from './transport.ts'

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
let device: FakeHidDevice
let transport: Transport

beforeEach(() => {
  vi.useFakeTimers()
  device = new FakeHidDevice()
  transport = new Transport(device, { timeoutMs: TIMEOUT })
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

test('応答がなければ1回だけ送り直し、その応答を返す', async () => {
  const result = transport.request([0x01])
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  expect(device.sent).toHaveLength(2)

  device.respond(0x01, 0x00, 0x09)
  expect((await result)[2]).toBe(0x09)
})

test('送り直しても応答がなければ timeout で失敗する', async () => {
  const result = transport.request([0x01])
  const assertion = expect(result).rejects.toMatchObject({ name: 'TransportError', kind: 'timeout' })
  await vi.advanceTimersByTimeAsync(TIMEOUT * 2)
  await assertion
  expect(device.sent).toHaveLength(2)
})

test('失敗した要求のあとも、次の要求を処理できる', async () => {
  const failed = transport.request([0x01])
  const assertion = expect(failed).rejects.toBeInstanceOf(TransportError)
  await vi.advanceTimersByTimeAsync(TIMEOUT * 2)
  await assertion

  const next = transport.request([0x02])
  // 遅れて届きうる応答を待つ時間が過ぎてから送られる
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  expect(device.sent.at(-1)?.data[0]).toBe(0x02)
  device.respond(0xb2)
  expect((await next)[0]).toBe(0xb2)
})

test('送り直しのあと遅れて届いた応答を、次の要求の応答と取り違えない', async () => {
  const first = transport.request([0x11])
  await vi.advanceTimersByTimeAsync(TIMEOUT)
  device.respond(0xa1) // 1回目か2回目のどちらかへの応答
  expect((await first)[0]).toBe(0xa1)

  const second = transport.request([0x12])
  await flush()
  // もう1つの応答が届くまで、次の要求は送らない
  expect(device.sent.map((s) => s.data[0])).toEqual([0x11, 0x11])

  device.respond(0xa1)
  await flush()
  expect(device.sent.map((s) => s.data[0])).toEqual([0x11, 0x11, 0x12])
  device.respond(0xa2)
  expect((await second)[0]).toBe(0xa2)
})

test('送信に失敗したら send-failed で失敗し、原因を保持する', async () => {
  device.failSend = true
  const error = await transport.request([0x01]).catch((e: unknown) => e)
  expect(error).toMatchObject({ name: 'TransportError', kind: 'send-failed' })
  expect((error as TransportError).cause).toBeInstanceOf(Error)
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
