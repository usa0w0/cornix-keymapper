// KeyboardDevice の Vial 版
import {
  DeviceError,
  type ComboEntry,
  type ExchangeRecord,
  type KeyboardDevice,
  type KeyboardSnapshot,
  type ReadProgress,
  type TapDanceEntry,
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
  type Requester,
} from './commands.ts'
import { decompressDefinition, parseDefinition } from './definition.ts'
import type { Transport } from './transport.ts'

/** 通信の記録を持つ数。古いものから捨てる */
const MAX_EXCHANGES = 5000

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** 診断用の通信の記録。Transport の onExchange に record を渡して使う */
export class ExchangeLog {
  private readonly records: ExchangeRecord[] = []

  readonly record = (request: Uint8Array, response: Uint8Array | null, ms: number): void => {
    this.records.push({ request: toHex(request), response: response && toHex(response), ms: Math.round(ms) })
    if (this.records.length > MAX_EXCHANGES) this.records.shift()
  }

  list(): ExchangeRecord[] {
    return [...this.records]
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

export class VialDevice implements KeyboardDevice {
  readonly name: string
  readonly protocol: string
  readonly transport: Transport
  private readonly device: RawHidDevice
  private readonly hid: HidEvents
  private readonly listeners = new Set<() => void>()
  private readonly log: ExchangeLog
  private closed = false

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
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  exchanges(): ExchangeRecord[] {
    return this.log.list()
  }

  async read(onProgress?: (progress: ReadProgress) => void): Promise<KeyboardSnapshot> {
    const request: Requester = (payload) => this.transport.request(payload)
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

      // 診断用。書き込みにロック解除が要るかを、通信の記録から読み取れるようにする。結果は使わない
      await during('ロックの状態', () => getUnlockStatus(request).catch(() => null))

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
    for (const listener of this.listeners) listener()
  }
}
