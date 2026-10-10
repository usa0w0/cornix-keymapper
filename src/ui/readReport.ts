// 読み出しの結果を、画面と書き出し用にまとめる
import { DeviceError, type ExchangeRecord, type KeyboardSnapshot } from '../device/types.ts'

export interface ExchangeStats {
  count: number
  timeouts: number
  totalMs: number
  averageMs: number
  maxMs: number
}

export function summarizeExchanges(exchanges: ExchangeRecord[]): ExchangeStats {
  const answered = exchanges.filter((e) => e.response !== null)
  const totalMs = exchanges.reduce((sum, e) => sum + e.ms, 0)
  return {
    count: exchanges.length,
    timeouts: exchanges.length - answered.length,
    totalMs,
    averageMs: answered.length ? Math.round(answered.reduce((sum, e) => sum + e.ms, 0) / answered.length) : 0,
    maxMs: answered.reduce((max, e) => Math.max(max, e.ms), 0),
  }
}

/** キーコードを 4 桁の 16 進で表す（例: 0x5220） */
export const hex16 = (value: number) => `0x${value.toString(16).padStart(4, '0').toUpperCase()}`

/** 2つの読み出しで、違っているキーコードなどの数。0 なら一致 */
export function countDifferences(a: KeyboardSnapshot, b: KeyboardSnapshot): number {
  const flatten = (snapshot: KeyboardSnapshot): (number | string)[] => [
    snapshot.uid,
    JSON.stringify(snapshot.layout.raw),
    ...Object.values(snapshot.capabilities),
    ...snapshot.keymap.flat(),
    ...snapshot.encoders.flat(2),
    ...snapshot.tapDances.flatMap((t) => [t.onTap, t.onHold, t.onDoubleTap, t.onTapHold, t.tappingTerm]),
    ...snapshot.combos.flatMap((c) => [...c.keys, c.output]),
  ]
  const [left, right] = [flatten(a), flatten(b)]
  let differences = Math.abs(left.length - right.length)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) differences++
  }
  return differences
}

const trimZeros = (hex: string) => hex.replace(/(00)+$/, '')

export interface ReadReport {
  note: string
  readAt: string
  userAgent: string
  device: { name: string; protocol: string }
  /** 前回の読み出しと違っていた数。初回は null */
  differencesFromPrevious: number | null
  stats: ExchangeStats
  snapshot: KeyboardSnapshot
  exchangeFormat: string
  exchanges: string[]
}

/** コピーや保存に使う、読み出し1回ぶんの記録 */
export function buildReadReport(input: {
  readAt: Date
  userAgent: string
  device: { name: string; protocol: string }
  snapshot: KeyboardSnapshot
  differencesFromPrevious: number | null
  exchanges: ExchangeRecord[]
}): ReadReport {
  return {
    note: 'Cornix キーマッパーの読み出しの記録。設計の確定とテストデータに使う',
    readAt: input.readAt.toISOString(),
    userAgent: input.userAgent,
    device: input.device,
    differencesFromPrevious: input.differencesFromPrevious,
    stats: summarizeExchanges(input.exchanges),
    snapshot: input.snapshot,
    exchangeFormat: '要求>応答@ミリ秒。16 進で、末尾の 00 は省く。応答なし（タイムアウト）は -',
    exchanges: input.exchanges.map(
      (e) => `${trimZeros(e.request)}>${e.response === null ? '-' : trimZeros(e.response)}@${e.ms}`,
    ),
  }
}

/** 読み出しの失敗を、どこで・なぜ・次に何をするか、の順に説明する */
export function describeReadError(error: unknown): string {
  if (!(error instanceof DeviceError)) {
    return `原因が分かりません。（${error instanceof Error ? error.message : String(error)}）`
  }
  const where = error.step ? `「${error.step}」を読んでいる途中で、` : ''
  switch (error.kind) {
    case 'timeout':
      return `${where}キーボードから応答がなくなりました。電源と接続を確かめて、「もう一度読み出す」を押してください。`
    case 'send-failed':
      return `${where}キーボードへ送信できませんでした。つなぎ直してから、接続し直してください。`
    case 'disconnected':
      return `${where}キーボードとの接続が切れました。つなぎ直してから、接続し直してください。`
    case 'unexpected-response':
      return `${where}キーボードから想定と違う応答が返りました。Vial など他のアプリやタブで開いている場合は閉じて、「もう一度読み出す」を押してください。`
  }
}
