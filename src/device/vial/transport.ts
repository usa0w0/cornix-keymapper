// VIA / Vial の HID 通信。32 バイトの要求を1つ送り、32 バイトの応答を1つ受け取る
import { DeviceError } from '../types.ts'

export const REPORT_SIZE = 32

/** 同期のやり直しに使う、VIA のプロトコルの版を読むコマンド。応答の先頭は同じ 0x01 */
const SYNC_PROBE = 0x01

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
  /** 同期のやり直しで、0x01 の応答の後に、ほかの応答が届かないことを確かめる時間。省くと timeoutMs と同じ */
  settleMs?: number
  /** 応答がない時に送り直す回数 */
  retries?: number
  /** 診断用。要求を1回送るたびに、応答（タイムアウトなら null）と、かかった時間を知らせる */
  onExchange?: (request: Uint8Array, response: Uint8Array | null, ms: number) => void
  /** 診断用。待っている要求がない時に届いた応答と、要求と合わずに捨てた応答を知らせる */
  onStray?: (response: Uint8Array) => void
}

interface Pending {
  /** 届いた応答を受け取る */
  onResponse: (response: Uint8Array) => void
  reject: (error: DeviceError) => void
  /** 待つのをやめる時に、タイマーを止める */
  stop: () => void
}

export class Transport {
  private readonly device: HidDeviceLike
  private readonly reportId: number
  private readonly timeoutMs: number
  private readonly settleMs: number
  private readonly retries: number
  private readonly onExchange: TransportOptions['onExchange']
  private readonly onStray: TransportOptions['onStray']
  private queue: Promise<unknown> = Promise.resolve()
  private pending: Pending | null = null
  // 応答には要求と結び付ける印がない。タイムアウトした要求への応答や、こちらが送っていない要求への応答が
  // 後から届きうる間は、次の要求を送る前に同期をやり直す（次の要求の応答と取り違えないため）
  private desynced = false
  private timeouts = 0
  private strays = 0
  private closed = false

  constructor(device: HidDeviceLike, options: TransportOptions = {}) {
    this.device = device
    this.reportId = options.reportId ?? 0
    this.timeoutMs = options.timeoutMs ?? 1000
    this.settleMs = options.settleMs ?? this.timeoutMs
    this.retries = options.retries ?? 1
    this.onExchange = options.onExchange
    this.onStray = options.onStray
    this.device.addEventListener('inputreport', this.handleInputReport)
  }

  /** 応答を待ち時間の中で受け取れなかった回数。接続してからの通し */
  get timeoutCount(): number {
    return this.timeouts
  }

  /** 待っている要求がない時に届いた応答と、要求と合わずに捨てた応答の数。接続してからの通し */
  get strayCount(): number {
    return this.strays
  }

  /**
   * 要求を送り、応答を返す。要求は呼ばれた順に1つずつ処理する。
   * echo は、応答の先頭が要求と同じ内容になるバイト数。指定すると、合わない応答を捨てて待ち続ける
   */
  request(payload: ArrayLike<number>, echo = 0): Promise<Uint8Array> {
    const run = () => this.exchange(payload, echo)
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  /** 次の要求の前に、同期をやり直させる。応答がずれていると、呼び出し側が気づいた時に使う */
  requireResync(): void {
    this.desynced = true
  }

  /** 以後の要求を受け付けない。待っている要求は disconnected で失敗する */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.device.removeEventListener('inputreport', this.handleInputReport)
    this.finish()?.reject(new DeviceError('disconnected'))
  }

  private async exchange(payload: ArrayLike<number>, echo: number): Promise<Uint8Array> {
    if (payload.length > REPORT_SIZE) {
      throw new RangeError(`要求は ${REPORT_SIZE} バイトまで（${payload.length} バイト）`)
    }
    const report = new Uint8Array(REPORT_SIZE)
    report.set(payload)

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (this.desynced) await this.resync()
      const startedAt = performance.now()
      const response = await this.sendAndWait(report, echo)
      this.onExchange?.(report, response, performance.now() - startedAt)
      if (response) return response
      this.timeouts++
      this.desynced = true
    }
    throw new DeviceError('timeout')
  }

  private sendAndWait(report: Uint8Array<ArrayBuffer>, echo: number): Promise<Uint8Array | null> {
    if (this.closed) return Promise.reject(new DeviceError('disconnected'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finish()
        resolve(null)
      }, this.timeoutMs)
      const pending: Pending = {
        onResponse: (response) => {
          // 前の要求への応答が遅れて届いたもの。捨てて、この要求への応答を待ち続ける
          if (!report.subarray(0, echo).every((byte, i) => response[i] === byte)) {
            this.stray(response)
            return
          }
          this.finish()
          resolve(response)
        },
        reject,
        stop: () => clearTimeout(timer),
      }
      this.send(report, pending)
    })
  }

  /**
   * 同期のやり直し。VIA 0x01 を送り、先頭が 0x01 の応答が返るまで、届いた応答を捨てる。
   * 機器は要求の順に応答するので、0x01 への応答が届けば、それより前の要求への応答は残っていない。
   * ただし、前の要求への応答も先頭が 0x01 になりうる（前の要求が 0x01 だった時や、Vial の応答のデータ）。
   * それと取り違えないよう、0x01 の応答の後、settleMs の間ほかの応答が届かないことを確かめる。
   * 終わり方は次の3つで、長くても timeoutMs + settleMs で終わる
   * - 最後に届いた応答の先頭が 0x01 で、その後 settleMs の間、何も届かない: 同期できた
   * - timeoutMs たっても、最後に届いた応答の先頭が 0x01 でない（何も届かない時を含む）: 失敗
   * - timeoutMs を過ぎてから、さらに応答が届いた: 失敗（応答が流れ続けている）
   */
  private resync(): Promise<void> {
    if (this.closed) return Promise.reject(new DeviceError('disconnected'))
    const probe = new Uint8Array(REPORT_SIZE)
    probe[0] = SYNC_PROBE
    const startedAt = performance.now()
    return new Promise((resolve, reject) => {
      let received = false
      let synced = false
      let overdue = false
      // 0x01 への応答かもしれない、最後に届いた応答
      let candidate: Uint8Array | null = null
      let settle: ReturnType<typeof setTimeout> | undefined
      const fail = () => {
        this.finish()
        this.onExchange?.(probe, null, performance.now() - startedAt)
        if (!received) this.timeouts++
        // 何か届いているのに同期できないのは、ほかのアプリやタブへの応答が流れている時
        reject(new DeviceError(received ? 'unexpected-response' : 'timeout'))
      }
      const deadline = setTimeout(() => {
        overdue = true
        if (!synced) fail()
      }, this.timeoutMs)
      const pending: Pending = {
        onResponse: (response) => {
          received = true
          clearTimeout(settle)
          if (overdue) {
            fail()
            return
          }
          // 捨てる応答も、診断のために知らせる（待っていた応答の遅れなので、strayCount には数えない）
          if (candidate) this.onStray?.(candidate)
          synced = response[0] === SYNC_PROBE
          candidate = synced ? response : null
          if (!synced) {
            this.onStray?.(response)
            return
          }
          const ms = performance.now() - startedAt
          settle = setTimeout(() => {
            this.finish()
            this.desynced = false
            this.onExchange?.(probe, response, ms)
            resolve()
          }, this.settleMs)
        },
        reject,
        stop: () => {
          clearTimeout(deadline)
          clearTimeout(settle)
        },
      }
      this.send(probe, pending)
    })
  }

  private send(report: Uint8Array<ArrayBuffer>, pending: Pending): void {
    this.pending = pending
    this.device.sendReport(this.reportId, report).catch((cause: unknown) => {
      // すでに終わった要求の送信の失敗で、後の要求を失敗させない
      if (this.pending !== pending) return
      this.finish()?.reject(new DeviceError('send-failed', { cause }))
    })
  }

  private finish(): Pending | null {
    const pending = this.pending
    if (!pending) return null
    pending.stop()
    this.pending = null
    return pending
  }

  private stray(response: Uint8Array): void {
    this.strays++
    this.onStray?.(response)
  }

  private readonly handleInputReport = (event: { data: DataView }): void => {
    const { buffer, byteOffset, byteLength } = event.data
    const response = new Uint8Array(buffer.slice(byteOffset, byteOffset + byteLength))
    if (this.pending) {
      this.pending.onResponse(response)
      return
    }
    // 待っている要求がないのに届いた応答。この後も続くかもしれないので、次の要求の前に同期をやり直す
    this.desynced = true
    this.stray(response)
  }
}
