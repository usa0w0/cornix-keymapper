import { useCallback, useRef, useState } from 'react'
import type { KeyboardDevice, KeyboardSnapshot } from '../device/types.ts'
import {
  restoreWrite,
  retryWrite,
  startWrite,
  type DeviceFault,
  type StartOutcome,
  type WriteDeps,
  type WriteJob,
  type WriteOutcome,
  type WriteStage,
} from '../session/writeSession.ts'
import type { BackupStorage } from '../storage/backup.ts'
import { downloadJson } from './download.ts'
import { EXCHANGE_FORMAT, formatExchanges } from './readReport.ts'
import { flowAfter, flowAfterStart, IDLE, type WriteAction, type WriteFlow } from './writeFlow.ts'

/** 書き込みの流れの中で、本体を読み終えた時に知らせる中身。since は、流れを始めた時の、機器の通信の回数 */
export interface FlowRead {
  device: KeyboardDevice
  snapshot: KeyboardSnapshot
  since: number
}

interface Options {
  backups: BackupStorage
  /** 書き込みと照合が通った。読み直した内容を、新しい基準にする */
  onWritten: (read: FlowRead) => void
  /** 書き込み前の状態に戻した。読み直した内容を、編集中の状態に渡す */
  onRestored: (read: FlowRead) => void
}

const unknownFault = (error: unknown): DeviceFault => ({
  kind: 'unknown',
  message: error instanceof Error ? error.message : String(error),
})

/** 通信の記録を取り始めた所。機器が替わったら（つなぎ直したら）、取り直す */
interface Trace {
  device: KeyboardDevice
  since: number
}

/**
 * 書き込みの流れの状態（docs/design.md「画面 > 書き込みの流れ」）。手順は session/writeSession.ts に任せ、
 * ここは、進み具合と結果を場面（WriteFlow）として持つ。失敗後の状態は、機器と結び付けずに持つので、つなぎ直しをまたいで残る
 */
export function useWriteFlow({ backups, onWritten, onRestored }: Options) {
  const [flow, setFlow] = useState<WriteFlow>(IDLE)
  // 読み出しが終わった時などに、いまの場面を、描き直しを待たずに見る
  const current = useRef<WriteFlow>(IDLE)
  const trace = useRef<Trace | null>(null)

  const set = useCallback((next: WriteFlow) => {
    current.current = next
    setFlow(next)
  }, [])

  /** 手順を1つ走らせる。走っている間は「書き込み中」の場面にし、進み具合を入れていく */
  const run = useCallback(
    async <T>(device: KeyboardDevice, action: WriteAction, step: (deps: WriteDeps) => Promise<T>): Promise<{ result: T; read: Trace } | null> => {
      // 二重に走らせない
      if (current.current.phase === 'working') return null
      if (trace.current?.device !== device) trace.current = { device, since: device.exchangeCount() }
      set({ phase: 'working', action, stage: null })
      const onStage = (stage: WriteStage) => set({ phase: 'working', action, stage })
      return { result: await step({ device, backups, onStage }), read: trace.current }
    },
    [backups, set],
  )

  const finish = useCallback(
    (action: WriteAction, outcome: WriteOutcome, read: Trace) => {
      if (outcome.status === 'done') {
        const done = { ...read, snapshot: outcome.verified }
        if (action === 'restore') onRestored(done)
        else onWritten(done)
        trace.current = null
      }
      set(flowAfter(action, outcome))
    },
    [onRestored, onWritten, set],
  )

  /**
   * 書き込みを始める。expected は、画面に読み込んだ時の本体の内容（基準）。
   * 「このまま上書きする」の時は、利用者に確かめてもらった、読み直した内容を渡す
   */
  const start = useCallback(
    async (device: KeyboardDevice, expected: KeyboardSnapshot, target: KeyboardSnapshot) => {
      // 手順は、失敗を結果として返す。それでも例外が出た時は、手順のどこかの誤りなので、画面を止めたままにしない
      const ran = await run(device, 'write', (deps) =>
        startWrite(deps, { expected, target }).catch(
          (error: unknown): StartOutcome => ({ status: 'not-started', reason: { kind: 'read', fault: unknownFault(error) } }),
        ),
      )
      if (!ran) return
      if (ran.result.status === 'done' || ran.result.status === 'failed') finish('write', ran.result, ran.read)
      else set(flowAfterStart(ran.result, target))
    },
    [finish, run, set],
  )

  const resume = useCallback(
    async (device: KeyboardDevice, action: 'retry' | 'restore', job: WriteJob) => {
      const ran = await run(device, action, (deps) =>
        (action === 'retry' ? retryWrite(deps, job) : restoreWrite(deps, job)).catch(
          (error: unknown): WriteOutcome => ({ status: 'failed', job, failure: { kind: 'read', fault: unknownFault(error) } }),
        ),
      )
      if (ran) finish(action, ran.result, ran.read)
    },
    [finish, run],
  )

  /** 閉じられる場面（結果、書き込みを始めなかった知らせ、本体の設定が変わっていた時の確認）を閉じる */
  const close = useCallback(() => {
    const { phase } = current.current
    if (phase === 'working' || phase === 'failed') return
    trace.current = null
    set(IDLE)
  }, [set])

  /** 失敗した時の、通信の記録を保存する。うまくいかなかった時に、原因を調べるためのもの */
  const saveLog = useCallback(() => {
    const failed = current.current
    const traced = trace.current
    if (failed.phase !== 'failed' || !traced) return
    const savedAt = new Date().toISOString()
    downloadJson(`cornix-write-${savedAt.replace(/[:.]/g, '-')}.json`, {
      note: 'Cornix キーマッパーの、失敗した書き込みの記録。書く前の読み直し、書き込み、照合の読み直しの通信を含む',
      savedAt,
      userAgent: navigator.userAgent,
      device: { name: traced.device.name, protocol: traced.device.protocol },
      action: failed.action,
      failure: failed.failure,
      before: failed.job.before,
      target: failed.job.target,
      exchangeFormat: EXCHANGE_FORMAT,
      exchanges: formatExchanges(traced.device.exchanges(traced.since)),
    })
  }, [])

  /** 流れの中で読んだ内容を、通信の記録を取り始めた所と一緒に返す。流れが始まっていなければ null */
  const traced = useCallback((snapshot: KeyboardSnapshot): FlowRead | null => trace.current && { ...trace.current, snapshot }, [])

  return { flow, current, start, resume, close, saveLog, traced }
}
