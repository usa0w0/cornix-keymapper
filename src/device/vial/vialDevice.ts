// KeyboardDevice の Vial 版
import type { KeyboardDevice } from '../types.ts'
import type { Transport } from './transport.ts'

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
  private closed = false

  constructor(device: RawHidDevice, hid: HidEvents, transport: Transport, viaProtocolVersion: number) {
    this.device = device
    this.hid = hid
    this.transport = transport
    this.name = device.productName || '名前のない機器'
    this.protocol = `VIA プロトコル ${viaProtocolVersion}`
    this.hid.addEventListener('disconnect', this.handleDisconnect)
  }

  onDisconnect(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
