// メモリ上の偽の機器。実機なしで画面を動かす時と、書き込みの手順のテストに使う
import {
  DeviceError,
  type DeviceConnector,
  type DeviceErrorKind,
  type ExchangeRecord,
  type KeyboardDevice,
  type KeyboardSnapshot,
  type ReadProgress,
  type WriteOperation,
  type WriteProgress,
} from '../types.ts'

/** わざと起こす失敗。番号は、接続をまたいで 1 から数える。どれも1回だけ起きる */
export interface FakeFailures {
  /** この番号の書き込みの操作で失敗する。それより前の操作は書かれている */
  failWriteAt?: { operation: number; kind?: DeviceErrorKind }
  /** この番号の書き込みの操作の直前に、機器がなくなる */
  disconnectAtWrite?: number
  /** この番号の読み出しだけ、違う値を返す。本体の中身は変えない */
  alterReadAt?: { read: number; alter: (snapshot: KeyboardSnapshot) => void }
  /** この番号の読み出しが、step を読んでいる途中で失敗する（step を省くと「キーマップ」）。読んだ内容は返さない */
  failReadAt?: { read: number; step?: string; kind?: DeviceErrorKind }
}

export interface FakeOptions {
  name?: string
  /** 読み出しと書き込みの、1段階ごとの待ち時間。画面で進み具合を見るため */
  stepDelayMs?: number
  failures?: FakeFailures
}

const READ_STEPS = ['レイアウト定義', 'キーマップ', 'エンコーダー', 'Tap Dance', 'Combo']

const wait = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : null)

/** 偽の本体。中身は接続をまたいで残る（実機と同じく、つなぎ直しても書いた設定は消えない） */
export class FakeKeyboard implements DeviceConnector {
  /** 本体の中身。テストから直接書き換えてよい（Vial など、ほかから設定を変えられた場合をまねる） */
  snapshot: KeyboardSnapshot
  failures: FakeFailures
  readonly name: string
  readonly stepDelayMs: number
  /** これまでの読み出しの回数と、書き込みの操作の数 */
  readCount = 0
  writeCount = 0
  private current: FakeDevice | null = null

  constructor(snapshot: KeyboardSnapshot, options: FakeOptions = {}) {
    this.snapshot = structuredClone(snapshot)
    this.name = options.name ?? '偽の機器'
    this.stepDelayMs = options.stepDelayMs ?? 0
    this.failures = options.failures ?? {}
  }

  async connect(): Promise<FakeDevice> {
    this.current?.lose()
    this.current = new FakeDevice(this)
    return this.current
  }

  /** ケーブルを抜く、Bluetooth が切れる、などをまねる */
  loseConnection(): void {
    this.current?.lose()
  }
}

export class FakeDevice implements KeyboardDevice {
  readonly name: string
  readonly protocol = '偽の機器'
  private readonly keyboard: FakeKeyboard
  private readonly listeners = new Set<() => void>()
  private closed = false
  // こちらから切断したのではなく、機器がなくなった
  private lost = false

  constructor(keyboard: FakeKeyboard) {
    this.keyboard = keyboard
    this.name = keyboard.name
  }

  onDisconnect(listener: () => void): () => void {
    if (this.lost) {
      listener()
      return () => {}
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async read(onProgress?: (progress: ReadProgress) => void): Promise<KeyboardSnapshot> {
    const { keyboard } = this
    const read = ++keyboard.readCount
    const { failReadAt } = keyboard.failures
    if (failReadAt?.read === read) keyboard.failures.failReadAt = undefined
    for (const step of READ_STEPS) {
      this.ensureConnected({ step })
      onProgress?.({ step, done: 0, total: 1 })
      await wait(keyboard.stepDelayMs)
      if (failReadAt?.read === read && step === (failReadAt.step ?? 'キーマップ')) {
        throw new DeviceError(failReadAt.kind ?? 'timeout', { step })
      }
    }
    this.ensureConnected({ step: READ_STEPS.at(-1) })

    const snapshot = structuredClone(keyboard.snapshot)
    const { alterReadAt } = keyboard.failures
    if (alterReadAt?.read === read) {
      keyboard.failures.alterReadAt = undefined
      alterReadAt.alter(snapshot)
    }
    return snapshot
  }

  async write(operations: WriteOperation[], onProgress?: (progress: WriteProgress) => void): Promise<void> {
    const { keyboard } = this
    for (const [index, operation] of operations.entries()) {
      const count = ++keyboard.writeCount
      const { failWriteAt, disconnectAtWrite } = keyboard.failures
      if (disconnectAtWrite === count) {
        keyboard.failures.disconnectAtWrite = undefined
        this.lose()
      }
      this.ensureConnected({ operation: index })
      if (failWriteAt?.operation === count) {
        keyboard.failures.failWriteAt = undefined
        throw new DeviceError(failWriteAt.kind ?? 'timeout', { operation: index })
      }
      apply(keyboard.snapshot, operation)
      onProgress?.({ done: index + 1, total: operations.length })
      await wait(keyboard.stepDelayMs)
    }
  }

  exchangeCount(): number {
    return 0
  }

  exchanges(): ExchangeRecord[] {
    return []
  }

  async disconnect(): Promise<void> {
    this.closed = true
    this.listeners.clear()
  }

  /** 機器がなくなった時の動き。切断を1回だけ知らせる */
  lose(): void {
    if (this.closed) return
    this.closed = true
    this.lost = true
    for (const listener of this.listeners) listener()
    this.listeners.clear()
  }

  private ensureConnected(where: { step?: string; operation?: number }): void {
    if (this.closed) throw new DeviceError('disconnected', where)
  }
}

const ERROR_KINDS: readonly DeviceErrorKind[] = ['timeout', 'send-failed', 'disconnected', 'unexpected-response']

/**
 * URL の指定から、わざと起こす失敗を作る。画面で失敗の場面を確かめるための入口で、ふだんの画面には出さない。
 * failRead=N で N 回目の読み出しが失敗する。failKind で失敗の種類（省くと timeout）を選ぶ
 */
export function failuresFromQuery(query: URLSearchParams): FakeFailures {
  const read = Number(query.get('failRead'))
  if (!Number.isInteger(read) || read < 1) return {}
  const kind = ERROR_KINDS.find((known) => known === query.get('failKind'))
  return { failReadAt: { read, kind } }
}

/** 操作を1つ、本体の中身に反映する。本体にない場所を指す操作は、呼び出し側の誤りとして RangeError にする */
function apply(snapshot: KeyboardSnapshot, operation: WriteOperation): void {
  const outOfRange = () => new RangeError(`本体にない場所への書き込み: ${JSON.stringify(operation)}`)
  switch (operation.type) {
    case 'setKey': {
      const layer = snapshot.keymap[operation.layer]
      if (!layer || !(operation.key in layer)) throw outOfRange()
      layer[operation.key] = operation.keycode
      break
    }
    case 'setEncoder': {
      const encoder = snapshot.encoders[operation.layer]?.[operation.encoder]
      if (!encoder) throw outOfRange()
      encoder[operation.direction === 'left' ? 0 : 1] = operation.keycode
      break
    }
    case 'setTapDance':
      if (!(operation.index in snapshot.tapDances)) throw outOfRange()
      snapshot.tapDances[operation.index] = structuredClone(operation.entry)
      break
    case 'setCombo':
      if (!(operation.index in snapshot.combos)) throw outOfRange()
      snapshot.combos[operation.index] = structuredClone(operation.entry)
      break
  }
}
