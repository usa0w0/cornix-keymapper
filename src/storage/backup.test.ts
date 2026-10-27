import { afterEach, expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_LIMIT,
  backupKey,
  browserBackupStorage,
  createBackupStorage,
  pendingWriteKey,
  type BackupItem,
} from './backup.ts'
import { createFakeStore, type FakeStore } from './fakeStore.ts'

const RELEASE = '/cornix-keymapper/'
const DEV = '/cornix-keymapper/dev/'

/** 実機から読んだ設定の写し。n を変えると、キーを1つ変えた別の内容になる */
function snapshotOf(n = 0, uid?: string): KeyboardSnapshot {
  const snapshot = structuredClone(recorded.snapshot) as unknown as KeyboardSnapshot
  if (n > 0) snapshot.keymap[0][0] = 0x0100 + n
  if (uid) snapshot.uid = uid
  return snapshot
}

const UID = snapshotOf().uid

/** 呼ぶたびに1分進む時計を持つ保存先 */
function setup(store: FakeStore | null = createFakeStore(), baseUrl = RELEASE) {
  let minute = 0
  const now = () => new Date(Date.UTC(2026, 9, 12, 3, minute++))
  return { store: store!, backups: createBackupStorage({ store, baseUrl, now }) }
}

const firstKeys = (items: BackupItem[]) => items.map((item) => (item.readable ? item.snapshot.keymap[0][0] : null))

test('保存したバックアップを読み戻すと、レイアウト定義も含めて、元と同じ内容になる', () => {
  const { backups } = setup()
  const snapshot = snapshotOf()

  const result = backups.save(snapshot)
  expect(result).toMatchObject({ ok: true, added: true, backup: { savedAt: '2026-10-12T03:00:00.000Z' } })

  const items = backups.list(UID)
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ readable: true, savedAt: '2026-10-12T03:00:00.000Z' })
  const [item] = items
  if (!item.readable) throw new Error('読み込めない')
  expect(item.snapshot).toEqual(snapshotOf())
  expect(item.snapshot.layout.raw).toEqual(recorded.snapshot.layout.raw)
  // 保存した後に、渡したものや、読んだものを書き換えても、保存してある内容は変わらない
  snapshot.keymap[0][0] = 0xffff
  item.snapshot.keymap[0][1] = 0xffff
  expect(backups.list(UID)[0]).toMatchObject({ snapshot: snapshotOf() })
})

test('一覧は新しい順。保存した日時が付く', () => {
  const { backups } = setup()
  backups.save(snapshotOf(1))
  backups.save(snapshotOf(2))
  backups.save(snapshotOf(3))

  const items = backups.list(UID)
  expect(firstKeys(items)).toEqual([0x0103, 0x0102, 0x0101])
  expect(items.map((item) => item.savedAt)).toEqual([
    '2026-10-12T03:02:00.000Z',
    '2026-10-12T03:01:00.000Z',
    '2026-10-12T03:00:00.000Z',
  ])
  expect(new Set(items.map((item) => item.id)).size).toBe(3)
})

test(`${BACKUP_LIMIT} 回を超えた分は、古いものから消える`, () => {
  const { backups } = setup()
  for (let n = 1; n <= BACKUP_LIMIT + 2; n++) expect(backups.save(snapshotOf(n))).toMatchObject({ ok: true, added: true })

  expect(firstKeys(backups.list(UID))).toEqual([0x0107, 0x0106, 0x0105, 0x0104, 0x0103])
})

test('直前のバックアップと同じ内容なら増やさない。日時も変えない', () => {
  const { backups } = setup()
  backups.save(snapshotOf(1))
  const first = backups.save(snapshotOf(2))
  const again = backups.save(snapshotOf(2))

  expect(again).toMatchObject({ ok: true, added: false, backup: { savedAt: '2026-10-12T03:01:00.000Z' } })
  expect(again.ok && first.ok && again.backup.id === first.backup.id).toBe(true)
  expect(firstKeys(backups.list(UID))).toEqual([0x0102, 0x0101])

  // 同じなのは「直前」とだけ比べる。前の前と同じ内容は、新しく保存する
  expect(backups.save(snapshotOf(1))).toMatchObject({ ok: true, added: true })
  expect(firstKeys(backups.list(UID))).toEqual([0x0101, 0x0102, 0x0101])
})

test('機器（UID）ごとに分かれる', () => {
  const { backups } = setup()
  backups.save(snapshotOf(1))
  backups.save(snapshotOf(2, 'other'))
  for (let n = 3; n < 3 + BACKUP_LIMIT; n++) backups.save(snapshotOf(n, 'other'))

  expect(firstKeys(backups.list(UID))).toEqual([0x0101])
  expect(backups.list('other')).toHaveLength(BACKUP_LIMIT)
  expect(backups.list('none')).toEqual([])
})

test('開発版とリリース版で、保存先が分かれる', () => {
  const store = createFakeStore()
  const release = setup(store, RELEASE).backups
  const dev = setup(store, DEV).backups

  expect(backupKey(RELEASE, UID)).not.toBe(backupKey(DEV, UID))
  expect(pendingWriteKey(RELEASE, UID)).not.toBe(pendingWriteKey(DEV, UID))
  expect(new Set([backupKey(RELEASE, UID), backupKey(DEV, UID), pendingWriteKey(RELEASE, UID), pendingWriteKey(DEV, UID)]).size).toBe(4)

  release.save(snapshotOf(1))
  dev.save(snapshotOf(2))
  dev.save(snapshotOf(3))
  dev.markWriting(snapshotOf(3), snapshotOf(4))

  expect(firstKeys(release.list(UID))).toEqual([0x0101])
  expect(firstKeys(dev.list(UID))).toEqual([0x0103, 0x0102])
  expect(release.pendingWrite(UID)).toEqual({ status: 'none' })
  expect(dev.pendingWrite(UID)).toMatchObject({ status: 'pending' })
  expect([...store.items.keys()].sort()).toEqual([backupKey(DEV, UID), backupKey(RELEASE, UID), pendingWriteKey(DEV, UID)].sort())

  // 片方を消しても、もう片方は残る
  const [item] = dev.list(UID)
  dev.remove(UID, item.id)
  dev.clearPendingWrite(UID)
  expect(firstKeys(release.list(UID))).toEqual([0x0101])
})

test('一覧から選んで消せる。最後の1件を消すと、鍵ごとなくなる', () => {
  const { store, backups } = setup()
  backups.save(snapshotOf(1))
  backups.save(snapshotOf(2))
  backups.save(snapshotOf(3))

  const [, middle] = backups.list(UID)
  expect(backups.remove(UID, middle.id)).toEqual({ ok: true })
  expect(firstKeys(backups.list(UID))).toEqual([0x0103, 0x0101])
  // もうないものを消しても、何も起きない
  expect(backups.remove(UID, middle.id)).toEqual({ ok: true })
  expect(firstKeys(backups.list(UID))).toEqual([0x0103, 0x0101])

  for (const item of backups.list(UID)) backups.remove(UID, item.id)
  expect(backups.list(UID)).toEqual([])
  expect(store.items.size).toBe(0)
})

test('容量の上限で保存できない時は、原因を返す。前のバックアップは残る', () => {
  const { store, backups } = setup()
  backups.save(snapshotOf(1))
  const before = store.items.get(backupKey(RELEASE, UID))!
  store.quota = backupKey(RELEASE, UID).length + before.length + 100

  expect(backups.save(snapshotOf(2))).toEqual({ ok: false, reason: 'quota' })
  expect(store.items.get(backupKey(RELEASE, UID))).toBe(before)
  expect(firstKeys(backups.list(UID))).toEqual([0x0101])
  expect(backups.markWriting(snapshotOf(1), snapshotOf(2))).toEqual({ ok: false, reason: 'quota' })
  expect(backups.pendingWrite(UID)).toEqual({ status: 'none' })

  // 同じ内容の保存は、書き足さないので通る
  expect(backups.save(snapshotOf(1))).toMatchObject({ ok: true, added: false })
})

test('Firefox の容量の失敗（名前が違う）も、容量の上限として返す', () => {
  const store = createFakeStore()
  store.setItem = () => {
    throw new DOMException('Persistent storage maximum size reached', 'NS_ERROR_DOM_QUOTA_REACHED')
  }
  expect(setup(store).backups.save(snapshotOf())).toEqual({ ok: false, reason: 'quota' })
})

test('保存先が使えない時は、例外にせず、原因を返す。一覧は空、印はないものとする', () => {
  const blocked = createFakeStore()
  blocked.blocked = true

  for (const { backups } of [setup(blocked), setup(null)]) {
    expect(backups.save(snapshotOf())).toEqual({ ok: false, reason: 'unavailable' })
    expect(backups.list(UID)).toEqual([])
    expect(backups.remove(UID, 'x')).toEqual({ ok: false, reason: 'unavailable' })
    expect(backups.markWriting(snapshotOf(), snapshotOf(1))).toEqual({ ok: false, reason: 'unavailable' })
    expect(backups.pendingWrite(UID)).toEqual({ status: 'none' })
    expect(backups.clearPendingWrite(UID)).toEqual({ ok: false, reason: 'unavailable' })
  }
})

test('保存の操作が通っても、読み戻して保存した内容になっていなければ、失敗を返す', () => {
  const { store, backups } = setup()
  backups.save(snapshotOf(1))
  store.dropWrites = true

  expect(backups.save(snapshotOf(2))).toEqual({ ok: false, reason: 'not-saved' })
  expect(backups.markWriting(snapshotOf(1), snapshotOf(2))).toEqual({ ok: false, reason: 'not-saved' })
  expect(firstKeys(backups.list(UID))).toEqual([0x0101])
})

test('スナップショットの形をしていないものは、保存できたことにしない', () => {
  const { backups } = setup()
  const broken = snapshotOf()
  broken.keymap[0][0] = NaN

  expect(backups.save(broken)).toEqual({ ok: false, reason: 'not-saved' })
  // 目標が、書き込み前と別の機器のもの
  expect(backups.markWriting(snapshotOf(), snapshotOf(1, 'other'))).toEqual({ ok: false, reason: 'not-saved' })
})

const entry = (n: number, changes: Record<string, unknown> = {}) => ({
  version: BACKUP_FORMAT_VERSION,
  savedAt: `2026-10-0${n}T00:00:00.000Z`,
  snapshot: snapshotOf(n),
  ...changes,
})

test('読み込めないバックアップは、例外にせず、読み込めないものとして一覧に返す', () => {
  const noLayout: Partial<KeyboardSnapshot> = snapshotOf(3)
  delete noLayout.layout
  const shortLayer = snapshotOf(4)
  shortLayer.keymap[2].pop()
  const stored = [
    entry(1),
    entry(2, { version: BACKUP_FORMAT_VERSION + 1 }),
    entry(3, { snapshot: noLayout }),
    entry(4, { snapshot: shortLayer }),
    entry(5, { snapshot: snapshotOf(5, 'other') }),
    entry(6, { savedAt: 'いつか' }),
    entry(7, { version: undefined }),
    'こわれた',
    null,
  ]
  const { backups } = setup(createFakeStore({ [backupKey(RELEASE, UID)]: JSON.stringify(stored) }))

  const items = backups.list(UID)
  expect(items.map((item) => (item.readable ? 'ok' : item.reason))).toEqual([
    'ok',
    'version',
    'snapshot',
    'snapshot',
    'snapshot',
    'broken',
    'broken',
    'broken',
    'broken',
  ])
  // 日時が読めたものは、日時つきで返す
  expect(items.map((item) => item.savedAt?.slice(0, 10) ?? null)).toEqual([
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    null,
    '2026-10-07',
    null,
    null,
  ])
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
})

test('読み込めないバックアップも、選んで消せる', () => {
  const stored = [entry(1), entry(2, { version: 99 }), 'こわれた', entry(4)]
  const { backups } = setup(createFakeStore({ [backupKey(RELEASE, UID)]: JSON.stringify(stored) }))

  for (const item of backups.list(UID)) if (!item.readable) expect(backups.remove(UID, item.id)).toEqual({ ok: true })
  expect(firstKeys(backups.list(UID))).toEqual([0x0101, 0x0104])
})

test.each([
  ['JSON でない', '{"version":1,'],
  ['配列でない', JSON.stringify({ version: 1, savedAt: '2026-10-01T00:00:00.000Z' })],
  ['空の文字列', ''],
])('保存してある値の全体が壊れている時（%s）は、読み込めない1件として返し、消せる', (_, text) => {
  const { store, backups } = setup(createFakeStore({ [backupKey(RELEASE, UID)]: text }))

  const items = backups.list(UID)
  expect(items).toMatchObject([{ readable: false }])
  expect(backups.remove(UID, items[0].id)).toEqual({ ok: true })
  expect(store.items.size).toBe(0)
})

test('読み込めないものが残っていても、新しいバックアップを保存できる。読み込めないものは、消さずに後ろへ送る', () => {
  const { store, backups } = setup(createFakeStore({ [backupKey(RELEASE, UID)]: '{"version":1,' }))

  expect(backups.save(snapshotOf(1))).toMatchObject({ ok: true, added: true })
  expect(backups.list(UID)).toMatchObject([{ readable: true }, { readable: false, reason: 'broken' }])

  // 読み込めないものも数に入り、古くなれば消える
  for (let n = 2; n <= BACKUP_LIMIT; n++) backups.save(snapshotOf(n))
  expect(backups.list(UID).map((item) => item.readable)).toEqual([true, true, true, true, true])
  expect(JSON.parse(store.items.get(backupKey(RELEASE, UID))!)).toHaveLength(BACKUP_LIMIT)
})

test('直前のバックアップが読み込めない時は、同じ内容かを比べずに、新しく保存する', () => {
  const stored = [entry(1, { version: 99 })]
  const { backups } = setup(createFakeStore({ [backupKey(RELEASE, UID)]: JSON.stringify(stored) }))

  expect(backups.save(snapshotOf(1))).toMatchObject({ ok: true, added: true })
  expect(backups.list(UID).map((item) => item.readable)).toEqual([true, false])
})

test('「書き込み中」の印を保存、読み出し、消去できる。書き込み前の内容と、目標、始めた日時が入る', () => {
  const { store, backups } = setup()
  expect(backups.pendingWrite(UID)).toEqual({ status: 'none' })

  expect(backups.markWriting(snapshotOf(1), snapshotOf(2))).toEqual({ ok: true })
  expect(backups.pendingWrite(UID)).toEqual({
    status: 'pending',
    startedAt: '2026-10-12T03:00:00.000Z',
    before: snapshotOf(1),
    target: snapshotOf(2),
  })
  // 印は、機器ごと。バックアップの一覧には出ない
  expect(backups.pendingWrite('other')).toEqual({ status: 'none' })
  expect(backups.list(UID)).toEqual([])

  // 付け直すと、置き換わる
  expect(backups.markWriting(snapshotOf(3), snapshotOf(4))).toEqual({ ok: true })
  expect(backups.pendingWrite(UID)).toMatchObject({ startedAt: '2026-10-12T03:01:00.000Z', before: snapshotOf(3) })

  expect(backups.clearPendingWrite(UID)).toEqual({ ok: true })
  expect(backups.pendingWrite(UID)).toEqual({ status: 'none' })
  expect(store.items.size).toBe(0)
  // ない印を消しても、失敗にしない
  expect(backups.clearPendingWrite(UID)).toEqual({ ok: true })
})

test('印の元になったバックアップを一覧から消しても、印から書き込み前の内容を読める', () => {
  const { backups } = setup()
  const saved = backups.save(snapshotOf(1))
  backups.markWriting(snapshotOf(1), snapshotOf(2))
  if (saved.ok) backups.remove(UID, saved.backup.id)

  expect(backups.list(UID)).toEqual([])
  expect(backups.pendingWrite(UID)).toMatchObject({ status: 'pending', before: snapshotOf(1) })
})

test.each([
  ['JSON でない', '{"version":1,', 'broken', null],
  ['版が読めない', JSON.stringify({ version: 2, startedAt: '2026-10-01T00:00:00.000Z', before: {}, target: {} }), 'version', '2026-10-01T00:00:00.000Z'],
  [
    '目標がスナップショットの形でない',
    JSON.stringify({ version: 1, startedAt: '2026-10-01T00:00:00.000Z', before: snapshotOf(1), target: { uid: UID } }),
    'snapshot',
    '2026-10-01T00:00:00.000Z',
  ],
  [
    '書き込み前の内容がない',
    JSON.stringify({ version: 1, startedAt: '2026-10-01T00:00:00.000Z', target: snapshotOf(1) }),
    'snapshot',
    '2026-10-01T00:00:00.000Z',
  ],
  ['日時がない', JSON.stringify({ version: 1, before: snapshotOf(1), target: snapshotOf(2) }), 'broken', null],
])('読み込めない印（%s）は、例外にせず、読み込めないものとして返す。消せる', (_, text, reason, startedAt) => {
  const { backups } = setup(createFakeStore({ [pendingWriteKey(RELEASE, UID)]: text }))

  expect(backups.pendingWrite(UID)).toEqual({ status: 'unreadable', startedAt, reason })
  expect(backups.clearPendingWrite(UID)).toEqual({ ok: true })
  expect(backups.pendingWrite(UID)).toEqual({ status: 'none' })
})

test('印が消えていなければ、消去の失敗を返す', () => {
  const { store, backups } = setup()
  backups.markWriting(snapshotOf(1), snapshotOf(2))
  store.removeItem = () => {}

  expect(backups.clearPendingWrite(UID)).toEqual({ ok: false, reason: 'not-saved' })
})

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})

test('本物の保存先の入口は、localStorage がない所や、触ると失敗する所でも落ちない', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
  expect(browserBackupStorage().save(snapshotOf())).toEqual({ ok: false, reason: 'unavailable' })

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  })
  const backups = browserBackupStorage()
  expect(backups.save(snapshotOf())).toEqual({ ok: false, reason: 'unavailable' })
  expect(backups.list(UID)).toEqual([])
})

test('本物の保存先の入口は、localStorage に、公開先のパスを含む鍵で保存する', () => {
  const store = createFakeStore()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })

  expect(browserBackupStorage().save(snapshotOf())).toMatchObject({ ok: true, added: true })
  expect([...store.items.keys()]).toEqual([backupKey(import.meta.env.BASE_URL, UID)])
})
