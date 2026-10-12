import { expect, test } from 'vitest'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import { FakeKeyboard, type FakeFailures } from '../device/fake/fakeDevice.ts'
import type { KeyboardDevice, KeyboardSnapshot, WriteOperation } from '../device/types.ts'
import type { Action } from '../model/action.ts'
import { writeOperations } from '../model/diff.ts'
import {
  createBackupStorage,
  pendingWriteKey,
  type BackupStorage,
  type KeyValueStore,
  type StorageFailure,
} from '../storage/backup.ts'
import { createFakeStore, type FakeStore } from '../storage/fakeStore.ts'
import { addCombo, buildTarget, editEncoder, editKey, loadSnapshot } from './editState.ts'
import {
  continueWithCurrent,
  interruptedWrite,
  restoreWrite,
  retryWrite,
  startWrite,
  type StartOutcome,
  type WriteDeps,
  type WriteOutcome,
  type WriteStage,
} from './writeSession.ts'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const B: Action = { kind: 'key', code: 0x05, mods: [] }
const BASE_URL = '/cornix-keymapper/'
const NOW = new Date('2026-10-12T01:32:00.000Z')

/** 書き込み前の本体の内容 */
const BEFORE = cornixSnapshot()
const UID = BEFORE.uid

/**
 * 目標。キー2つ（片方は Tap Dance の枠を新しく使う）、エンコーダーの1方向、コンボを変える。
 * 機器に送る操作は、新しく使う枠、キー、キー、エンコーダー、コンボの 5 つになる
 */
const TARGET = (() => {
  let state = loadSnapshot(BEFORE)
  state = editKey(state, 0, 8, { tap: B })
  state = editKey(state, 0, 9, { tap: A, doubleTap: B })
  state = editEncoder(state, 0, 0, 'left', A)
  state = addCombo(state, { keys: [0x04, 0x05], output: B })
  return buildTarget(state)
})()
const OPERATIONS = writeOperations(BEFORE, TARGET)

test('テストの前提: 目標は、書き込み前の内容と 5 つの操作ぶん違う', () => {
  expect(OPERATIONS.map((operation) => operation.type)).toEqual(['setTapDance', 'setKey', 'setKey', 'setEncoder', 'setCombo'])
})

interface Setup {
  keyboard: FakeKeyboard
  store: FakeStore
  backups: BackupStorage
  device: KeyboardDevice
  stages: WriteStage[]
  deps: WriteDeps
}

async function setup(failures: FakeFailures = {}, storeFor: (store: FakeStore) => KeyValueStore = (store) => store): Promise<Setup> {
  const keyboard = new FakeKeyboard(BEFORE, { failures })
  const store = createFakeStore()
  const backups = createBackupStorage({ store: storeFor(store), baseUrl: BASE_URL, now: () => NOW })
  const device = await keyboard.connect()
  const stages: WriteStage[] = []
  return { keyboard, store, backups, device, stages, deps: { device, backups, onStage: (stage) => stages.push(stage) } }
}

/** バックアップに残っている内容（新しい順） */
const backedUp = ({ backups }: Setup) => backups.list(UID).map((item) => (item.readable ? item.snapshot : item.reason))

const mark = ({ backups }: Setup) => backups.pendingWrite(UID)

/** 「書き込み中」の印が、書き込み前の内容と目標を持って残っている */
function expectMarked(s: Setup, before: KeyboardSnapshot = BEFORE, target: KeyboardSnapshot = TARGET) {
  expect(mark(s)).toEqual({ status: 'pending', startedAt: NOW.toISOString(), before, target })
}

function expectFailed(outcome: StartOutcome): asserts outcome is Extract<WriteOutcome, { status: 'failed' }> {
  expect(outcome.status).toBe('failed')
}

const start = (s: Setup, expected: KeyboardSnapshot = BEFORE, target: KeyboardSnapshot = TARGET) =>
  startWrite(s.deps, { expected, target })

// ---- うまくいく ----

test('うまくいく: 本体は目標になり、書き込み前の内容がバックアップに残り、印は消える', async () => {
  const s = await setup()
  const outcome = await start(s)

  expect(outcome).toEqual({ status: 'done', verified: TARGET, written: 5, markCleared: true })
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(mark(s)).toEqual({ status: 'none' })
  // 書く前の読み直しと、照合の読み直し
  expect(s.keyboard.readCount).toBe(2)
  expect(s.keyboard.writeCount).toBe(5)
})

test('うまくいく: 読み直し → バックアップ → 書き込み → 照合の順に、進み具合を知らせる', async () => {
  const s = await setup()
  await start(s)

  const order = s.stages.map((stage) => stage.stage).filter((stage, index, all) => stage !== all[index - 1])
  expect(order).toEqual(['reading', 'backup', 'writing', 'verifying'])
  const writing = s.stages.flatMap((stage) => (stage.stage === 'writing' ? [[stage.done, stage.total]] : []))
  expect(writing).toEqual([0, 1, 2, 3, 4, 5].map((done) => [done, 5]))
})

test('バックアップと印は、書き始める前に保存してある', async () => {
  const s = await setup()
  let seen: unknown
  const device: KeyboardDevice = Object.assign(Object.create(s.device), {
    write: (operations: WriteOperation[]) => {
      seen = { backups: backedUp(s), mark: mark(s).status, written: s.keyboard.writeCount }
      return s.device.write(operations)
    },
  })
  await startWrite({ ...s.deps, device }, { expected: BEFORE, target: TARGET })

  expect(seen).toEqual({ backups: [BEFORE], mark: 'pending', written: 0 })
})

test('本体がすでに目標と同じなら、何も書かず、バックアップも増やさない', async () => {
  const s = await setup()
  const outcome = await start(s, BEFORE, BEFORE)

  expect(outcome).toEqual({ status: 'done', verified: BEFORE, written: 0, markCleared: true })
  expect(s.keyboard.writeCount).toBe(0)
  expect(backedUp(s)).toEqual([])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('続けて書き込むと、書き込みごとに、その直前の内容がバックアップに残る', async () => {
  const s = await setup()
  await start(s)
  const outcome = await start(s, TARGET, BEFORE)

  expect(outcome).toMatchObject({ status: 'done', written: 5 })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(backedUp(s)).toEqual([TARGET, BEFORE])
})

test('印を消せなかった時は、書き込みは通ったものとして、消せなかったことを返す', async () => {
  const s = await setup({}, (store) => ({
    ...store,
    removeItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  }))
  const outcome = await start(s)

  expect(outcome).toMatchObject({ status: 'done', written: 5, markCleared: false })
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expectMarked(s)
})

// ---- 途中の失敗 ----

test('途中の失敗: 何番目の操作で、なぜ失敗したかを返す。本体は書きかけで、バックアップと印が残る', async () => {
  const s = await setup({ failWriteAt: { operation: 3, kind: 'timeout' } })
  const outcome = await start(s)

  expect(outcome).toEqual({
    status: 'failed',
    job: { before: BEFORE, target: TARGET },
    failure: { kind: 'write', fault: { kind: 'timeout' }, index: 2, total: 5, operation: OPERATIONS[2] },
  })
  // 失敗した操作より前の 2 つだけが書かれている
  expect(writeOperations(s.keyboard.snapshot, TARGET)).toEqual(OPERATIONS.slice(2))
  expect(writeOperations(BEFORE, s.keyboard.snapshot)).toEqual(OPERATIONS.slice(0, 2))
  expect(backedUp(s)).toEqual([BEFORE])
  expectMarked(s)
})

test('途中の失敗からの再試行: 本体は目標になり、バックアップは増えず、印は消える', async () => {
  const s = await setup({ failWriteAt: { operation: 3 } })
  const first = await start(s)
  expectFailed(first)
  const outcome = await retryWrite(s.deps, first.job)

  // 残りの 3 つだけを書く
  expect(outcome).toEqual({ status: 'done', verified: TARGET, written: 3, markCleared: true })
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('再試行も途中で失敗したら、もう一度選べる。バックアップと印は残ったまま', async () => {
  const s = await setup({ failWriteAt: { operation: 3 } })
  const first = await start(s)
  expectFailed(first)
  // 偽の機器は、失敗した操作も数える。再試行の 2 つ目の操作は、通しで 5 番目
  s.keyboard.failures.failWriteAt = { operation: 5, kind: 'send-failed' }
  const second = await retryWrite(s.deps, first.job)

  expect(second).toEqual({
    status: 'failed',
    job: first.job,
    // 残りの 3 つのうち、2 つ目で失敗した
    failure: { kind: 'write', fault: { kind: 'send-failed' }, index: 1, total: 3, operation: OPERATIONS[3] },
  })
  expect(backedUp(s)).toEqual([BEFORE])
  expectMarked(s)

  expectFailed(second)
  expect(await retryWrite(s.deps, second.job)).toMatchObject({ status: 'done', written: 2 })
  expect(backedUp(s)).toEqual([BEFORE])
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expect(mark(s)).toEqual({ status: 'none' })
})

test('途中の失敗からの復元: 本体は書き込み前の内容に戻り、バックアップは残り、印は消える', async () => {
  const s = await setup({ failWriteAt: { operation: 3 } })
  const first = await start(s)
  expectFailed(first)
  const outcome = await restoreWrite(s.deps, first.job)

  // 書かれていた 2 つだけを戻す
  expect(outcome).toEqual({ status: 'done', verified: BEFORE, written: 2, markCleared: true })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('復元も途中で失敗したら、もう一度選べる。その後の再試行でも、復元でも、終えられる', async () => {
  const s = await setup({ failWriteAt: { operation: 4 } })
  const first = await start(s)
  expectFailed(first)
  s.keyboard.failures.failWriteAt = { operation: 6 }
  const second = await restoreWrite(s.deps, first.job)

  expect(second).toMatchObject({ status: 'failed', failure: { kind: 'write', index: 1, total: 3 } })
  expectMarked(s)
  expectFailed(second)
  expect(await restoreWrite(s.deps, second.job)).toMatchObject({ status: 'done', verified: BEFORE })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('復元した後に、同じ内容からもう一度書き込んでも、バックアップは増えない', async () => {
  const s = await setup({ failWriteAt: { operation: 3 } })
  const first = await start(s)
  expectFailed(first)
  await restoreWrite(s.deps, first.job)
  const outcome = await start(s)

  expect(outcome).toMatchObject({ status: 'done', written: 5 })
  expect(backedUp(s)).toEqual([BEFORE])
})

test('機器の実装が想定外の失敗をしても、失敗として返し、印を残す', async () => {
  const s = await setup()
  const device: KeyboardDevice = Object.assign(Object.create(s.device), {
    write: () => Promise.reject(new RangeError('本体にない場所への書き込み')),
  })
  const outcome = await startWrite({ ...s.deps, device }, { expected: BEFORE, target: TARGET })

  expect(outcome).toMatchObject({
    status: 'failed',
    failure: { kind: 'write', fault: { kind: 'unknown', message: '本体にない場所への書き込み' }, index: 0, total: 5 },
  })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expectMarked(s)
})

// ---- 照合 ----

test('照合の不一致: 違っている所を返す。バックアップと印が残る', async () => {
  // 照合の読み直し（2 回目の読み出し）で、書いたキーの1つが、書く前の値のまま読める
  const s = await setup({ alterReadAt: { read: 2, alter: (snapshot) => (snapshot.keymap[0][8] = BEFORE.keymap[0][8]) } })
  const outcome = await start(s)

  expect(outcome).toEqual({
    status: 'failed',
    job: { before: BEFORE, target: TARGET },
    failure: { kind: 'mismatch', written: 5, remaining: [{ type: 'setKey', layer: 0, key: 8, keycode: TARGET.keymap[0][8] }] },
  })
  expect(backedUp(s)).toEqual([BEFORE])
  expectMarked(s)
})

test('照合の不一致からの再試行: 読み直して目標と同じなら、何も書かずに終わる', async () => {
  const s = await setup({ alterReadAt: { read: 2, alter: (snapshot) => (snapshot.keymap[0][8] = BEFORE.keymap[0][8]) } })
  const first = await start(s)
  expectFailed(first)
  const outcome = await retryWrite(s.deps, first.job)

  expect(outcome).toEqual({ status: 'done', verified: TARGET, written: 0, markCleared: true })
  expect(s.keyboard.writeCount).toBe(5)
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expect(mark(s)).toEqual({ status: 'none' })
})

/** あるキーへの書き込みだけが効かない機器（応答は返すが、中身が変わらない） */
function ignoringKey(device: KeyboardDevice, layer: number, key: number): KeyboardDevice {
  return Object.assign(Object.create(device), {
    write: (operations: WriteOperation[], onProgress?: Parameters<KeyboardDevice['write']>[1]) =>
      device.write(
        operations.filter((operation) => !(operation.type === 'setKey' && operation.layer === layer && operation.key === key)),
        onProgress,
      ),
  })
}

test('書き込みが効かないキーがあると、照合で気づく。再試行しても同じで、復元すると書き込み前の内容に戻る', async () => {
  const s = await setup()
  const deps = { ...s.deps, device: ignoringKey(s.device, 0, 8) }
  const first = await startWrite(deps, { expected: BEFORE, target: TARGET })

  expect(first).toMatchObject({ status: 'failed', failure: { kind: 'mismatch', remaining: [{ type: 'setKey', layer: 0, key: 8 }] } })
  expectFailed(first)
  const second = await retryWrite(deps, first.job)
  expect(second).toMatchObject({ status: 'failed', failure: { kind: 'mismatch', written: 1, remaining: [{ type: 'setKey', layer: 0, key: 8 }] } })
  expectMarked(s)

  expectFailed(second)
  expect(await restoreWrite(deps, second.job)).toMatchObject({ status: 'done', verified: BEFORE })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('照合の読み直しに失敗: 書き終えているが、確かめられていないので、失敗として印を残す。再試行で確かめ直せる', async () => {
  const s = await setup({ failReadAt: { read: 2, step: 'Tap Dance', kind: 'timeout' } })
  const first = await start(s)

  expect(first).toEqual({
    status: 'failed',
    job: { before: BEFORE, target: TARGET },
    failure: { kind: 'verify', fault: { kind: 'timeout', step: 'Tap Dance' }, written: 5 },
  })
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expectMarked(s)

  expectFailed(first)
  expect(await retryWrite(s.deps, first.job)).toEqual({ status: 'done', verified: TARGET, written: 0, markCleared: true })
  expect(mark(s)).toEqual({ status: 'none' })
})

// ---- 書き込み前に本体が変わっていた ----

/** Vial など、ほかのアプリが、読み込んだ後に本体の設定を変えた */
function changeElsewhere(s: Setup): KeyboardSnapshot {
  s.keyboard.snapshot.keymap[1][0] = 0x0010
  // 目標でも変えるキーを、ほかのアプリも変えている
  s.keyboard.snapshot.keymap[0][8] = 0x0011
  return structuredClone(s.keyboard.snapshot)
}

test('書き込み前に本体が変わっていた: もう一度読んで確かめ、何も書かずに止める（やめる・読み込み直すを選んだ時は、このまま）', async () => {
  const s = await setup()
  const changed = changeElsewhere(s)
  const outcome = await start(s)

  expect(outcome).toEqual({ status: 'changed', reason: 'settings', fresh: changed })
  expect(s.keyboard.readCount).toBe(2)
  expect(s.keyboard.writeCount).toBe(0)
  expect(s.keyboard.snapshot).toEqual(changed)
  expect(backedUp(s)).toEqual([])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('書き込み前に本体が変わっていた → 読み込み直す: 読み直した内容から編集を始め直せる（本体には触らない）', async () => {
  const s = await setup()
  const changed = changeElsewhere(s)
  const outcome = await start(s)
  if (outcome.status !== 'changed') throw new Error('changed になるはず')
  const reloaded = loadSnapshot(outcome.fresh)

  expect(buildTarget(reloaded)).toEqual(changed)
  // 読み込み直した内容を基準にすれば、次の書き込みは止まらない
  const next = buildTarget(editKey(reloaded, 0, 9, { tap: B }))
  expect(await start(s, reloaded.baseline, next)).toMatchObject({ status: 'done', written: 1 })
  expect(backedUp(s)).toEqual([changed])
})

test('書き込み前に本体が変わっていた → 上書きする: 本体は目標になり、上書きする前の内容がバックアップに残る', async () => {
  const s = await setup()
  const changed = changeElsewhere(s)
  const first = await start(s)
  if (first.status !== 'changed') throw new Error('changed になるはず')
  // 利用者が「このまま上書きする」を選んだ。確かめてもらった内容（読み直した内容）を、期待する内容として渡す
  const outcome = await start(s, first.fresh)

  // ほかのアプリが変えた 1 つを戻す操作が、5 つに加わる
  expect(outcome).toEqual({ status: 'done', verified: TARGET, written: 6, markCleared: true })
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expect(backedUp(s)).toEqual([changed])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('上書きの途中で失敗した時に戻す相手は、上書きする前の内容（ほかのアプリが変えた後の内容）', async () => {
  const s = await setup({ failWriteAt: { operation: 4 } })
  const changed = changeElsewhere(s)
  const outcome = await start(s, changed)

  expectFailed(outcome)
  expectMarked(s, changed)
  expect(await restoreWrite(s.deps, outcome.job)).toMatchObject({ status: 'done', verified: changed })
  expect(s.keyboard.snapshot).toEqual(changed)
})

test('上書きを選ぶまでの間に、本体がさらに変わっていたら、もう一度止める', async () => {
  const s = await setup()
  const first = await start(s)
  expect(first.status).toBe('done')
  const seen = changeElsewhere(s)
  s.keyboard.snapshot.keymap[2][0] = 0x0012
  const outcome = await start(s, seen, BEFORE)

  expect(outcome).toMatchObject({ status: 'changed', reason: 'settings' })
  expect(s.keyboard.writeCount).toBe(5)
})

test('1回目の読み直しだけが違って読めた時（読み違い）は、もう一度読んで同じなら、書き込みを進める', async () => {
  const s = await setup({ alterReadAt: { read: 1, alter: (snapshot) => (snapshot.keymap[3][3] = 0x0010) } })
  const outcome = await start(s)

  expect(outcome).toMatchObject({ status: 'done', written: 5 })
  expect(s.keyboard.readCount).toBe(3)
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expect(backedUp(s)).toEqual([BEFORE])
})

test('別の機器がつながっていたら、何も書かずに止める（上書きはできない）', async () => {
  const s = await setup()
  s.keyboard.snapshot.uid = 'other'
  const outcome = await start(s)

  expect(outcome).toMatchObject({ status: 'changed', reason: 'other-device' })
  expect(s.keyboard.writeCount).toBe(0)
  expect(s.store.items.size).toBe(0)
})

test('本体の構成（枠の数など）が目標と違っていたら、何も書かずに止める（上書きはできない）', async () => {
  const s = await setup()
  s.keyboard.snapshot.capabilities.comboCount--
  s.keyboard.snapshot.combos.pop()
  const fresh = structuredClone(s.keyboard.snapshot)

  // 「このまま上書きする」のつもりで、読み直した内容を期待する内容として渡しても、止まる
  expect(await start(s, fresh)).toMatchObject({ status: 'changed', reason: 'shape' })
  expect(s.keyboard.writeCount).toBe(0)
  expect(s.store.items.size).toBe(0)
})

test('書く前の読み直しに失敗したら、何も書かずに止め、どこで・なぜ失敗したかを返す', async () => {
  const s = await setup({ failReadAt: { read: 1, step: 'キーマップ', kind: 'unexpected-response' } })
  const outcome = await start(s)

  expect(outcome).toEqual({ status: 'not-started', reason: { kind: 'read', fault: { kind: 'unexpected-response', step: 'キーマップ' } } })
  expect(s.keyboard.writeCount).toBe(0)
  expect(s.store.items.size).toBe(0)
})

// ---- バックアップの保存の失敗 ----

test.each<[string, (store: FakeStore) => void, StorageFailure]>([
  ['容量の上限', (store) => void (store.quota = 100), 'quota'],
  ['保存先が使えない', (store) => void (store.blocked = true), 'unavailable'],
  ['保存したはずの内容が残っていない', (store) => void (store.dropWrites = true), 'not-saved'],
])('バックアップの保存の失敗（%s）: 原因を返し、書き込みを始めない', async (_name, breakStore, reason) => {
  const s = await setup()
  breakStore(s.store)
  const outcome = await start(s)

  expect(outcome).toEqual({ status: 'not-started', reason: { kind: 'backup', reason } })
  expect(s.keyboard.writeCount).toBe(0)
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(s.store.items.size).toBe(0)
})

test('「書き込み中」の印の保存の失敗: 書き込みを始めない。バックアップは残り、印は残らない', async () => {
  const s = await setup({}, (store) => ({
    ...store,
    setItem: (key, value) => {
      if (key === pendingWriteKey(BASE_URL, UID)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      store.setItem(key, value)
    },
  }))
  const outcome = await start(s)

  expect(outcome).toEqual({ status: 'not-started', reason: { kind: 'backup', reason: 'quota' } })
  expect(s.keyboard.writeCount).toBe(0)
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('バックアップが保存できるようになれば、同じ書き込みを始められる', async () => {
  const s = await setup()
  s.store.blocked = true
  expect(await start(s)).toMatchObject({ status: 'not-started' })
  s.store.blocked = false

  expect(await start(s)).toMatchObject({ status: 'done', written: 5 })
  expect(backedUp(s)).toEqual([BEFORE])
})

// ---- 書き込み中の切断 ----

test('書き込み中の切断: 何番目の操作で切れたかを返す。本体は書きかけで、バックアップと印が残る', async () => {
  const s = await setup({ disconnectAtWrite: 4 })
  let notified = 0
  s.device.onDisconnect(() => notified++)
  const outcome = await start(s)

  expect(outcome).toEqual({
    status: 'failed',
    job: { before: BEFORE, target: TARGET },
    failure: { kind: 'write', fault: { kind: 'disconnected' }, index: 3, total: 5, operation: OPERATIONS[3] },
  })
  expect(notified).toBe(1)
  expect(writeOperations(s.keyboard.snapshot, TARGET)).toEqual(OPERATIONS.slice(3))
  expect(backedUp(s)).toEqual([BEFORE])
  expectMarked(s)
})

test('切れたままの再試行と復元は、読み直しで失敗し、何も変えない。つなぎ直せば、再試行で終えられる', async () => {
  const s = await setup({ disconnectAtWrite: 4 })
  const first = await start(s)
  expectFailed(first)
  const partial = structuredClone(s.keyboard.snapshot)

  for (const run of [retryWrite, restoreWrite]) {
    const outcome = await run(s.deps, first.job)
    expect(outcome).toMatchObject({ status: 'failed', job: first.job, failure: { kind: 'read', fault: { kind: 'disconnected' } } })
  }
  expect(s.keyboard.snapshot).toEqual(partial)
  expectMarked(s)

  // つなぎ直すと、機器は別のもの（KeyboardDevice）になる。失敗後の状態は、つなぎ直しをまたいで使える
  const device = await s.keyboard.connect()
  expect(await retryWrite({ ...s.deps, device }, first.job)).toEqual({ status: 'done', verified: TARGET, written: 2, markCleared: true })
  expect(s.keyboard.snapshot).toEqual(TARGET)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(mark(s)).toEqual({ status: 'none' })
})

test('切断の後、つなぎ直して復元すると、本体は書き込み前の内容に戻る', async () => {
  const s = await setup({ disconnectAtWrite: 4 })
  const first = await start(s)
  expectFailed(first)
  const device = await s.keyboard.connect()

  expect(await restoreWrite({ ...s.deps, device }, first.job)).toMatchObject({ status: 'done', verified: BEFORE, written: 3 })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(mark(s)).toEqual({ status: 'none' })
})

test('つなぎ直したのが別の機器なら、再試行も復元も、何も書かずに失敗する', async () => {
  const s = await setup({ disconnectAtWrite: 4 })
  const first = await start(s)
  expectFailed(first)
  const other = new FakeKeyboard({ ...BEFORE, uid: 'other' })
  const device = await other.connect()

  for (const run of [retryWrite, restoreWrite]) {
    expect(await run({ ...s.deps, device }, first.job)).toMatchObject({
      status: 'failed',
      failure: { kind: 'incompatible', reason: 'other-device' },
    })
  }
  expect(other.writeCount).toBe(0)
  expectMarked(s)
})

// ---- 「書き込み中」の印が残った状態からの再開 ----

/** 書き込みの途中でページを閉じた後。本体は書きかけで、保存先に印が残っている。画面の状態（失敗後の状態）は、もうない */
async function interrupted() {
  const s = await setup({ disconnectAtWrite: 4 })
  await start(s)
  const partial = structuredClone(s.keyboard.snapshot)
  // ページを開き直す。保存先は同じで、機器はつなぎ直す
  const backups = createBackupStorage({ store: s.store, baseUrl: BASE_URL, now: () => new Date('2026-10-13T00:00:00.000Z') })
  const device = await s.keyboard.connect()
  const reopened: Setup = { ...s, backups, device, deps: { device, backups } }
  return { s: reopened, partial }
}

test('印が残った状態: 次に同じ機器を接続した時に、書き込みを始めた日時と、戻す相手が分かる', async () => {
  const { s } = await interrupted()

  expect(interruptedWrite(s.backups, UID)).toEqual({
    status: 'pending',
    startedAt: NOW.toISOString(),
    job: { before: BEFORE, target: TARGET },
  })
  // 別の機器と、別の版（開発版）には、印がない
  expect(interruptedWrite(s.backups, 'other')).toEqual({ status: 'none' })
  const dev = createBackupStorage({ store: s.store, baseUrl: '/cornix-keymapper/dev/' })
  expect(interruptedWrite(dev, UID)).toEqual({ status: 'none' })
})

test('印が残った状態からの再開 → 戻す: 本体は書き込み前の内容に戻り、バックアップは残り、印は消える', async () => {
  const { s } = await interrupted()
  const found = interruptedWrite(s.backups, UID)
  if (found.status !== 'pending') throw new Error('pending になるはず')
  const outcome = await restoreWrite(s.deps, found.job)

  expect(outcome).toEqual({ status: 'done', verified: BEFORE, written: 3, markCleared: true })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(interruptedWrite(s.backups, UID)).toEqual({ status: 'none' })
})

test('印が残った状態からの再開 → 続ける: 本体は書きかけのまま変えず、バックアップは残り、印は消える', async () => {
  const { s, partial } = await interrupted()
  const writes = s.keyboard.writeCount

  expect(continueWithCurrent(s.backups, UID)).toEqual({ ok: true })
  expect(s.keyboard.snapshot).toEqual(partial)
  expect(s.keyboard.writeCount).toBe(writes)
  expect(backedUp(s)).toEqual([BEFORE])
  expect(interruptedWrite(s.backups, UID)).toEqual({ status: 'none' })
})

test('印が残った状態からの再開 → 戻すのに失敗: 印は残り、もう一度戻せる', async () => {
  const { s } = await interrupted()
  const found = interruptedWrite(s.backups, UID)
  if (found.status !== 'pending') throw new Error('pending になるはず')
  s.keyboard.failures.failWriteAt = { operation: s.keyboard.writeCount + 2 }
  const outcome = await restoreWrite(s.deps, found.job)

  expect(outcome).toMatchObject({ status: 'failed', failure: { kind: 'write', index: 1, total: 3 } })
  expect(interruptedWrite(s.backups, UID).status).toBe('pending')
  expect(await restoreWrite(s.deps, found.job)).toMatchObject({ status: 'done', verified: BEFORE })
  expect(interruptedWrite(s.backups, UID)).toEqual({ status: 'none' })
})

test('一覧からバックアップを消した後でも、印が残っていれば戻せる', async () => {
  const { s } = await interrupted()
  const [backup] = s.backups.list(UID)
  s.backups.remove(UID, backup.id)
  const found = interruptedWrite(s.backups, UID)
  if (found.status !== 'pending') throw new Error('pending になるはず')

  expect(await restoreWrite(s.deps, found.job)).toMatchObject({ status: 'done', verified: BEFORE })
  expect(s.keyboard.snapshot).toEqual(BEFORE)
})

test('読み込めない印: 戻せないことが分かる。続けるを選ぶと、印は消える', async () => {
  const s = await setup()
  s.store.items.set(pendingWriteKey(BASE_URL, UID), '{"version":1,"startedAt":"2026-10-12T01:32:00.000Z","before":{}')

  expect(interruptedWrite(s.backups, UID)).toEqual({ status: 'unreadable', startedAt: null, reason: 'broken' })
  expect(continueWithCurrent(s.backups, UID)).toEqual({ ok: true })
  expect(interruptedWrite(s.backups, UID)).toEqual({ status: 'none' })
  expect(s.keyboard.writeCount).toBe(0)
})
