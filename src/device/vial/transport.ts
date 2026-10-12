// VIA / Vial の HID 通信。32 バイトの要求を1つ送り、32 バイトの応答を1つ受け取る
import { DeviceError } from '../types.ts'

export const REPORT_SIZE = 32

/** HIDDevice のうち transport が使う部分。テストでは偽物に差し替える */
export interface HidDeviceLike {
  sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void>
  addEventListener(type: 'inputreport', listener: (event: { data: DataView }) => void): void
  removeEventListener(type: 'inputreport', listener: (event: { data: DataView }) => void): void
}

export interface TransportOptions {
  /** 出力レポートの ID。レポート ID を使わない機器は 0 */
  reportId?: number
  /** 応答を待つ時間。Bluetooth は USB より遅い */
  timeoutMs?: number
  /** 応答がない時に送り直す回数 */
  retries?: number
  /** 診断用。要求を1回送るたびに、応答（タイムアウトなら null）と、かかった時間を知らせる */
  onExchange?: (request: Uint8Array, response: Uint8Array | null, ms: number) => void
}

interface Pending {
  resolve: (response: Uint8Array | null) => void
  reject: (error: DeviceError) => void
  timer: ReturnType<typeof setTimeout>
}

export class Transport {
  private readonly device: HidDeviceLike
  private readonly reportId: number
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly onExchange: TransportOptions['onExchange']
  private queue: Promise<unknown> = Promise.resolve()
  private pending: Pending | null = null
  // タイムアウトした要求への応答が、まだ届きうる数。応答には要求と結び付ける印がないので、
  // 次の要求を送る前に届くのを待って捨てる（次の要求の応答と取り違えないため）
  private lateResponses = 0
  private onLateResponsesDrained: (() => void) | null = null
  private closed = false

  constructor(device: HidDeviceLike, options: TransportOptions = {}) {
    this.device = device
    this.reportId = options.reportId ?? 0
    this.timeoutMs = options.timeoutMs ?? 1000
    this.retries = options.retries ?? 1
    this.onExchange = options.onExchange
    this.device.addEventListener('inputreport', this.handleInputReport)
  }

  /** 要求を送り、応答を返す。要求は呼ばれた順に1つずつ処理する */
  request(payload: ArrayLike<number>): Promise<Uint8Array> {
    const run = () => this.exchange(payload)
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  /** 以後の要求を受け付けない。待っている要求は disconnected で失敗する */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.device.removeEventListener('inputreport', this.handleInputReport)
    this.settle()?.reject(new DeviceError('disconnected'))
    this.onLateResponsesDrained?.()
  }

  private async exchange(payload: ArrayLike<number>): Promise<Uint8Array> {
    if (payload.length > REPORT_SIZE) {
      throw new RangeError(`要求は ${REPORT_SIZE} バイトまで（${payload.length} バイト）`)
    }
    const report = new Uint8Array(REPORT_SIZE)
    report.set(payload)

    await this.drainLateResponses()
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const startedAt = performance.now()
      const response = await this.sendAndWait(report)
      this.onExchange?.(report, response, performance.now() - startedAt)
      if (response) return response
      this.lateResponses++
    }
    throw new DeviceError('timeout')
  }

  private sendAndWait(report: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
    if (this.closed) return Promise.reject(new DeviceError('disconnected'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle()?.resolve(null), this.timeoutMs)
      this.pending = { resolve, reject, timer }
      this.device.sendReport(this.reportId, report).catch((cause: unknown) => {
        this.settle()?.reject(new DeviceError('send-failed', { cause }))
      })
    })
  }

  private settle(): Pending | null {
    const pending = this.pending
    if (!pending) return null
    clearTimeout(pending.timer)
    this.pending = null
    return pending
  }

  private async drainLateResponses(): Promise<void> {
    if (this.lateResponses === 0 || this.closed) return
    let timer: ReturnType<typeof setTimeout> | undefined
    await new Promise<void>((resolve) => {
      this.onLateResponsesDrained = resolve
      timer = setTimeout(resolve, this.timeoutMs)
    })
    clearTimeout(timer)
    this.onLateResponsesDrained = null
    this.lateResponses = 0
  }

  private readonly handleInputReport = (event: { data: DataView }): void => {
    const pending = this.settle()
    if (pending) {
      const { buffer, byteOffset, byteLength } = event.data
      pending.resolve(new Uint8Array(buffer.slice(byteOffset, byteOffset + byteLength)))
      return
    }
    if (this.lateResponses > 0 && --this.lateResponses === 0) {
      this.onLateResponsesDrained?.()
    }
  }
}
