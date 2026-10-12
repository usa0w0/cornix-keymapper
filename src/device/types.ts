// 機器のインターフェース。画面とロジックはここだけを見て、device/vial などの実装を直接は参照しない

export type DeviceErrorKind = 'timeout' | 'send-failed' | 'disconnected' | 'unexpected-response'

/** 機器との通信の失敗。画面は kind を見て文言を出す */
export class DeviceError extends Error {
  readonly kind: DeviceErrorKind

  constructor(kind: DeviceErrorKind, options?: ErrorOptions) {
    super(`device: ${kind}`, options)
    this.name = 'DeviceError'
    this.kind = kind
  }
}

export interface KeyboardDevice {
  /** 画面に出す機器名 */
  readonly name: string
  /** 画面に出す通信方式（例: VIA プロトコル 9） */
  readonly protocol: string
  /** ケーブルを抜く、Bluetooth が切れる、などで機器がなくなった時に呼ばれる。戻り値で解除する */
  onDisconnect(listener: () => void): () => void
  disconnect(): Promise<void>
}

export interface DeviceConnector {
  /** 機器選択を開いて接続する。利用者が選ばずに閉じたら null。クリックなどの操作の中から呼ぶ */
  connect(): Promise<KeyboardDevice | null>
}
