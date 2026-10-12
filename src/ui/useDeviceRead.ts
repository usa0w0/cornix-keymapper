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

/**
 * 読み出しの状態。接続中の機器（device）についての状態だけを返し、機器が替わるか切断されたら、前の読み出しの結果は捨てる。
 * read は、接続した直後と「もう一度読み出す」から呼ぶ
 */
export function useDeviceRead(device: KeyboardDevice | null) {
  const [held, setHeld] = useState<{ device: KeyboardDevice; run: number; state: ReadState } | null>(null)
  const runs = useRef(0)

  const read = useCallback(async (target: KeyboardDevice) => {
    const run = ++runs.current
    // 後から始めた読み出しがあれば、古い読み出しの結果は使わない
    const update = (state: ReadState) =>
      setHeld((current) => (current && current.run !== run ? current : { device: target, run, state }))
    setHeld({ device: target, run, state: { status: 'reading', progress: null } })
    try {
      const report = await readReportFrom(target, null, (progress) => update({ status: 'reading', progress }))
      update({ status: 'done', report })
    } catch (error) {
      // 読みかけの内容は出さない
      update({ status: 'failed', failure: describeReadError(error) })
    }
  }, [])

  /** 診断で読み直した結果に入れ替える */
  const replace = useCallback((target: KeyboardDevice, report: ReadReport) => {
    setHeld((current) =>
      current?.device === target && current.state.status === 'done' ? { ...current, state: { status: 'done', report } } : current,
    )
  }, [])

  // 接続した直後で、まだ読み出しを始めていない間も、読み込み中として見せる
  const state: ReadState | null = !device
    ? null
    : held?.device === device
      ? held.state
      : { status: 'reading', progress: null }
  return { state, read, replace }
}
