import { expect, test } from 'vitest'
import { DeviceError } from '../types.ts'
import { findReportId, openVialDevice } from './connect.ts'
import { REPORT_SIZE, type HidDeviceLike } from './transport.ts'
import type { HidEvents, RawHidDevice } from './vialDevice.ts'

const collection = (usagePage: number, usage: number, reportId?: number): HIDCollectionInfo => ({
  usagePage,
  usage,
  outputReports: reportId === undefined ? [] : [{ reportId }],
})

type InputListener = (event: { data: DataView }) => void

/** 要求を受けるたびに、決めた応答を返す偽の HID 機器 */
class FakeHidDevice implements RawHidDevice, HidDeviceLike {
  opened = false
  productName = 'Cornix'
  collections = [collection(0xff60, 0x61)]
  private listeners = new Set<InputListener>()
  private readonly response: number[]

  constructor(response: number[]) {
    this.response = response
  }

  async open(): Promise<void> {
    this.opened = true
  }

  async close(): Promise<void> {
    this.opened = false
  }

  async sendReport(): Promise<void> {
    const report = new Uint8Array(REPORT_SIZE)
    report.set(this.response)
    queueMicrotask(() => {
      for (const listener of this.listeners) listener({ data: new DataView(report.buffer) })
    })
  }

  addEventListener(_type: 'inputreport', listener: InputListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'inputreport', listener: InputListener): void {
    this.listeners.delete(listener)
  }
}

/** 切断のイベントを、テストから起こせる偽の navigator.hid */
class FakeHid implements HidEvents {
  private listeners = new Set<(event: { device: unknown }) => void>()

  addEventListener(_type: 'disconnect', listener: (event: { device: unknown }) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'disconnect', listener: (event: { device: unknown }) => void): void {
    this.listeners.delete(listener)
  }

  disconnect(device: unknown): void {
    for (const listener of [...this.listeners]) listener({ device })
  }
}

test('Raw HID の出力レポートの ID を返す', () => {
  const device = { collections: [collection(0x01, 0x06, 1), collection(0xff60, 0x61, 4)] }
  expect(findReportId(device)).toBe(4)
})

test('出力レポートの情報がなければ 0 を返す', () => {
  expect(findReportId({ collections: [collection(0xff60, 0x61)] })).toBe(0)
  expect(findReportId({ collections: [] })).toBe(0)
})

test('応答の先頭が 0x01 なら接続し、機器名と VIA の版を持つ', async () => {
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, new FakeHid())
  expect(hidDevice.opened).toBe(true)
  expect(device.name).toBe('Cornix')
  expect(device.protocol).toBe('VIA プロトコル 9')
})

test('応答の先頭が 0x01 でなければ unexpected-response で失敗し、機器を閉じる', async () => {
  const hidDevice = new FakeHidDevice([0x12, 0x00, 0x09])
  const error = await openVialDevice(hidDevice, new FakeHid()).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'unexpected-response' })
  expect(hidDevice.opened).toBe(false)
})

test('機器がなくなると、切断を1回だけ知らせる。別の機器の切断では知らせない', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)
  let notified = 0
  device.onDisconnect(() => notified++)

  hid.disconnect({})
  expect(notified).toBe(0)
  hid.disconnect(hidDevice)
  hid.disconnect(hidDevice)
  expect(notified).toBe(1)
})

test('こちらから切断した後は、切断を知らせない', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)
  let notified = 0
  device.onDisconnect(() => notified++)

  await device.disconnect()
  expect(hidDevice.opened).toBe(false)
  hid.disconnect(hidDevice)
  expect(notified).toBe(0)
})
