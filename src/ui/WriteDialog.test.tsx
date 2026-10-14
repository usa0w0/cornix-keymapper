import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import type { Action } from '../model/action.ts'
import { writeOperations } from '../model/diff.ts'
import { addCombo, buildTarget, editEncoder, editKey, loadSnapshot } from '../session/editState.ts'
import type { InterruptedWrite, WriteFailure, WriteJob } from '../session/writeSession.ts'
import { createBackupStorage } from '../storage/backup.ts'
import { createFakeStore } from '../storage/fakeStore.ts'
import { BackupDialog } from './BackupDialog.tsx'
import { InterruptedDialog } from './InterruptedDialog.tsx'
import { Body } from './WriteDialog.tsx'
import {
  describeFailure,
  describeNotStarted,
  describeStage,
  flowAfter,
  flowAfterStart,
  formatDateTime,
  isClosable,
  operationPlace,
  type WriteFlow,
} from './writeFlow.ts'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const B: Action = { kind: 'key', code: 0x05, mods: [] }

const BEFORE = cornixSnapshot()
const TARGET = (() => {
  let state = loadSnapshot(BEFORE)
  state = editKey(state, 0, 8, { tap: B })
  state = editKey(state, 0, 9, { tap: A, doubleTap: B })
  state = editEncoder(state, 0, 0, 'left', A)
  state = addCombo(state, { keys: [0x04, 0x05], output: B })
  return buildTarget(state)
})()
const JOB: WriteJob = { before: BEFORE, target: TARGET }
// 新しく使う Tap Dance の枠、キー、キー、エンコーダー、コンボ
const OPERATIONS = writeOperations(BEFORE, TARGET)

const count = (html: string, needle: string) => html.split(needle).length - 1

const body = (flow: Exclude<WriteFlow, { phase: 'idle' }>, options: { connected?: boolean; changes?: number } = {}) =>
  renderToStaticMarkup(
    <Body
      flow={flow}
      connected={options.connected ?? true}
      changes={options.changes ?? 4}
      onRetry={() => {}}
      onRestore={() => {}}
      onOverwrite={() => {}}
      onReload={() => {}}
      onConnect={() => {}}
      onSaveLog={() => {}}
      onClose={() => {}}
    />,
  )

const failed = (failure: WriteFailure, action: 'write' | 'retry' | 'restore' = 'write'): WriteFlow & { phase: 'failed' } => ({
  phase: 'failed',
  action,
  job: JOB,
  failure,
})

// ---- 場面の決め方 ----

test('結果から、次の場面を決める', () => {
  const done = { status: 'done', verified: TARGET, written: 5, markCleared: true } as const
  const failure: WriteFailure = { kind: 'mismatch', written: 5, remaining: [OPERATIONS[1]] }
  expect(flowAfter('write', done)).toEqual({ phase: 'done', written: 5, markCleared: true })
  expect(flowAfter('retry', done)).toEqual({ phase: 'done', written: 5, markCleared: true })
  expect(flowAfter('restore', done)).toEqual({ phase: 'restored', written: 5, markCleared: true })
  expect(flowAfter('restore', { status: 'failed', job: JOB, failure })).toEqual({ phase: 'failed', action: 'restore', job: JOB, failure })
  expect(flowAfterStart({ status: 'changed', reason: 'settings', fresh: BEFORE }, TARGET)).toEqual({
    phase: 'changed',
    reason: 'settings',
    fresh: BEFORE,
    target: TARGET,
  })
  expect(flowAfterStart({ status: 'not-started', reason: { kind: 'backup', reason: 'quota' } }, TARGET)).toEqual({
    phase: 'not-started',
    reason: { kind: 'backup', reason: 'quota' },
  })
  expect(flowAfterStart(done, TARGET)).toEqual({ phase: 'done', written: 5, markCleared: true })
})

test('書き込みの途中と、失敗の後は、閉じられない', () => {
  expect(isClosable({ phase: 'working', action: 'write', stage: null })).toBe(false)
  expect(isClosable(failed({ kind: 'read', fault: { kind: 'timeout' } }))).toBe(false)
  expect(isClosable({ phase: 'done', written: 1, markCleared: true })).toBe(true)
  expect(isClosable({ phase: 'restored', written: 1, markCleared: true })).toBe(true)
  expect(isClosable({ phase: 'not-started', reason: { kind: 'backup', reason: 'quota' } })).toBe(true)
  expect(isClosable({ phase: 'changed', reason: 'settings', fresh: BEFORE, target: TARGET })).toBe(true)
})

// ---- 書き込み中 ----

test('書き込み中: 進み具合の棒と「n 件中 m 件」、電源や接続を切らない注意を出す。閉じるボタンはない', () => {
  const html = body({ phase: 'working', action: 'write', stage: { stage: 'writing', done: 2, total: 5 } })
  expect(html).toContain('<h2 id="write-title">書き込み中…</h2>')
  expect(html).toContain('<progress value="2" max="5"></progress>')
  expect(html).toContain('<p aria-live="polite">5 件中 2 件を書きました。</p>')
  expect(html).toContain('終わるまで、キーボードの電源を切ったり、接続を外したりしないでください。このページも閉じないでください。')
  expect(html).not.toContain('<button')
})

test('書き込み中: 読み直し、バックアップ、照合の間は、動き続ける棒と、いましていることを出す', () => {
  expect(describeStage('write', null)).toEqual({ text: '書く前に、本体の設定を読み直しています…', bar: null })
  expect(describeStage('write', { stage: 'reading', progress: { step: 'キーマップ', done: 0, total: 1 } }).text).toBe(
    '書く前に、本体の設定を読み直しています…（キーマップ）',
  )
  expect(describeStage('write', { stage: 'backup' }).text).toBe('いまの本体の設定を、バックアップしています…')
  expect(describeStage('write', { stage: 'verifying', progress: null }).text).toBe('書いた内容を、本体から読み直して確かめています…')
  expect(describeStage('restore', { stage: 'writing', done: 1, total: 3 })).toEqual({ text: '3 件中 1 件を戻しました。', bar: { done: 1, total: 3 } })

  const html = body({ phase: 'working', action: 'restore', stage: { stage: 'verifying', progress: null } })
  expect(html).toContain('<h2 id="write-title">書き込み前の状態に戻しています…</h2>')
  expect(html).toContain('<progress></progress>')
})

// ---- 結果 ----

test('結果: 「書き込みました」と、読み直して内容が合っていたことを出す', () => {
  const html = body({ phase: 'done', written: 5, markCleared: true })
  expect(html).toContain('<h2 id="write-title" class="ok">書き込みました</h2>')
  expect(html).toContain('<p>5 件を書き込み、本体から読み直して、内容が合っていることを確かめました。</p>')
  expect(html).toContain('書き込む前の設定は、ヘッダーの「バックアップ」から戻せます。')
  expect(html).toContain('<div class="dialog-actions"><button type="button" class="primary">閉じる</button></div>')
  expect(html).not.toContain('印')
})

test('結果: 本体がすでに同じ内容だった時と、印を消せなかった時は、その旨を出す', () => {
  expect(body({ phase: 'done', written: 0, markCleared: true })).toContain('本体は、すでに書き込む内容と同じでした（本体から読み直して確かめました）。')
  const kept = body({ phase: 'done', written: 5, markCleared: false })
  expect(kept).toContain('次に接続した時に「前回の書き込みが終わっていません」と出たら、「いまの本体の状態のまま続ける」を選んでください。')
})

test('書き込み前の状態に戻した後: 戻して確かめたことと、編集が残っていることを出す', () => {
  const html = body({ phase: 'restored', written: 2, markCleared: true })
  expect(html).toContain('<h2 id="write-title" class="ok">書き込み前の状態に戻しました</h2>')
  expect(html).toContain('本体は、書き込む前の設定に戻っています（本体から読み直して確かめました）。画面の編集内容は残っているので、もう一度書き込めます。')
  // 前回の書き込みを戻した時（編集がない時）は、編集のことを言わない
  expect(body({ phase: 'restored', written: 2, markCleared: true }, { changes: 0 })).not.toContain('画面の編集内容')
})

// ---- 失敗と不一致 ----

test('機器に送る操作の場所を、利用者の言葉にする。Tap Dance の枠は、番号ではなく、その枠を使うキーで示す', () => {
  expect(OPERATIONS.map((operation) => operationPlace(operation, JOB))).toEqual([
    'レイヤー 0 ・ 行 1 列 2 などの、長押しや2回タップの内容',
    'レイヤー 0 ・ 行 1 列 1',
    'レイヤー 0 ・ 行 1 列 2',
    'レイヤー 0 ・ エンコーダー 1 の左回し',
    'コンボ',
  ])
  // 戻す時に空にする枠は、書き込み前の内容にはなく、目標にあるキーで示す。どのキーからも使われていない枠は、その旨
  const unused = operationPlace({ type: 'setTapDance', index: 31, entry: BEFORE.tapDances[31] }, JOB)
  expect(unused).toBe('キーから使われていない、長押しや2回タップの内容')
})

test('途中の失敗: 何件目・どの場所で、なぜ失敗したかと、「再試行」「書き込み前の状態に戻す」を出す', () => {
  const failure: WriteFailure = { kind: 'write', fault: { kind: 'timeout' }, index: 2, total: 5, operation: OPERATIONS[2] }
  const html = body(failed(failure))
  expect(html).toContain('<h2 id="write-title" class="ng" role="alert">書き込みの途中で失敗しました</h2>')
  expect(html).toContain('<p>5 件中 2 件を書いた所で、キーボードから応答がなくなりました。失敗したのは「レイヤー 0 ・ 行 1 列 2」です。</p>')
  expect(html).toContain('<p>本体は、書きかけの状態です。電源と接続を確かめてください。そのうえで、どちらかを選んでください。</p>')
  expect(html).toContain('書き込む前の設定は、自動バックアップに残っています。')
  expect(html).toContain('<button type="button">書き込み前の状態に戻す</button><button type="button" class="primary">再試行</button>')
  expect(html).toContain('>通信の記録を保存</button>')
  // 閉じるボタンはない（どちらかを選ぶ）
  expect(html).not.toContain('閉じる')
})

test('書き込み中に切断した時: 原因と、つなぎ直すことを出す。つなぎ直すまで、再試行と、戻すは押せない', () => {
  const failure: WriteFailure = { kind: 'write', fault: { kind: 'disconnected' }, index: 3, total: 5, operation: OPERATIONS[3] }
  const html = body(failed(failure), { connected: false })
  expect(html).toContain('5 件中 3 件を書いた所で、キーボードとの接続が切れました。失敗したのは「レイヤー 0 ・ エンコーダー 1 の左回し」です。')
  expect(html).toContain('本体は、書きかけの状態です。キーボードをつなぎ直してください。')
  expect(html).toContain('<p class="write-warning" role="status">いまは、キーボードとつながっていません。つなぎ直してから「接続」を押すと、選べるようになります。</p>')
  expect(html).toContain('<button type="button" class="primary">接続</button>')
  expect(html).toContain('<button type="button" disabled="">書き込み前の状態に戻す</button><button type="button" class="primary" disabled="">再試行</button>')
  // つないだ後は、押せる
  const connected = body(failed(failure))
  expect(connected).toContain('<button type="button" class="quiet">接続し直す</button>')
  expect(connected).not.toContain('disabled')
})

test('照合の不一致: 違っていた場所を並べる。多い時は、残りを数で出す', () => {
  const html = body(failed({ kind: 'mismatch', written: 5, remaining: [OPERATIONS[1], OPERATIONS[3]] }))
  expect(html).toContain('書き込んだ内容が、本体と合いません')
  expect(html).toContain('<p>5 件を書きましたが、本体から読み直すと、次の場所の内容が、書いたものと違っていました。</p>')
  expect(html).toContain('<ul class="write-places"><li>レイヤー 0 ・ 行 1 列 1</li><li>レイヤー 0 ・ エンコーダー 1 の左回し</li></ul>')
  expect(html).toContain('<p>もう一度書き込むか、書き込み前の状態に戻してください。</p>')

  const many = Array.from({ length: 8 }, (_, key) => ({ type: 'setKey', layer: 1, key, keycode: 4 }) as const)
  const text = describeFailure('write', JOB, { kind: 'mismatch', written: 8, remaining: many })
  expect(text.places).toHaveLength(5)
  expect(text.morePlaces).toBe(3)
  expect(body(failed({ kind: 'mismatch', written: 8, remaining: many }))).toContain('<li>ほか 3 か所</li>')
})

test('失敗の種類ごとに、本体がどういう状態かを言い分ける', () => {
  const verify = describeFailure('write', JOB, { kind: 'verify', fault: { kind: 'timeout', step: 'Tap Dance' }, written: 5 })
  expect(verify.title).toBe('書き込んだ内容を、確かめられませんでした')
  expect(verify.cause).toBe('5 件を書き終えましたが、確かめるための読み直しで、「Tap Dance」を読んでいる途中で、キーボードから応答がなくなりました。')
  expect(verify.advice).toContain('本体に正しく書けたかは、まだ分かりません。')

  const read = describeFailure('retry', JOB, { kind: 'read', fault: { kind: 'unexpected-response', step: 'キーマップ' } })
  expect(read.cause).toBe('書く前に本体の設定を読み直そうとしましたが、「キーマップ」を読んでいる途中で、キーボードから想定と違う応答が返りました。')
  expect(read.advice).toContain('今回は、本体に何も書いていません。')
  expect(read.advice).toContain('Vial など、ほかのアプリやタブで開いている場合は、閉じてください。')

  const other = describeFailure('retry', JOB, { kind: 'incompatible', reason: 'other-device' })
  expect(other.title).toBe('書き込みの途中だったキーボードとは、別のキーボードです')
  expect(other.cause).toContain('このキーボードには、何も書いていません。')

  // 戻す途中の失敗は、見出しで分かるようにする
  const restoring = describeFailure('restore', JOB, { kind: 'write', fault: { kind: 'send-failed' }, index: 0, total: 2, operation: null })
  expect(restoring.title).toBe('書き込み前の状態に戻す途中で、失敗しました')
  expect(restoring.cause).toBe('2 件中 0 件を書いた所で、キーボードへ送信できませんでした。')
  expect(describeFailure('restore', JOB, { kind: 'mismatch', written: 2, remaining: [] }).title).toBe('戻した内容が、本体と合いません')
})

// ---- 書き込みを始めなかった時 ----

test('バックアップの保存の失敗: 原因と、書き込みを始めていないことを出す', () => {
  const html = body({ phase: 'not-started', reason: { kind: 'backup', reason: 'quota' } })
  expect(html).toContain('<h2 id="write-title" class="ng">書き込む前のバックアップを、保存できませんでした</h2>')
  expect(html).toContain('<p>ブラウザーの中の、このサイトが使える保存の容量が足りません。</p>')
  expect(html).toContain('バックアップがないと戻せなくなるので、書き込みは始めていません。本体には、何も書いていません。')
  expect(html).toContain('>閉じる</button>')
  expect(describeNotStarted({ kind: 'backup', reason: 'unavailable' }).body[0]).toContain('このブラウザーでは、サイトのデータの保存が使えません。')
  expect(describeNotStarted({ kind: 'backup', reason: 'not-saved' }).body[0]).toBe('保存したはずの内容を、読み戻して確かめられませんでした。')
})

test('書く前の読み直しの失敗: どこで・なぜ失敗したかと、何も書いていないことを出す', () => {
  const html = body({ phase: 'not-started', reason: { kind: 'read', fault: { kind: 'timeout', step: 'キーマップ' } } })
  expect(html).toContain('書き込みを始められませんでした')
  expect(html).toContain('書く前に本体の設定を読み直そうとしましたが、「キーマップ」を読んでいる途中で、キーボードから応答がなくなりました。')
  expect(html).toContain('本体には、何も書いていません。電源と接続を確かめてください。そのうえで、もう一度「書き込み」を押してください。')
})

// ---- 書き込み前に、本体の設定が変わっていた ----

test('書き込み前に本体の設定が変わっていた: 「やめる」「本体から読み込み直す」「このまま上書きする」を出す', () => {
  const html = body({ phase: 'changed', reason: 'settings', fresh: BEFORE, target: TARGET }, { changes: 3 })
  expect(html).toContain('<h2 id="write-title" class="ng">本体の設定が、読み込んだ後に変わっています</h2>')
  expect(html).toContain('本体には、まだ何も書いていません。')
  expect(html).toContain('上書きする前の本体の設定は、自動でバックアップします')
  expect(html).toContain('読み込み直すと、この画面で編集した内容（3 件）は消えます。')
  expect(html).toContain(
    '<button type="button">やめる</button><button type="button">本体から読み込み直す</button><button type="button" class="primary">このまま上書きする</button>',
  )
})

test('別のキーボードだった時と、構成が変わっていた時は、上書きを選べない', () => {
  const other = body({ phase: 'changed', reason: 'other-device', fresh: BEFORE, target: TARGET })
  expect(other).toContain('読み込んだ時とは、別のキーボードです')
  expect(other).not.toContain('上書きする')
  expect(other).toContain('<button type="button">やめる</button><button type="button" class="primary">本体から読み込み直す</button>')
  const shape = body({ phase: 'changed', reason: 'shape', fresh: BEFORE, target: TARGET })
  expect(shape).toContain('キーボードの構成が、読み込んだ後に変わっています')
  expect(shape).not.toContain('上書きする')
})

// ---- 前回の書き込みが終わっていない ----

const STARTED = new Date(2026, 9, 12, 10, 32).toISOString()

test('日時は、利用者の時刻で出す', () => {
  expect(formatDateTime(STARTED)).toBe('2026-10-12 10:32')
  expect(formatDateTime(new Date(2026, 0, 2, 3, 4).toISOString())).toBe('2026-01-02 03:04')
})

test('前回の書き込みが終わっていない: 始めた日時と、「書き込み前の状態に戻す」「いまの本体の状態のまま続ける」を出す', () => {
  const interrupted: InterruptedWrite = { status: 'pending', startedAt: STARTED, job: JOB }
  const html = renderToStaticMarkup(<InterruptedDialog interrupted={interrupted} onRestore={() => {}} onContinue={() => {}} />)
  expect(html).toContain('<h2 id="interrupted-title" class="ng">前回の書き込みが終わっていません</h2>')
  expect(html).toContain('2026-10-12 10:32 に始めた書き込みが、途中で止まっています（ページを閉じた、接続が切れた、など）。本体は、書きかけの状態かもしれません。')
  expect(html).toContain(
    '<button type="button">いまの本体の状態のまま続ける</button><button type="button" class="primary">書き込み前の状態に戻す</button>',
  )
})

test('前回の書き込みの記録が読み込めない時は、戻せないことと、バックアップから戻せることを出す', () => {
  const html = renderToStaticMarkup(
    <InterruptedDialog interrupted={{ status: 'unreadable', startedAt: null, reason: 'broken' }} onRestore={() => {}} onContinue={() => {}} />,
  )
  expect(html).toContain('前に始めた書き込みが、途中で止まっています')
  expect(html).toContain('その記録を読み込めないので（データが壊れています）、ここからは、書き込み前の状態に戻せません。')
  expect(html).toContain('ヘッダーの「バックアップ」に残っていれば、そこから戻せます。')
  expect(html).toContain('<button type="button" class="primary">いまの本体の状態のまま続ける</button>')
  expect(html).not.toContain('書き込み前の状態に戻す</button>')
})

// ---- バックアップの一覧 ----

function backupsWith(setup: (store: ReturnType<typeof createFakeStore>, save: (snapshot: typeof BEFORE, at: Date) => void) => void) {
  const store = createFakeStore()
  let now = new Date()
  const backups = createBackupStorage({ store, baseUrl: '/cornix-keymapper/', now: () => now })
  setup(store, (snapshot, at) => {
    now = at
    backups.save(snapshot)
  })
  return backups
}

const list = (backups: ReturnType<typeof backupsWith>, options: { source?: typeof BEFORE; changes?: number; devSite?: boolean } = {}) =>
  renderToStaticMarkup(
    <BackupDialog
      backups={backups}
      baseline={TARGET}
      source={options.source ?? TARGET}
      changes={options.changes ?? 0}
      onRestore={() => {}}
      onClose={() => {}}
      devSite={options.devSite ?? false}
    />,
  )

test('バックアップの一覧: 保存した時と、「.vil に書き出す」「この状態に戻す」を、新しい順に出す', () => {
  const backups = backupsWith((_store, save) => {
    save(BEFORE, new Date(2026, 9, 11, 23, 48))
    save(TARGET, new Date(2026, 9, 12, 10, 32))
  })
  const html = list(backups)
  expect(html).toContain('<h2 id="backups-title">自動バックアップ</h2>')
  expect(html).toContain('書き込むたびに、その直前の本体の設定を、このブラウザーの中に保存しています（直近 5 回ぶん）。')
  expect(html.indexOf('2026-10-12 10:32')).toBeLessThan(html.indexOf('2026-10-11 23:48'))
  // いまの本体と同じ内容のものも、書き出せる
  expect(count(html, '.vil に書き出す</button>')).toBe(2)
  expect(html).toContain('<button type="button" aria-label="2026-10-12 10:32 のバックアップを .vil に書き出す">.vil に書き出す</button>')
  expect(html).toContain('<button type="button" aria-label="2026-10-11 23:48 のバックアップを .vil に書き出す">.vil に書き出す</button>')
  expect(html).toContain('<button type="button" aria-label="2026-10-11 23:48 の状態に戻す">この状態に戻す</button>')
  // いまの本体と同じ内容のものは、戻すものがない
  expect(html).toContain('書き込みの直前の設定<span class="backups-note">（いまの本体と同じ内容です）</span>')
  expect(html).toContain('<button type="button" disabled="" aria-label="2026-10-12 10:32 の状態に戻す">この状態に戻す</button>')
  expect(html).toContain('「この状態に戻す」は、すぐには書き込みません。変更点を確かめてから「本体に書き込む」を押します。')
  expect(html).toContain('バックアップは、開発版とリリース版で別々に保存されます（いま見ているのはリリース版）。')
  expect(html).toContain('ブラウザーで、このサイトのデータを消すと、バックアップも消えます。残しておきたいものは、.vil に書き出してください。')
})

test('バックアップの一覧: 開発版では、そう出す。編集がある時は、戻した設定の上に残ることを出す', () => {
  const backups = backupsWith((_store, save) => save(BEFORE, new Date(2026, 9, 11, 23, 48)))
  const html = list(backups, { devSite: true, changes: 2 })
  expect(html).toContain('（いま見ているのは開発版）')
  expect(html).toContain('いま編集している内容（2 件）は、戻した設定の上に残ります。')
  // すでに画面に読み込んであるものは、もう一度は選べない
  expect(list(backups, { source: BEFORE })).toContain('（この画面に読み込んであります）')
})

test('バックアップの一覧: 読み込めないものは「読み込めません」と理由、「削除」を出す', () => {
  const backups = backupsWith((store, save) => {
    save(BEFORE, new Date(2026, 9, 11, 23, 48))
    const key = [...store.items.keys()][0]
    const entries = JSON.parse(store.items.get(key)!) as unknown[]
    const newer = { version: 99, savedAt: new Date(2026, 9, 12, 9, 0).toISOString(), snapshot: {} }
    store.items.set(key, JSON.stringify([newer, 'こわれたもの', ...entries]))
  })
  const html = list(backups)
  expect(html).toContain('<th scope="row">2026-10-12 09:00</th><td class="ng">読み込めません（このサイトの新しい版で保存されたものです）</td>')
  expect(html).toContain('<button type="button" aria-label="2026-10-12 09:00 の、読み込めないバックアップを削除">削除</button>')
  expect(html).toContain('<th scope="row">（日時不明）</th><td class="ng">読み込めません（データが壊れています）</td>')
  expect(count(html, '>削除</button>')).toBe(2)
  // 読み込めるものには、削除を出さない
  expect(count(html, '>この状態に戻す</button>')).toBe(1)
})

test('バックアップの一覧: 構成が違うキーボードのものは、戻せない。1件もない時は、その旨を出す', () => {
  const smaller = structuredClone(BEFORE)
  smaller.capabilities.comboCount--
  smaller.combos.pop()
  const backups = backupsWith((_store, save) => save(smaller, new Date(2026, 9, 11, 23, 48)))
  const html = list(backups)
  expect(html).toContain('（いまのキーボードとは、レイヤーや枠の数が違うので、戻せません）')
  expect(html).toContain('<button type="button" disabled="" aria-label="2026-10-11 23:48 の状態に戻す">この状態に戻す</button>')

  const empty = list(backupsWith(() => {}))
  expect(empty).toContain('このキーボードのバックアップは、まだありません。本体に書き込むと、その直前の設定がここに残ります。')
  expect(empty).not.toContain('<table')
})
