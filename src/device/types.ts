// 機器のインターフェース。画面とロジックはここだけを見て、device/vial などの実装を直接は参照しない

export type DeviceErrorKind = 'timeout' | 'send-failed' | 'disconnected' | 'unexpected-response'

/** 機器との通信の失敗。画面は kind を見て文言を出す */
export class DeviceError extends Error {
  readonly kind: DeviceErrorKind

  /** どの処理の途中で失敗したか（例: キーマップの読み出し）。画面に出す */
  readonly step?: string

  /** 書き込みで、何番目の操作で失敗したか（0 から数える）。それより前の操作は書き終えている */
  readonly operation?: number

  constructor(kind: DeviceErrorKind, options?: ErrorOptions & { step?: string; operation?: number }) {
    super(`device: ${kind}`, options)
    this.name = 'DeviceError'
    this.kind = kind
    this.step = options?.step
    this.operation = options?.operation
  }
}

/** レイアウト定義。本体から読んだ JSON と、そこから取り出した大きさ */
export interface LayoutDefinition {
  /** 行列の大きさ。キーの番号は 行 × cols + 列 */
  rows: number
  cols: number
  encoderCount: number
  /** 本体から読んだ定義そのもの（KLE 形式のキー配置を含む） */
  raw: unknown
}

export interface Capabilities {
  viaProtocol: number
  vialProtocol: number
  layerCount: number
  tapDanceCount: number
  comboCount: number
}

/** Tap Dance の1枠。4つのキーコードと時間の値（ミリ秒） */
export interface TapDanceEntry {
  onTap: number
  onHold: number
  onDoubleTap: number
  onTapHold: number
  tappingTerm: number
}

/** コンボの1枠。同時に押すキーコード（使わない所は 0）と、出力のキーコード */
export interface ComboEntry {
  keys: [number, number, number, number]
  output: number
}

/** 本体の設定を、本体の表現のまま（キーコードは数値、Tap Dance は番号付き）まとめたもの */
export interface KeyboardSnapshot {
  uid: string
  layout: LayoutDefinition
  capabilities: Capabilities
  /** [レイヤー][キー] = キーコード */
  keymap: number[][]
  /** [レイヤー][エンコーダー] = [左回し, 右回し] */
  encoders: [number, number][][]
  tapDances: TapDanceEntry[]
  combos: ComboEntry[]
}

/** 本体に書く操作1つ。1キー、エンコーダーの1方向、Tap Dance の1枠、コンボの1枠 */
export type WriteOperation =
  | { type: 'setKey'; layer: number; key: number; keycode: number }
  | { type: 'setEncoder'; layer: number; encoder: number; direction: 'left' | 'right'; keycode: number }
  | { type: 'setTapDance'; index: number; entry: TapDanceEntry }
  | { type: 'setCombo'; index: number; entry: ComboEntry }

export interface WriteProgress {
  /** 書き終えた操作の数 */
  done: number
  total: number
}

export interface ReadProgress {
  /** いま読んでいるもの（例: キーマップ） */
  step: string
  done: number
  total: number
}

/** 診断用の、要求と応答1組の記録。バイト列は 16 進の文字列 */
export interface ExchangeRecord {
  /** どの要求への応答でもないとして捨てた応答の記録では、空の文字列 */
  request: string
  /** 応答がなかった時（タイムアウト）は null */
  response: string | null
  /** 要求を送ってから応答が届くまでの時間（ミリ秒） */
  ms: number
}

export interface KeyboardDevice {
  /** 画面に出す機器名 */
  readonly name: string
  /** 画面に出す通信方式（例: VIA プロトコル 9） */
  readonly protocol: string
  /** ケーブルを抜く、Bluetooth が切れる、などで機器がなくなった時に呼ばれる。戻り値で解除する */
  onDisconnect(listener: () => void): () => void
  /** 本体の設定をまとめて読む。途中で失敗したら、読んだ内容は捨てて DeviceError を投げる */
  read(onProgress?: (progress: ReadProgress) => void): Promise<KeyboardSnapshot>
  /**
   * 渡された順に書く。途中で失敗したら、何番目の操作か（operation）を添えて DeviceError を投げる。
   * それより前の操作は書き終えている
   */
  write(operations: WriteOperation[], onProgress?: (progress: WriteProgress) => void): Promise<void>
  /** 診断用。接続してからの通信の回数。記録を古いものから捨てても減らない */
  exchangeCount(): number
  /** 診断用。通信の記録。since には、その時点の exchangeCount を渡すと、それ以降の分だけを返す */
  exchanges(since?: number): ExchangeRecord[]
  disconnect(): Promise<void>
}

export interface DeviceConnector {
  /** 機器選択を開いて接続する。利用者が選ばずに閉じたら null。クリックなどの操作の中から呼ぶ */
  connect(): Promise<KeyboardDevice | null>
}
