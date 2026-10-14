// 書き込みの手順（docs/design.md「書き込みの流れ」の 3〜7 と、「書き込み中」の印が残った時の再開）。
// 機器（KeyboardDevice）とバックアップの保存先（BackupStorage）は外から受け取る。React にも WebHID にも依存しない。
// 画面は、進み具合と結果を表示し、利用者の選択（再試行、戻す、上書き）を渡すだけにする。
//
// どの書き込みも「目標のスナップショットと、本体の現在値との差分を、決まった順に書き、読み直して照合する」という
// 同じ処理（writeAndVerify）で行う。書き込み、再試行、書き込み前の状態に戻す、の違いは、目標だけである。
// 失敗は例外にせず、結果として返す
import {
  DeviceError,
  type DeviceErrorKind,
  type KeyboardDevice,
  type KeyboardSnapshot,
  type ReadProgress,
  type WriteOperation,
} from '../device/types.ts'
import { writeOperations } from '../model/diff.ts'
import { sameShape, sameSnapshot } from '../model/snapshot.ts'
import type { BackupStorage, StorageFailure, StorageResult, UnreadableReason } from '../storage/backup.ts'

/** いま行っていること。画面の進み具合に出す */
export type WriteStage =
  /** 書く前に、本体を読み直している */
  | { stage: 'reading'; progress: ReadProgress | null }
  /** 読み直した内容をバックアップし、「書き込み中」の印を付けている */
  | { stage: 'backup' }
  /** 書いている。done は書き終えた操作の数 */
  | { stage: 'writing'; done: number; total: number }
  /** 書き終えて、照合のために読み直している */
  | { stage: 'verifying'; progress: ReadProgress | null }

export interface WriteDeps {
  device: KeyboardDevice
  backups: BackupStorage
  onStage?: (stage: WriteStage) => void
}

/**
 * 書き込みの一連の操作（再試行と、戻すを含む）で持ち続けるもの。「書き込み中」の印にも同じ内容を保存している。
 * before は書き込み前の本体の内容（バックアップしたもの。「戻す」の相手）、target は目標
 */
export interface WriteJob {
  before: KeyboardSnapshot
  target: KeyboardSnapshot
}

/** 通信の失敗の原因。unknown は、機器の実装が想定外の失敗をした時（message に中身） */
export interface DeviceFault {
  kind: DeviceErrorKind | 'unknown'
  /** 読み出しの失敗で、どこを読んでいたか */
  step?: string
  message?: string
}

/** 失敗した項目と原因 */
export type WriteFailure =
  /** 書く前の読み直しに失敗した（再試行と、戻すの最初）。この回は、何も書いていない */
  | { kind: 'read'; fault: DeviceFault }
  /** つないでいるのが、別の機器か、構成（レイヤーや枠の数）が違う機器だった。何も書いていない */
  | { kind: 'incompatible'; reason: 'other-device' | 'shape' }
  /** 書いている途中で失敗した。index 番目（0 から数える）の操作で失敗し、それより前の操作は書き終えている */
  | { kind: 'write'; fault: DeviceFault; index: number; total: number; operation: WriteOperation | null }
  /** 書き終えたが、照合のための読み直しに失敗した。written は書いた操作の数 */
  | { kind: 'verify'; fault: DeviceFault; written: number }
  /** 書き終えて読み直したら、目標と違っていた。remaining は、違っている所（目標にするために、まだ要る操作） */
  | { kind: 'mismatch'; written: number; remaining: WriteOperation[] }

export type WriteOutcome =
  /**
   * 書き込みと照合が通った。verified は読み直した内容（新しい基準にする）、written は書いた操作の数。
   * markCleared が false なら、「書き込み中」の印を消せなかった（次に接続した時に、前回の書き込みが終わっていないと出る）
   */
  | { status: 'done'; verified: KeyboardSnapshot; written: number; markCleared: boolean }
  /** 途中の失敗か、照合の不一致。「書き込み中」の印は残っている。画面は「再試行」と「書き込み前の状態に戻す」を出す */
  | { status: 'failed'; job: WriteJob; failure: WriteFailure }

/** 書き込みを始めなかった理由。本体には何も書いていない */
export type NotStartedReason =
  /** 書く前の読み直しに失敗した */
  | { kind: 'read'; fault: DeviceFault }
  /** バックアップか、「書き込み中」の印を保存できなかった */
  | { kind: 'backup'; reason: StorageFailure }

export type StartOutcome =
  | WriteOutcome
  | { status: 'not-started'; reason: NotStartedReason }
  /**
   * 書く前に読み直したら、画面に読み込んだ時（expected）と違っていた。本体には何も書いていない。
   * settings は、同じ機器で設定が変わっていた（読み込み直すか、そのまま上書きするかを選べる）。
   * other-device は別の機器、shape は構成（レイヤーや枠の数）が変わっていた（上書きはできない）
   */
  | { status: 'changed'; reason: 'settings' | 'other-device' | 'shape'; fresh: KeyboardSnapshot }

const faultOf = (error: unknown): DeviceFault =>
  error instanceof DeviceError
    ? { kind: error.kind, ...(error.step === undefined ? {} : { step: error.step }) }
    : { kind: 'unknown', message: error instanceof Error ? error.message : String(error) }

const failed = (job: WriteJob, failure: WriteFailure): WriteOutcome => ({ status: 'failed', job, failure })

const read = ({ device, onStage }: WriteDeps, stage: 'reading' | 'verifying'): Promise<KeyboardSnapshot> => {
  onStage?.({ stage, progress: null })
  return device.read((progress) => onStage?.({ stage, progress }))
}

/**
 * 目標（goal）と、本体の現在値（current。直前に読んだもの）との差分を書き、読み直して照合する。
 * 照合が通ったら、「書き込み中」の印を消す。書くものがなければ、直前に読んだ内容が目標と同じなので、そのまま照合が通ったとする
 */
async function writeAndVerify(deps: WriteDeps, job: WriteJob, current: KeyboardSnapshot, goal: KeyboardSnapshot): Promise<WriteOutcome> {
  const { device, backups, onStage } = deps
  const operations = writeOperations(current, goal)
  let verified = current
  if (operations.length > 0) {
    let done = 0
    onStage?.({ stage: 'writing', done, total: operations.length })
    try {
      await device.write(operations, (progress) => {
        done = progress.done
        onStage?.({ stage: 'writing', done, total: operations.length })
      })
    } catch (error) {
      const index = error instanceof DeviceError && error.operation !== undefined ? error.operation : done
      return failed(job, {
        kind: 'write',
        fault: faultOf(error),
        index,
        total: operations.length,
        operation: operations[index] ?? null,
      })
    }
    try {
      verified = await read(deps, 'verifying')
    } catch (error) {
      return failed(job, { kind: 'verify', fault: faultOf(error), written: operations.length })
    }
    if (verified.uid !== goal.uid) return failed(job, { kind: 'incompatible', reason: 'other-device' })
    if (!sameShape(verified, goal)) return failed(job, { kind: 'incompatible', reason: 'shape' })
    // 書くコマンドの応答では成否を決めていない。読み直した内容が目標と同じかで、書けたかどうかを決める
    const remaining = writeOperations(verified, goal)
    if (remaining.length > 0) return failed(job, { kind: 'mismatch', written: operations.length, remaining })
  }
  const cleared = backups.clearPendingWrite(goal.uid)
  return { status: 'done', verified, written: operations.length, markCleared: cleared.ok }
}

/**
 * 書き込みを始める（「書き込みの流れ」の 3〜6）。
 * 1. 本体を読み直す。画面に読み込んだ時の内容（expected。ふつうは基準）と違っていたら、もう一度読んで確かめ、
 *    それでも違えば、何も書かずに止める（changed）。利用者が「このまま上書きする」を選んだ時は、
 *    その時に読み直した内容（changed の fresh）を expected にして、もう一度呼ぶ
 * 2. 読み直した内容をバックアップし、「書き込み中」の印を保存する。保存できなければ、何も書かずに止める
 * 3. 目標との差分を書き、読み直して照合する
 */
export async function startWrite(
  deps: WriteDeps,
  { expected, target }: { expected: KeyboardSnapshot; target: KeyboardSnapshot },
): Promise<StartOutcome> {
  const { backups, onStage } = deps
  let fresh: KeyboardSnapshot
  try {
    fresh = await read(deps, 'reading')
    // 読み違いで書き込みを止めないよう、もう一度読んで確かめる
    if (!sameSnapshot(fresh, expected)) fresh = await read(deps, 'reading')
  } catch (error) {
    return { status: 'not-started', reason: { kind: 'read', fault: faultOf(error) } }
  }
  if (fresh.uid !== target.uid) return { status: 'changed', reason: 'other-device', fresh }
  if (!sameShape(fresh, target)) return { status: 'changed', reason: 'shape', fresh }
  if (!sameSnapshot(fresh, expected)) return { status: 'changed', reason: 'settings', fresh }

  // 本体がすでに目標と同じなら、書くものがない。バックアップも増やさない
  if (writeOperations(fresh, target).length === 0) return { status: 'done', verified: fresh, written: 0, markCleared: true }

  onStage?.({ stage: 'backup' })
  const saved = backups.save(fresh)
  if (!saved.ok) return { status: 'not-started', reason: { kind: 'backup', reason: saved.reason } }
  const marked = backups.markWriting(fresh, target)
  if (!marked.ok) {
    // 書きかけの印が残っていれば、消しておく（消せなくても、本体には何も書いていない）
    backups.clearPendingWrite(fresh.uid)
    return { status: 'not-started', reason: { kind: 'backup', reason: marked.reason } }
  }
  return writeAndVerify(deps, { before: fresh, target }, fresh, target)
}

/** 本体を読み直し、goal との差分を書いて照合する。再試行と、戻すの共通の形 */
async function resume(deps: WriteDeps, job: WriteJob, goal: KeyboardSnapshot): Promise<WriteOutcome> {
  let current: KeyboardSnapshot
  try {
    current = await read(deps, 'reading')
  } catch (error) {
    return failed(job, { kind: 'read', fault: faultOf(error) })
  }
  if (current.uid !== goal.uid) return failed(job, { kind: 'incompatible', reason: 'other-device' })
  if (!sameShape(current, goal)) return failed(job, { kind: 'incompatible', reason: 'shape' })
  return writeAndVerify(deps, job, current, goal)
}

/** 再試行（「書き込みの流れ」の 7）。本体を読み直し、目標との差分を作り直して書く。バックアップは取り直さない */
export const retryWrite = (deps: WriteDeps, job: WriteJob): Promise<WriteOutcome> => resume(deps, job, job.target)

/**
 * 書き込み前の状態に戻す（「書き込みの流れ」の 7）。本体を読み直し、書き込み前の内容（バックアップしたもの）との差分を書く。
 * キーの動作への変換は通さない。done の verified は、戻した後に読み直した内容
 */
export const restoreWrite = (deps: WriteDeps, job: WriteJob): Promise<WriteOutcome> => resume(deps, job, job.before)

/** 前回の書き込みが終わっていないか（「書き込み中」の印が残っているか） */
export type InterruptedWrite =
  | { status: 'none' }
  /** startedAt は、書き込みを始めた日時（ISO 8601）。job で、戻す（restoreWrite）ことができる */
  | { status: 'pending'; startedAt: string; job: WriteJob }
  /** 印はあるが読み込めないので、戻せない。バックアップの一覧からは戻せる */
  | { status: 'unreadable'; startedAt: string | null; reason: UnreadableReason }

/** その機器に、前回の書き込みの印が残っているかを見る。機器を接続して、読み出した後に呼ぶ */
export function interruptedWrite(backups: BackupStorage, uid: string): InterruptedWrite {
  const mark = backups.pendingWrite(uid)
  if (mark.status !== 'pending') return mark
  return { status: 'pending', startedAt: mark.startedAt, job: { before: mark.before, target: mark.target } }
}

/** 前回の書き込みが終わっていない時に、「いまの本体の状態のまま続ける」を選んだ。印を消すだけで、本体には触らない */
export const continueWithCurrent = (backups: BackupStorage, uid: string): StorageResult => backups.clearPendingWrite(uid)
