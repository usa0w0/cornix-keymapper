import { useCallback, useRef, useState } from 'react'
import type { KeyboardDevice, KeyboardSnapshot, ReadProgress } from '../device/types.ts'
import { buildReadReport, countDifferences, describeReadError, type ReadFailure, type ReadReport } from './readReport.ts'

export type ReadState =
  | { status: 'reading'; progress: ReadProgress | null }
  | { status: 'failed'; failure: ReadFailure }
  | { status: 'done'; report: ReadReport }

/** 本体を1回読み、診断にも使う記録にまとめる。previous を渡すと、前回の読み出しと違っていた数を添える */
export async function readReportFrom(
  device: KeyboardDevice,
  previous: KeyboardSnapshot | null,
  onProgress?: (progress: ReadProgress) => void,
): Promise<ReadReport> {
  const before = device.exchangeCount()
  const snapshot = await device.read(onProgress)
  return buildReadReport({
    readAt: new Date(),
    userAgent: navigator.userAgent,
    device: { name: device.name, protocol: device.protocol },
    snapshot,
    differencesFromPrevious: previous && countDifferences(previous, snapshot),
    exchanges: device.exchanges(before),
  })
}

/** 読み出し1回ぶんの状態。どの機器の、何回目の読み出しかを一緒に持つ */
export interface HeldRead {
  device: KeyboardDevice
  run: number
  state: ReadState
}

type SetHeld = (update: (current: HeldRead | null) => HeldRead | null) => void

/**
 * 機器を読み出し、進み具合と結果を set で知らせる。
 * 後から始めた読み出し（run が違うもの）があれば、この読み出しの進み具合と結果は捨てる。
 * 読み終えたら、その記録を返す。失敗したら null
 */
export async function runRead(target: KeyboardDevice, run: number, set: SetHeld): Promise<ReadReport | null> {
  const update = (state: ReadState) =>
    set((current) => (current && current.run !== run ? current : { device: target, run, state }))
  set(() => ({ device: target, run, state: { status: 'reading', progress: null } }))
  try {
    const report = await readReportFrom(target, null, (progress) => update({ status: 'reading', progress }))
    update({ status: 'done', report })
    return report
  } catch (error) {
    // 読みかけの内容は出さない
    update({ status: 'failed', failure: describeReadError(error) })
    return null
  }
}

/**
 * 接続中の機器（device）についての状態。接続していなければ null。
 * 持っている状態が別の機器のものなら使わない（機器が替わるか切断されたら、前の読み出しの結果は捨てる）。
 * 接続した直後で、まだ読み出しを始めていない間も、読み込み中として見せる
 */
export function readStateFor(held: HeldRead | null, device: KeyboardDevice | null): ReadState | null {
  if (!device) return null
  return held?.device === device ? held.state : { status: 'reading', progress: null }
}

/** 診断で読み直した結果に入れ替える。その機器の読み出しが終わっている時だけ */
export function replaceReport(current: HeldRead | null, target: KeyboardDevice, report: ReadReport): HeldRead | null {
  return current?.device === target && current.state.status === 'done'
    ? { ...current, state: { status: 'done', report } }
    : current
}

/**
 * 読み出しの状態。read は、接続した直後と「もう一度読み出す」から呼ぶ。
 * 読み終えた記録を返す。失敗した時と、後から始めた読み出しがある時は null
 */
export function useDeviceRead(device: KeyboardDevice | null) {
  const [held, setHeld] = useState<HeldRead | null>(null)
  const runs = useRef(0)

  const read = useCallback(async (target: KeyboardDevice) => {
    const run = ++runs.current
    const report = await runRead(target, run, setHeld)
    return runs.current === run ? report : null
  }, [])
  const replace = useCallback(
    (target: KeyboardDevice, report: ReadReport) => setHeld((current) => replaceReport(current, target, report)),
    [],
  )

  /** 書き込みの流れの中で読み終えた内容を、その機器の読み出しの結果として置く（つなぎ直した後の機器でも置ける） */
  const put = useCallback((target: KeyboardDevice, report: ReadReport) => {
    const run = ++runs.current
    setHeld({ device: target, run, state: { status: 'done', report } })
  }, [])

  return { state: readStateFor(held, device), read, replace, put }
}
