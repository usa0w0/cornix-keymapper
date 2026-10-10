import { expect, test } from 'vitest'
import { DeviceError } from '../types.ts'
import { findReportId, openVialDevice } from './connect.ts'
import { REPORT_SIZE, type HidDeviceLike } from './transport.ts'
import { sampleState } from './testing/sampleState.ts'
import { definitionJson } from './testing/definitionFixture.ts'
import { respond } from './testing/simulatedKeyboard.ts'
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
  private readonly reply: (request: Uint8Array) => Uint8Array

  constructor(reply: number[] | ((request: Uint8Array) => Uint8Array)) {
    this.reply =
      typeof reply === 'function'
        ? reply
        : () => {
            const report = new Uint8Array(REPORT_SIZE)
            report.set(reply)
            return report
          }
  }

  async open(): Promise<void> {
    this.opened = true
  }

  async close(): Promise<void> {
    this.opened = false
  }

  async sendReport(_reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const report = this.reply(data)
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

test('本体の設定をまとめて読み、進み具合を知らせ、通信を記録する', async () => {
  const state = sampleState()
  const device = await openVialDevice(new FakeHidDevice((request) => respond(state, request)), new FakeHid())
  const steps: string[] = []
  const snapshot = await device.read((progress) => steps.push(progress.step))

  expect(snapshot).toEqual({
    uid: '0123456789abcdef',
    layout: { rows: 2, cols: 3, encoderCount: 1, raw: definitionJson },
    capabilities: { viaProtocol: 9, vialProtocol: 6, layerCount: 3, tapDanceCount: 2, comboCount: 1 },
    keymap: state.keymap,
    encoders: state.encoders,
    tapDances: state.tapDances,
    combos: state.combos,
  })
  expect(new Set(steps)).toContain('キーマップ')
  const exchanges = device.exchanges()
  expect(exchanges[0]).toMatchObject({ request: expect.stringMatching(/^01/), response: expect.stringMatching(/^010009/) })
  expect(exchanges.length).toBeGreaterThan(10)
})

test('読み出しの途中で失敗したら、どこで失敗したかを添えて失敗する', async () => {
  const state = { ...sampleState(), failTapDanceAt: 1 }
  const device = await openVialDevice(new FakeHidDevice((request) => respond(state, request)), new FakeHid())
  const error = await device.read().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'unexpected-response', step: 'Tap Dance' })

test('切断の登録より前に機器がなくなっていたら、登録した時にすぐ知らせる', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)

  hid.disconnect(hidDevice)
  let notified = 0
  device.onDisconnect(() => notified++)
  expect(notified).toBe(1)
})

test('こちらから切断した後に登録しても、切断を知らせない', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)

  await device.disconnect()
  hid.disconnect(hidDevice)
  let notified = 0
  device.onDisconnect(() => notified++)
  expect(notified).toBe(0)
})
