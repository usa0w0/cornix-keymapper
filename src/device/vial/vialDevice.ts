// KeyboardDevice の Vial 版
import {
  DeviceError,
  type ComboEntry,
  type ExchangeRecord,
  type KeyboardDevice,
  type KeyboardSnapshot,
  type ReadProgress,
  type TapDanceEntry,
  type WriteOperation,
  type WriteProgress,
} from '../types.ts'
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
  setCombo,
  setEncoder,
  setKeycode,
  setTapDance,
  type Requester,
} from './commands.ts'
import { decompressDefinition, parseDefinition } from './definition.ts'
import type { Transport } from './transport.ts'

/** 通信の記録を持つ数。古いものから捨てる */
const MAX_EXCHANGES = 5000

/** 応答の遅れなどで読み出しを最初からやり直す回数の上限。超えたら、読み出しを失敗にする */
const MAX_READ_RESTARTS = 2

// 画面には「「…」を読んでいます」と出る
const SYNC_CHECK_STEP = 'VIA の版（読み出しの確認）'

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** 診断用の通信の記録。Transport の onExchange に record を渡して使う */
export class ExchangeLog {
  private readonly records: ExchangeRecord[] = []
  private readonly capacity: number
  // 古いものから捨てた数。記録の通し番号を、捨てた後も変えないために持つ
  private dropped = 0

  constructor(capacity = MAX_EXCHANGES) {
    this.capacity = capacity
  }

  readonly record = (request: Uint8Array, response: Uint8Array | null, ms: number): void => {
    this.push({ request: toHex(request), response: response && toHex(response), ms: Math.round(ms) })
  }

  /** どの要求への応答でもないとして捨てた応答。要求を空にして記録する。Transport の onStray に渡して使う */
  readonly recordStray = (response: Uint8Array): void => {
    this.push({ request: '', response: toHex(response), ms: 0 })
  }

  private push(record: ExchangeRecord): void {
    this.records.push(record)
    if (this.records.length > this.capacity) {
      this.records.shift()
      this.dropped++
    }
  }

  /** これまでに記録した数。捨てた分も数える */
  count(): number {
    return this.dropped + this.records.length
  }

  /** 通し番号が since 以降の記録。すでに捨てた分は含まれない */
  list(since = 0): ExchangeRecord[] {
    return this.records.slice(Math.max(0, since - this.dropped))
  }
}

/** HIDDevice のうち、接続と切断に使う部分 */
export interface RawHidDevice {
  readonly opened: boolean
  readonly productName: string
  readonly collections: readonly HIDCollectionInfo[]
  open(): Promise<void>
  close(): Promise<void>
}

type HidDisconnectListener = (event: { device: unknown }) => void

/** navigator.hid のうち、切断の検知に使う部分 */
export interface HidEvents {
  addEventListener(type: 'disconnect', listener: HidDisconnectListener): void
  removeEventListener(type: 'disconnect', listener: HidDisconnectListener): void
}

/** 本体の構成のうち、書く場所を確かめるのに使う数 */
interface DeviceShape {
  layerCount: number
  rows: number
  cols: number
  encoderCount: number
  tapDanceCount: number
  comboCount: number
}

const isIndex = (value: number, count: number) => Number.isInteger(value) && value >= 0 && value < count
// キーコードと時間の値は、2 バイトで送る
const isU16 = (value: number) => isIndex(value, 0x10000)

/** 操作が、本体にある場所を指していて、送れる値か */
function fits(shape: DeviceShape, operation: WriteOperation): boolean {
  switch (operation.type) {
    case 'setKey':
      return (
        isIndex(operation.layer, shape.layerCount) &&
        isIndex(operation.key, shape.rows * shape.cols) &&
        isU16(operation.keycode)
      )
    case 'setEncoder':
      return (
        isIndex(operation.layer, shape.layerCount) &&
        isIndex(operation.encoder, shape.encoderCount) &&
        isU16(operation.keycode)
      )
    case 'setTapDance': {
      const { onTap, onHold, onDoubleTap, onTapHold, tappingTerm } = operation.entry
      return isIndex(operation.index, shape.tapDanceCount) && [onTap, onHold, onDoubleTap, onTapHold, tappingTerm].every(isU16)
    }
    case 'setCombo':
      return (
        isIndex(operation.index, shape.comboCount) &&
        operation.entry.keys.length === 4 &&
        [...operation.entry.keys, operation.entry.output].every(isU16)
      )
  }
}

function send(request: Requester, shape: DeviceShape, operation: WriteOperation): Promise<void> {
  switch (operation.type) {
    case 'setKey':
      // キーの番号は、行 × 列数 + 列
      return setKeycode(request, operation.layer, Math.floor(operation.key / shape.cols), operation.key % shape.cols, operation.keycode)
    case 'setEncoder':
      return setEncoder(request, operation.layer, operation.encoder, operation.direction === 'left' ? 0 : 1, operation.keycode)
    case 'setTapDance':
      return setTapDance(request, operation.index, operation.entry)
    case 'setCombo':
      return setCombo(request, operation.index, operation.entry)
  }
}

export class VialDevice implements KeyboardDevice {
  readonly name: string
  readonly protocol: string
  readonly transport: Transport
  private readonly device: RawHidDevice
  private readonly hid: HidEvents
  private readonly listeners = new Set<() => void>()
  private readonly log: ExchangeLog
  private closed = false
  // こちらから切断したのではなく、機器がなくなった
  private lost = false
  // 最後に読み終えた本体の構成。書く場所が本体にあるかを確かめるのと、キーの番号を行と列に直すのに使う
  private shape: DeviceShape | null = null

  constructor(
    device: RawHidDevice,
    hid: HidEvents,
    transport: Transport,
    viaProtocolVersion: number,
    log: ExchangeLog,
  ) {
    this.device = device
    this.hid = hid
    this.transport = transport
    this.log = log
    this.name = device.productName || '名前のない機器'
    this.protocol = `VIA プロトコル ${viaProtocolVersion}`
    this.hid.addEventListener('disconnect', this.handleDisconnect)
  }

  onDisconnect(listener: () => void): () => void {
    // 接続してから登録までの間に機器がなくなっていたら、すぐ知らせる
    if (this.lost) {
      listener()
      return () => {}
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  exchangeCount(): number {
    return this.log.count()
  }

  exchanges(since?: number): ExchangeRecord[] {
    return this.log.list(since)
  }

  /**
   * 読み出しの途中で、応答が待ち時間を超えて遅れた時と、どの要求のものでもない応答が届いた時は、
   * それまでに読んだ内容に取り違えた応答が混じっているおそれがあるので、捨てて最初からやり直す
   */
  async read(onProgress?: (progress: ReadProgress) => void): Promise<KeyboardSnapshot> {
    for (let restarts = 0; ; restarts++) {
      const { timeoutCount, strayCount } = this.transport
      let failure: unknown
      try {
        const snapshot = await this.readOnce(onProgress)
        if (snapshot) return snapshot
        failure = new DeviceError('unexpected-response', { step: SYNC_CHECK_STEP })
      } catch (error) {
        const disturbed =
          this.transport.timeoutCount !== timeoutCount || this.transport.strayCount !== strayCount
        const retryable =
          error instanceof DeviceError && (error.kind === 'timeout' || error.kind === 'unexpected-response')
        // 応答の遅れなどが起きていない失敗は、やり直しても同じ結果になる
        if (!disturbed || !retryable) throw error
        failure = error
      }
      if (restarts >= MAX_READ_RESTARTS) throw failure
    }
  }

  /** 1回ぶんの読み出し。最後の確認で、応答がずれていたと分かった時は null */
  private async readOnce(onProgress?: (progress: ReadProgress) => void): Promise<KeyboardSnapshot | null> {
    const { timeoutCount, strayCount } = this.transport
    const request: Requester = async (payload, echo) => {
      const response = await this.transport.request(payload, echo)
      // 送り直しで応答が得られても、この読み出しは使わない
      if (this.transport.timeoutCount !== timeoutCount) throw new DeviceError('timeout')
      if (this.transport.strayCount !== strayCount) throw new DeviceError('unexpected-response')
      return response
    }
    let step = ''
    // 失敗した時に、どこを読んでいたかを添える
    const during = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
      step = name
      onProgress?.({ step, done: 0, total: 1 })
      return run()
    }
    const report = (done: number, total: number) => onProgress?.({ step, done, total })
    const unexpected = () => new DeviceError('unexpected-response', { step })

    try {
      const viaProtocol = await during('VIA の版', () => getViaProtocolVersion(request))
      const { vialProtocol, uid } = await during('Vial の版と UID', () => getKeyboardId(request))
      const layout = await during('レイアウト定義', async () => {
        const compressed = await getCompressedDefinition(request, report)
        try {
          return parseDefinition(await decompressDefinition(compressed))
        } catch (cause) {
          throw new DeviceError('unexpected-response', { step, cause })
        }
      })
      const layerCount = await during('レイヤー数', () => getLayerCount(request))
      const keymap = await during('キーマップ', () =>
        getKeymap(request, layerCount, layout.rows, layout.cols, report),
      )

      const encoders = await during('エンコーダー', async () => {
        const result: [number, number][][] = []
        const total = layerCount * layout.encoderCount
        for (let layer = 0; layer < layerCount; layer++) {
          const row: [number, number][] = []
          for (let index = 0; index < layout.encoderCount; index++) {
            row.push(await getEncoder(request, layer, index))
            report(layer * layout.encoderCount + index + 1, total)
          }
          result.push(row)
        }
        return result
      })

      const counts = await during('Tap Dance と Combo の枠数', () => getDynamicEntryCounts(request))
      const tapDances = await during('Tap Dance', async () => {
        const result: TapDanceEntry[] = []
        for (let index = 0; index < counts.tapDance; index++) {
          const entry = await getTapDance(request, index)
          if (!entry) throw unexpected()
          result.push(entry)
          report(index + 1, counts.tapDance)
        }
        return result
      })
      const combos = await during('Combo', async () => {
        const result: ComboEntry[] = []
        for (let index = 0; index < counts.combo; index++) {
          const entry = await getCombo(request, index)
          if (!entry) throw unexpected()
          result.push(entry)
          report(index + 1, counts.combo)
        }
        return result
      })

      // 診断用。書き込みにロック解除が要るかを、通信の記録から読み取れるようにする。結果は使わない。
      // 通信の失敗（タイムアウトや切断）は、ほかの読み出しと同じく失敗にする
      await during('ロックの状態', () => getUnlockStatus(request))

      // Vial のコマンドの応答は要求と突き合わせられないので、途中で応答が1つずれていても、ここまで気づけない。
      // 最後に、応答を突き合わせられる VIA のコマンドをもう一度送って、ずれていないことを確かめる
      if ((await during(SYNC_CHECK_STEP, () => getViaProtocolVersion(request))) !== viaProtocol) {
        // ずれたままやり直すと、次の読み出しもずれる
        this.transport.requireResync()
        return null
      }

      this.shape = {
        layerCount,
        rows: layout.rows,
        cols: layout.cols,
        encoderCount: layout.encoderCount,
        tapDanceCount: counts.tapDance,
        comboCount: counts.combo,
      }
      return {
        uid,
        layout,
        capabilities: {
          viaProtocol,
          vialProtocol,
          layerCount,
          tapDanceCount: counts.tapDance,
          comboCount: counts.combo,
        },
        keymap,
        encoders,
        tapDances,
        combos,
      }
    } catch (error) {
      if (error instanceof DeviceError && error.step === undefined) {
        throw new DeviceError(error.kind, { step, cause: error })
      }
      throw error
    }
  }

  /**
   * 渡された順に、1つずつ書く。書く前に、すべての操作が本体にある場所を指していることを確かめる
   * （本体にない場所を指す操作は、呼び出し側の誤りとして RangeError にし、何も書かない）。
   *
   * 書くコマンドの応答の形は、実機で確かめていない。応答の中身では成否を決めず、通信の失敗（タイムアウト、送信の失敗、切断、
   * 同期のやり直しの失敗）だけを失敗にする。書けたかどうかは、呼び出し側（session/writeSession.ts）が読み直して確かめる。
   * 応答が遅れて送り直した時は、同じ内容をもう一度書くことになるが、結果は変わらない
   */
  async write(operations: WriteOperation[], onProgress?: (progress: WriteProgress) => void): Promise<void> {
    const { shape } = this
    if (!shape) throw new Error('書き込む前に、read で本体の構成を読んでおく')
    for (const operation of operations) {
      if (!fits(shape, operation)) throw new RangeError(`本体にない場所への書き込み: ${JSON.stringify(operation)}`)
    }
    const request: Requester = (payload) => this.transport.request(payload)
    for (const [index, operation] of operations.entries()) {
      try {
        await send(request, shape, operation)
      } catch (error) {
        if (error instanceof DeviceError) throw new DeviceError(error.kind, { operation: index, cause: error })
        throw error
      }
      onProgress?.({ done: index + 1, total: operations.length })
    }
  }

  async disconnect(): Promise<void> {
    if (!this.release()) return
    await this.device.close()
  }

  private release(): boolean {
    if (this.closed) return false
    this.closed = true
    this.hid.removeEventListener('disconnect', this.handleDisconnect)
    this.transport.close()
    return true
  }

  // ケーブルを抜く、Bluetooth が切れる、などで機器がなくなった時
  private readonly handleDisconnect: HidDisconnectListener = (event) => {
    if (event.device !== this.device) return
    if (!this.release()) return
    this.lost = true
    for (const listener of this.listeners) listener()
  }
}
