// 書き込みの流れの、画面の側の状態と文言。手順そのものは session/writeSession.ts が受け持つ
import type { KeyboardSnapshot, WriteOperation } from '../device/types.ts'
import { tapDanceIndexOf } from '../model/decode.ts'
import { encoderName, placeName } from '../model/layout.ts'
import type {
  DeviceFault,
  NotStartedReason,
  StartOutcome,
  WriteFailure,
  WriteJob,
  WriteOutcome,
  WriteStage,
} from '../session/writeSession.ts'
import type { StorageFailure, UnreadableReason } from '../storage/backup.ts'

/** 行っている操作。書き込み、再試行、書き込み前の状態に戻す */
export type WriteAction = 'write' | 'retry' | 'restore'

/** 書き込みの流れの、いまの場面。idle 以外の間は、ダイアログを出して、編集とほかの操作を止める */
export type WriteFlow =
  | { phase: 'idle' }
  /** 読み直し、バックアップ、書き込み、照合の途中。閉じられない */
  | { phase: 'working'; action: WriteAction; stage: WriteStage | null }
  /** 書く前に読み直したら、本体の設定が変わっていた。target は、上書きする時の目標 */
  | { phase: 'changed'; reason: 'settings' | 'other-device' | 'shape'; fresh: KeyboardSnapshot; target: KeyboardSnapshot }
  /** 書き込みを始めなかった。本体には何も書いていない */
  | { phase: 'not-started'; reason: NotStartedReason }
  /** 書き込みと照合が通った */
  | { phase: 'done'; written: number; markCleared: boolean }
  /** 途中の失敗か、照合の不一致。action は、失敗した操作。つなぎ直しをまたいで残す */
  | { phase: 'failed'; action: WriteAction; job: WriteJob; failure: WriteFailure }
  /** 書き込み前の状態に戻した */
  | { phase: 'restored'; written: number; markCleared: boolean }

export const IDLE: WriteFlow = { phase: 'idle' }

/** 書き込みを始めた結果から、次の場面を決める */
export function flowAfterStart(outcome: StartOutcome, target: KeyboardSnapshot): WriteFlow {
  switch (outcome.status) {
    case 'changed':
      return { phase: 'changed', reason: outcome.reason, fresh: outcome.fresh, target }
    case 'not-started':
      return { phase: 'not-started', reason: outcome.reason }
    default:
      return flowAfter('write', outcome)
  }
}

/** 書き込み、再試行、戻すの結果から、次の場面を決める */
export function flowAfter(action: WriteAction, outcome: WriteOutcome): WriteFlow {
  if (outcome.status === 'failed') return { phase: 'failed', action, job: outcome.job, failure: outcome.failure }
  const { written, markCleared } = outcome
  return { phase: action === 'restore' ? 'restored' : 'done', written, markCleared }
}

/** ダイアログを、利用者が閉じられる場面か。書き込みの途中と、失敗の後（再試行か、戻すかを選ぶ）は、閉じられない */
export const isClosable = (flow: WriteFlow) =>
  flow.phase === 'done' || flow.phase === 'restored' || flow.phase === 'not-started' || flow.phase === 'changed'

/** 通信の失敗の原因。文の終わりの形（「…応答がなくなりました」） */
export function faultText(fault: DeviceFault): string {
  switch (fault.kind) {
    case 'timeout':
      return 'キーボードから応答がなくなりました'
    case 'send-failed':
      return 'キーボードへ送信できませんでした'
    case 'disconnected':
      return 'キーボードとの接続が切れました'
    case 'unexpected-response':
      return 'キーボードから想定と違う応答が返りました'
    case 'unknown':
      return `原因の分からない失敗が起きました（${fault.message ?? ''}）`
  }
}

/** 通信の失敗の後に、利用者が確かめること */
export function faultAdvice(fault: DeviceFault): string {
  switch (fault.kind) {
    case 'timeout':
      return '電源と接続を確かめてください。'
    case 'send-failed':
    case 'disconnected':
      return 'キーボードをつなぎ直してください。'
    case 'unexpected-response':
      return 'Vial など、ほかのアプリやタブで開いている場合は、閉じてください。'
    case 'unknown':
      return 'キーボードをつなぎ直してください。'
  }
}

const readWhere = (fault: DeviceFault) => (fault.step ? `「${fault.step}」を読んでいる途中で、` : '')

/**
 * 機器に送る操作1つが、どの場所のものか。利用者に見せる言葉にする（Tap Dance とコンボの枠の番号は見せない）。
 * Tap Dance の枠は、その枠を使うキーの場所で示す。job の、書き込み前の内容と目標の両方から探す
 */
export function operationPlace(operation: WriteOperation, job: WriteJob): string {
  const { cols } = job.target.layout
  switch (operation.type) {
    case 'setKey':
      return placeName(operation.layer, { row: Math.floor(operation.key / cols), col: operation.key % cols })
    case 'setEncoder':
      return `レイヤー ${operation.layer} ・ ${encoderName(operation)}`
    case 'setCombo':
      return 'コンボ'
    case 'setTapDance': {
      for (const { keymap } of [job.target, job.before]) {
        for (const [layer, keys] of keymap.entries()) {
          const key = keys.findIndex((keycode) => tapDanceIndexOf(keycode) === operation.index)
          if (key >= 0) return `${placeName(layer, { row: Math.floor(key / cols), col: key % cols })} などの、長押しや2回タップの内容`
        }
      }
      return 'キーから使われていない、長押しや2回タップの内容'
    }
  }
}

/** 照合の不一致で、一覧に出す場所の数。これより多い時は、残りを数で出す */
const MISMATCH_SHOWN = 5

export interface FailureText {
  title: string
  /** 何件目・どの場所で、なぜ失敗したか */
  cause: string
  /** 照合の不一致で、違っていた場所 */
  places: string[]
  /** places に出しきれなかった数 */
  morePlaces: number
  /** 本体がいまどういう状態か、次に何をするか */
  advice: string
}

/** 失敗した項目と原因を、画面に出す文にする */
export function describeFailure(action: WriteAction, job: WriteJob, failure: WriteFailure): FailureText {
  const restoring = action === 'restore'
  const none = { places: [], morePlaces: 0 }
  switch (failure.kind) {
    case 'write': {
      const where = failure.operation ? `失敗したのは「${operationPlace(failure.operation, job)}」です。` : ''
      return {
        title: restoring ? '書き込み前の状態に戻す途中で、失敗しました' : '書き込みの途中で失敗しました',
        cause: `${failure.total} 件中 ${failure.index} 件を書いた所で、${faultText(failure.fault)}。${where}`,
        ...none,
        advice: `本体は、書きかけの状態です。${faultAdvice(failure.fault)}そのうえで、どちらかを選んでください。`,
      }
    }
    case 'mismatch': {
      const places = [...new Set(failure.remaining.map((operation) => operationPlace(operation, job)))]
      return {
        title: restoring ? '戻した内容が、本体と合いません' : '書き込んだ内容が、本体と合いません',
        cause: `${failure.written} 件を書きましたが、本体から読み直すと、次の場所の内容が、書いたものと違っていました。`,
        places: places.slice(0, MISMATCH_SHOWN),
        morePlaces: Math.max(0, places.length - MISMATCH_SHOWN),
        advice: 'もう一度書き込むか、書き込み前の状態に戻してください。',
      }
    }
    case 'verify':
      return {
        title: restoring ? '戻した内容を、確かめられませんでした' : '書き込んだ内容を、確かめられませんでした',
        cause: `${failure.written} 件を書き終えましたが、確かめるための読み直しで、${readWhere(failure.fault)}${faultText(failure.fault)}。`,
        ...none,
        advice: `本体に正しく書けたかは、まだ分かりません。${faultAdvice(failure.fault)}「再試行」を選ぶと、読み直して確かめ、足りない所だけを書き直します。`,
      }
    case 'read':
      return {
        title: '本体の設定を読み直せませんでした',
        cause: `書く前に本体の設定を読み直そうとしましたが、${readWhere(failure.fault)}${faultText(failure.fault)}。`,
        ...none,
        advice: `今回は、本体に何も書いていません。本体は、前に失敗した時の状態のままです。${faultAdvice(failure.fault)}そのうえで、どちらかを選んでください。`,
      }
    case 'incompatible':
      return failure.reason === 'other-device'
        ? {
            title: '書き込みの途中だったキーボードとは、別のキーボードです',
            cause: 'いまつないでいるのは、書き込みの途中だったキーボードとは別のキーボードです。このキーボードには、何も書いていません。',
            ...none,
            advice: '書き込みの途中だったキーボードをつなぎ直してから、どちらかを選んでください。',
          }
        : {
            title: 'キーボードの構成が、書き込みを始めた時と違います',
            cause: 'レイヤーや枠の数が、書き込みを始めた時と違っています。今回は、本体に何も書いていません。',
            ...none,
            advice: 'ファームウェアを入れ替えた場合は、このページを再読み込みして、設定を読み込み直してください。',
          }
  }
}

/** バックアップを保存できなかった原因 */
export function storageFailureText(reason: StorageFailure): string {
  switch (reason) {
    case 'unavailable':
      return 'このブラウザーでは、サイトのデータの保存が使えません。ブラウザーの設定で、このサイトのデータの保存を止めていないか、シークレットウィンドウで開いていないかを確かめてください。'
    case 'quota':
      return 'ブラウザーの中の、このサイトが使える保存の容量が足りません。'
    case 'not-saved':
      return '保存したはずの内容を、読み戻して確かめられませんでした。'
  }
}

export interface NoticeText {
  title: string
  body: string[]
}

/** 書き込みを始めなかった理由を、画面に出す文にする */
export function describeNotStarted(reason: NotStartedReason): NoticeText {
  if (reason.kind === 'backup') {
    return {
      title: '書き込む前のバックアップを、保存できませんでした',
      body: [storageFailureText(reason.reason), 'バックアップがないと戻せなくなるので、書き込みは始めていません。本体には、何も書いていません。'],
    }
  }
  return {
    title: '書き込みを始められませんでした',
    body: [
      `書く前に本体の設定を読み直そうとしましたが、${readWhere(reason.fault)}${faultText(reason.fault)}。`,
      `本体には、何も書いていません。${faultAdvice(reason.fault)}そのうえで、もう一度「書き込み」を押してください。`,
    ],
  }
}

/** 読み込めないバックアップと、読み込めない「書き込み中」の印の理由 */
export function unreadableText(reason: UnreadableReason): string {
  switch (reason) {
    case 'broken':
      return 'データが壊れています'
    case 'version':
      return 'このサイトの新しい版で保存されたものです'
    case 'snapshot':
      return '中身が、キーボードの設定の形になっていません'
  }
}

const two = (value: number) => String(value).padStart(2, '0')

/** 保存した日時（ISO 8601）を、利用者の時刻で「2026-10-12 10:32」の形にする */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** 進み具合の文。棒に出す数（数えられない間は null）も返す */
export function describeStage(action: WriteAction, stage: WriteStage | null): { text: string; bar: { done: number; total: number } | null } {
  const reading = (label: string, progress: { step: string } | null) => `${label}${progress ? `（${progress.step}）` : ''}`
  if (!stage || stage.stage === 'reading') return { text: reading('書く前に、本体の設定を読み直しています…', stage?.progress ?? null), bar: null }
  switch (stage.stage) {
    case 'backup':
      return { text: 'いまの本体の設定を、バックアップしています…', bar: null }
    case 'writing':
      return {
        text: `${stage.total} 件中 ${stage.done} 件を${action === 'restore' ? '戻しました' : '書きました'}。`,
        bar: { done: stage.done, total: stage.total },
      }
    case 'verifying':
      return { text: reading('書いた内容を、本体から読み直して確かめています…', stage.progress), bar: null }
  }
}
