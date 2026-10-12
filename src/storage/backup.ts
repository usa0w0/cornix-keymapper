// ブラウザー内の自動バックアップと、「書き込み中」の印（docs/design.md「保存 > 自動バックアップ」）。
// 保存先（localStorage と同じ形のもの）は外から受け取る。React にも WebHID にも依存しない。
// 保存先が使えない、容量が足りない、中身が壊れている、のどれでも例外は投げず、結果として返す
import type { KeyboardSnapshot } from '../device/types.ts'
import { isKeyboardSnapshot, sameSnapshot } from '../model/snapshot.ts'

/** 保存先。localStorage のうち、ここで使う分 */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 機器ごとに残すバックアップの数 */
export const BACKUP_LIMIT = 5

/** 保存する形式の版。スナップショットの形を変えたら上げ、古い版を読む変換を足す */
export const BACKUP_FORMAT_VERSION = 1

/**
 * バックアップの鍵。2つの版（リリース版 / 開発版）は同じオリジンで localStorage を共有するので、
 * 公開先のパス（import.meta.env.BASE_URL）を含めて分ける。値は、新しい順に並べたバックアップの配列
 */
export const backupKey = (baseUrl: string, uid: string) => `cornix-keymapper:backup:${baseUrl}:${uid}`

/** 「書き込み中」の印の鍵 */
export const pendingWriteKey = (baseUrl: string, uid: string) => `cornix-keymapper:writing:${baseUrl}:${uid}`

/**
 * 保存できなかった原因。
 * unavailable: 保存先が使えない（ブラウザーの設定など）。quota: 容量の上限。
 * not-saved: 保存の操作は通ったが、読み戻すと保存した内容になっていない
 */
export type StorageFailure = 'unavailable' | 'quota' | 'not-saved'

/**
 * 読み込めない理由。
 * broken: 形式が壊れている。version: この版では読めない形式の版。snapshot: スナップショットの形が合わない
 */
export type UnreadableReason = 'broken' | 'version' | 'snapshot'

export interface Backup {
  /** 一覧の中で、このバックアップを指す名前。削除に使う */
  id: string
  /** 保存した日時（ISO 8601） */
  savedAt: string
  snapshot: KeyboardSnapshot
}

/** 一覧の1件。読み込めないものも、削除できるように返す */
export type BackupItem =
  | ({ readable: true } & Backup)
  // savedAt は、日時だけでも読めた時に入る
  | { readable: false; id: string; savedAt: string | null; reason: UnreadableReason }

/** 「書き込み中」の印。書き込みの途中でページを閉じた時などに残る */
export interface PendingWrite {
  /** 書き込みを始めた日時（ISO 8601） */
  startedAt: string
  /** 書き込み前の本体の内容。「書き込み前の状態に戻す」の相手。一覧からバックアップを消しても戻せるよう、印にも持つ */
  before: KeyboardSnapshot
  /** 書き込もうとしていた目標 */
  target: KeyboardSnapshot
}

export type PendingWriteState =
  | { status: 'none' }
  | ({ status: 'pending' } & PendingWrite)
  // 印はあるが読み込めない。startedAt は、日時だけでも読めた時に入る
  | { status: 'unreadable'; startedAt: string | null; reason: UnreadableReason }

export type StorageResult = { ok: true } | { ok: false; reason: StorageFailure }

/** added は、新しく1件増やしたか。直前のバックアップと同じ内容なら増やさず、その直前のものを返す */
export type SaveBackupResult = { ok: true; added: boolean; backup: Backup } | { ok: false; reason: StorageFailure }

export interface BackupStorage {
  /** その機器のバックアップ。新しい順。保存先が使えない時は空 */
  list(uid: string): BackupItem[]
  /** バックアップする。保存した直後に読み戻して確かめる。BACKUP_LIMIT を超えた分は、古いものから消す */
  save(snapshot: KeyboardSnapshot): SaveBackupResult
  /** 一覧の1件を消す。もうなければ、何もしない */
  remove(uid: string, id: string): StorageResult
  /** 「書き込み中」の印を付ける。保存した直後に読み戻して確かめる */
  markWriting(before: KeyboardSnapshot, target: KeyboardSnapshot): StorageResult
  /** その機器に残っている「書き込み中」の印。保存先が使えない時は、ないものとする */
  pendingWrite(uid: string): PendingWriteState
  clearPendingWrite(uid: string): StorageResult
}

export interface BackupStorageOptions {
  /** 保存先。使えない時は null */
  store: KeyValueStore | null
  /** 公開先のパス（import.meta.env.BASE_URL） */
  baseUrl: string
  /** いまの日時。テストで決まった値にする */
  now?: () => Date
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const dateOf = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null

// 一覧の中で指す名前は、保存してある中身から作る（FNV-1a）。壊れていて名前を持てないものも、同じ方法で指せる
function idOf(entry: unknown): string {
  const text = JSON.stringify(entry)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 版と日時を確かめる。読めなければ、その理由 */
function checkHeader(entry: Record<string, unknown>, date: string | null): UnreadableReason | null {
  if (typeof entry.version !== 'number') return 'broken'
  if (entry.version !== BACKUP_FORMAT_VERSION) return 'version'
  return date === null ? 'broken' : null
}

const isSnapshotOf = (value: unknown, uid: string): value is KeyboardSnapshot =>
  isKeyboardSnapshot(value) && value.uid === uid

function readBackup(entry: unknown, uid: string): BackupItem {
  const id = idOf(entry)
  if (!isRecord(entry)) return { readable: false, id, savedAt: null, reason: 'broken' }
  const savedAt = dateOf(entry.savedAt)
  const reason = checkHeader(entry, savedAt)
  if (reason || savedAt === null) return { readable: false, id, savedAt, reason: reason ?? 'broken' }
  const { snapshot } = entry
  if (!isSnapshotOf(snapshot, uid)) return { readable: false, id, savedAt, reason: 'snapshot' }
  return { readable: true, id, savedAt, snapshot }
}

function readPendingWrite(entry: unknown, uid: string): PendingWriteState {
  if (!isRecord(entry)) return { status: 'unreadable', startedAt: null, reason: 'broken' }
  const startedAt = dateOf(entry.startedAt)
  const reason = checkHeader(entry, startedAt)
  if (reason || startedAt === null) return { status: 'unreadable', startedAt, reason: reason ?? 'broken' }
  const { before, target } = entry
  if (!isSnapshotOf(before, uid) || !isSnapshotOf(target, uid)) return { status: 'unreadable', startedAt, reason: 'snapshot' }
  return { status: 'pending', startedAt, before, target }
}

/** JSON として読む。読めなければ、元の文字列をそのまま返す（壊れたものとして扱える） */
function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// 保存してある値を、バックアップの並びとして読む。配列でなければ、全体を、壊れた1件として扱う
function entriesOf(text: string | null): unknown[] {
  if (text === null) return []
  const value = parse(text)
  return Array.isArray(value) ? value : [value]
}

// Firefox は、名前が違う
const isQuotaError = (error: unknown) =>
  isRecord(error) && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')

const failed = (reason: StorageFailure) => ({ ok: false as const, reason })

export function createBackupStorage({ store, baseUrl, now = () => new Date() }: BackupStorageOptions): BackupStorage {
  /** 読む。保存先が使えなければ undefined、何もなければ null */
  const load = (key: string): string | null | undefined => {
    try {
      return store ? store.getItem(key) : undefined
    } catch {
      return undefined
    }
  }

  /** 書く（text が null なら消す）。失敗したら、その原因 */
  const put = (key: string, text: string | null): StorageFailure | null => {
    if (!store) return 'unavailable'
    try {
      if (text === null) store.removeItem(key)
      else store.setItem(key, text)
      return null
    } catch (error) {
      return isQuotaError(error) ? 'quota' : 'unavailable'
    }
  }

  const list = (uid: string): BackupItem[] =>
    entriesOf(load(backupKey(baseUrl, uid)) ?? null).map((entry) => readBackup(entry, uid))

  const pendingWrite = (uid: string): PendingWriteState => {
    const text = load(pendingWriteKey(baseUrl, uid))
    return text === undefined || text === null ? { status: 'none' } : readPendingWrite(parse(text), uid)
  }

  return {
    list,

    save(snapshot) {
      const key = backupKey(baseUrl, snapshot.uid)
      const text = load(key)
      if (text === undefined) return failed('unavailable')
      // 読み込めないものも、そのまま残す。数には入れ、古くなれば、ほかと同じに消える
      const entries = entriesOf(text)
      const latest = entries.length > 0 ? readBackup(entries[0], snapshot.uid) : null
      if (latest?.readable && sameSnapshot(latest.snapshot, snapshot)) {
        return { ok: true, added: false, backup: { id: latest.id, savedAt: latest.savedAt, snapshot: latest.snapshot } }
      }

      const savedAt = now().toISOString()
      const entry = { version: BACKUP_FORMAT_VERSION, savedAt, snapshot }
      const failure = put(key, JSON.stringify([entry, ...entries].slice(0, BACKUP_LIMIT)))
      if (failure) return failed(failure)

      // 一覧と同じ読み方で読み戻す。読めて、渡された内容と同じなら、保存できている
      const saved = list(snapshot.uid).at(0)
      if (!saved?.readable || saved.savedAt !== savedAt || !sameSnapshot(saved.snapshot, snapshot)) return failed('not-saved')
      return { ok: true, added: true, backup: { id: saved.id, savedAt, snapshot: saved.snapshot } }
    },

    remove(uid, id) {
      const key = backupKey(baseUrl, uid)
      const text = load(key)
      if (text === undefined) return failed('unavailable')
      const entries = entriesOf(text)
      const index = entries.findIndex((entry) => idOf(entry) === id)
      if (index < 0) return { ok: true }
      const rest = entries.toSpliced(index, 1)
      const failure = put(key, rest.length > 0 ? JSON.stringify(rest) : null)
      if (failure) return failed(failure)
      return list(uid).length === rest.length ? { ok: true } : failed('not-saved')
    },

    markWriting(before, target) {
      const startedAt = now().toISOString()
      const entry = { version: BACKUP_FORMAT_VERSION, startedAt, before, target }
      const failure = put(pendingWriteKey(baseUrl, before.uid), JSON.stringify(entry))
      if (failure) return failed(failure)

      const saved = pendingWrite(before.uid)
      const same =
        saved.status === 'pending' &&
        saved.startedAt === startedAt &&
        sameSnapshot(saved.before, before) &&
        sameSnapshot(saved.target, target)
      return same ? { ok: true } : failed('not-saved')
    },

    pendingWrite,

    clearPendingWrite(uid) {
      const key = pendingWriteKey(baseUrl, uid)
      const failure = put(key, null)
      if (failure) return failed(failure)
      return load(key) === null ? { ok: true } : failed('not-saved')
    },
  }
}

/** ブラウザーの localStorage。ない所（テスト）や、触ると失敗する設定のブラウザーでは null */
function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 本物の保存先（localStorage）を使うもの。画面の起動時に呼ぶ。読み込んだだけでは localStorage に触らない */
export const browserBackupStorage = (): BackupStorage =>
  createBackupStorage({ store: browserStore(), baseUrl: import.meta.env.BASE_URL })
