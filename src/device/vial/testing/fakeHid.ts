// テスト用。偽の HID 機器と、偽の navigator.hid
import { REPORT_SIZE, type HidDeviceLike } from '../transport.ts'
import type { HidEvents, RawHidDevice } from '../vialDevice.ts'

export const collection = (usagePage: number, usage: number, reportId?: number): HIDCollectionInfo => ({
  usagePage,
  usage,
  outputReports: reportId === undefined ? [] : [{ reportId }],
})

type InputListener = (event: { data: DataView }) => void

/** 要求を受けるたびに、決めた応答を返す偽の HID 機器 */
export class FakeHidDevice implements RawHidDevice, HidDeviceLike {
  opened = false
  productName = 'Cornix'
  collections = [collection(0xff60, 0x61)]
  private listeners = new Set<InputListener>()
  protected readonly reply: (request: Uint8Array) => Uint8Array

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
    queueMicrotask(() => this.deliver(report))
  }

  protected deliver(report: Uint8Array): void {
    for (const listener of this.listeners) listener({ data: new DataView(report.buffer) })
  }

  addEventListener(_type: 'inputreport', listener: InputListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'inputreport', listener: InputListener): void {
    this.listeners.delete(listener)
  }
}

/** 切断のイベントを、テストから起こせる偽の navigator.hid */
export class FakeHid implements HidEvents {
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
