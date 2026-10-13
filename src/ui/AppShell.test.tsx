import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import App from '../App.tsx'
import { DeviceError, type KeyboardDevice } from '../device/types.ts'
import { cornixSnapshot, createFakeCornix } from '../device/fake/cornix.ts'
import { AppHeader } from './AppHeader.tsx'
import { DeviceInfoDialog } from './DeviceInfoDialog.tsx'
import { slotCounts } from './deviceInfo.ts'
import { ReadResult } from './Diagnostics.tsx'
import { buildReadReport, describeReadError } from './readReport.ts'
import { ReloadDialog } from './ReloadDialog.tsx'
import { SessionBanner } from './SessionBanner.tsx'
import { ConnectStage, ReadFailedStage, ReadingStage } from './Stage.tsx'
import { describeError, disconnectedNotice, formatDuration, type ConnectionState } from './useConnection.ts'
import { readReportFrom, readStateFor, replaceReport, runRead, type HeldRead, type ReadState } from './useDeviceRead.ts'

const device: KeyboardDevice = {
  name: 'Cornix',
  protocol: 'VIA プロトコル 9',
  onDisconnect: () => () => {},
  disconnect: async () => {},
  read: () => Promise.reject(new Error('使わない')),
  write: () => Promise.reject(new Error('使わない')),
  exchangeCount: () => 0,
  exchanges: () => [],
}

const report = buildReadReport({
  readAt: new Date('2026-10-11T00:00:00Z'),
  userAgent: 'test',
  device: { name: 'Cornix', protocol: 'VIA プロトコル 9' },
  snapshot: cornixSnapshot(),
  differencesFromPrevious: null,
  exchanges: [{ request: '01', response: '010009', ms: 12 }],
})

const header = (connection: ConnectionState, options: { supported?: boolean; read?: boolean; changes?: number } = {}) =>
  renderToStaticMarkup(
    <AppHeader
      connection={connection}
      supported={options.supported ?? true}
      slots={options.read ? slotCounts(report.snapshot) : null}
      changes={options.changes ?? 0}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onDeviceInfo={options.read && connection.status === 'connected' ? () => {} : null}
    />,
  )

const count = (html: string, needle: string) => html.split(needle).length - 1

test('接続前の画面: ヘッダーは「未接続」と「接続」、図の代わりに、つなぎ方の手順のカードを出す', () => {
  const html = renderToStaticMarkup(<App connector={createFakeCornix()} supported />)
  expect(html).toContain('<span class="chip chip-off" aria-live="polite">未接続</span><button type="button">接続</button>')
  // カードは、画面の主な中身（main）の中に出す
  expect(html).toContain('<main><section class="stage" aria-label="接続"><h2>Cornix をつないで、設定を読み込みます</h2>')
  expect(html).toContain('<button type="button" class="primary big">接続</button>')
  // 警告の帯、残り枠数、保存と書き込みのボタン、タブ、図は出さない
  expect(html).not.toContain('banner')
  expect(html).not.toContain('残り')
  expect(html).not.toContain('書き込み')
  expect(html).not.toContain('app-tabs')
  expect(html).not.toContain('class="figure"')
})

test('非対応ブラウザーでは、いちばん上に警告を出し、「接続」をどちらも押せなくする', () => {
  const html = renderToStaticMarkup(<App connector={createFakeCornix()} supported={false} />)
  // 帯は、ヘッダーより前に出す
  expect(html).toMatch(/^<div class="app"><p class="banner banner-danger" role="alert">このブラウザーでは、キーボードに接続できません。/)
  expect(count(html, '接続</button>')).toBe(2)
  expect(count(html, 'disabled="">接続</button>')).toBe(2)
  expect(html).toContain('このブラウザーでは接続できません。Chrome か Edge で開いてください。')
})

test('接続中は、「接続」を押せなくする', () => {
  expect(header({ status: 'connecting' })).toContain('接続中…</span><button type="button" disabled="">接続</button>')
  const html = renderToStaticMarkup(<ConnectStage supported connecting onConnect={() => {}} />)
  expect(html).toContain('disabled="">接続中…</button>')
})

test('接続できなかった時と、接続が切れた時の知らせを、接続前のカードに出す', () => {
  const html = renderToStaticMarkup(
    <ConnectStage supported connecting={false} notice={describeError(new DeviceError('timeout'))} onConnect={() => {}} />,
  )
  expect(html).toContain('<p class="stage-alert" role="alert">キーボードから応答がありません')
})

test('想定と違う応答には、他のアプリやタブを閉じるよう案内する', () => {
  expect(describeError(new DeviceError('unexpected-response'))).toContain('他のアプリやタブ')
})

test('接続していた時間を、秒か「分 秒」で表す', () => {
  expect(formatDuration(42_400)).toBe('42 秒')
  expect(formatDuration(185_000)).toBe('3 分 5 秒')
})

test('読み出す前のヘッダー: 機器名と「切断」だけを出し、本体の情報は開けない', () => {
  const html = header({ status: 'connected', device })
  expect(html).toContain('<span class="chip chip-off">接続済み: Cornix</span>')
  expect(html).toContain('切断</button>')
  expect(html).not.toContain('▾')
  expect(html).not.toContain('残り')
  expect(html).not.toContain('書き込み')
})

test('読み出した後のヘッダー: 本体の情報を開くボタン、残り枠数、押せない保存と書き込みのボタンを出す', () => {
  const html = header({ status: 'connected', device }, { read: true })
  expect(html).toContain('title="接続中のキーボードの情報を見る">接続済み: Cornix ▾</button>')
  expect(html).toContain('Tap Dance 残り <b>30</b> / 32')
  expect(html).toContain('コンボ 残り <b>32</b> / 32')
  for (const name of ['バックアップ', '.vil に保存', '.vil を読み込む', '書き込み（変更 0 件）']) {
    expect(html).toMatch(new RegExp(`<button type="button"[^>]*disabled=""[^>]*>${name.replace(/[.()（）]/g, '\\$&')}</button>`))
  }
})

test('読み込み中のカード: いま読んでいるものと、進み具合の棒を出す', () => {
  const counted = renderToStaticMarkup(<ReadingStage progress={{ step: 'キーマップ', done: 3, total: 8 }} />)
  expect(counted).toContain('本体の設定を読み出しています…')
  expect(counted).toContain('<progress value="3" max="8"></progress>')
  expect(counted).toContain('「キーマップ」を読んでいます（3 / 8）。')
  // 数えられないものを読んでいる間と、読み始める前は、値のない棒にする
  const uncounted = renderToStaticMarkup(<ReadingStage progress={{ step: 'レイヤー数', done: 0, total: 1 }} />)
  expect(uncounted).toContain('<progress></progress>')
  expect(uncounted).toContain('「レイヤー数」を読んでいます。')
  expect(renderToStaticMarkup(<ReadingStage progress={null} />)).toContain('<progress></progress>')
})

test('読み出しの失敗のカード: どこで・なぜ失敗したかと「もう一度読み出す」を出し、読みかけの内容は出さない', () => {
  const failure = describeReadError(new DeviceError('timeout', { step: 'キーマップ' }))
  const html = renderToStaticMarkup(<ReadFailedStage failure={failure} onRetry={() => {}} />)
  expect(html).toContain('設定を読み出せませんでした')
  expect(html).toContain('<p>「キーマップ」を読んでいる途中で、キーボードから応答がなくなりました。</p>')
  expect(html).toContain('電源と接続を確かめてから、もう一度読み出してください。読みかけの内容は表示しません。')
  expect(html).toContain('もう一度読み出す</button>')
  expect(html).not.toContain('class="figure"')
})

test('読み出しの失敗は、種類ごとに原因と次の操作を伝える。どこを読んでいたか分からない時は、場所を出さない', () => {
  expect(describeReadError(new DeviceError('disconnected', { step: 'Tap Dance' }))).toEqual({
    cause: '「Tap Dance」を読んでいる途中で、キーボードとの接続が切れました。',
    advice: 'キーボードをつなぎ直してから、「切断」を押して接続し直してください。',
  })
  expect(describeReadError(new DeviceError('send-failed')).cause).toBe('キーボードへ送信できませんでした。')
  expect(describeReadError(new DeviceError('unexpected-response')).advice).toContain('ほかのアプリやタブ')
  expect(describeReadError(new Error('boom')).cause).toBe('原因が分かりません。（boom）')
})

test('本体の情報のダイアログ: 対応機能と枠数を出し、診断を畳んで置く', () => {
  const html = renderToStaticMarkup(<DeviceInfoDialog ref={null} device={device} report={report} onReport={() => {}} />)
  expect(html).toContain('<h2 id="device-info-title">接続中のキーボード</h2>')
  expect(html).toContain('<th scope="row">機器</th><td>Cornix（ファームウェア V1.12）</td>')
  expect(html).toContain('<td>使える（Tap Dance の枠 32 個、残り 30）</td>')
  expect(html).toContain('<td>使える（枠 32 個、残り 32）</td>')
  expect(html).toContain('<th scope="row">ロータリーエンコーダー</th><td>2 つ</td>')
  // 診断は、開くまで見えない（details は open を持たない）
  expect(html).toContain('<details class="diagnostics"><summary>診断（実機での確認用）</summary>')
  for (const name of ['もう一度読み出して比べる', '結果をファイルに保存', '結果をコピー']) expect(html).toContain(`${name}</button>`)
  expect(html).toContain('閉じる</button>')
})

test('診断: 読み出した値を、生の値のまま表示する', () => {
  const html = renderToStaticMarkup(<ReadResult report={report} />)
  expect(html).toContain('0123456789abcdef')
  expect(html).toContain('8 行 × 7 列')
  expect(html).toContain('<td>0x5222</td>')
  expect(html).toContain('<td>250</td>')
  expect(html).toContain('1 回、合計 0.0 秒、平均 12 ミリ秒、最長 12 ミリ秒、タイムアウト 0 回')
  expect(html).not.toContain('前回の読み出し')
})

test('診断: 前回の読み出しと比べた結果を表示する', () => {
  const render = (differencesFromPrevious: number) =>
    renderToStaticMarkup(<ReadResult report={{ ...report, differencesFromPrevious }} />)
  expect(render(0)).toContain('<p class="ok" role="status">前回の読み出しと一致しました。')
  expect(render(3)).toContain('<p class="ng" role="status">前回の読み出しと 3 か所が違います。')
})

test('読み出しの記録: 前回の内容を渡すと、違っていた数を添える。失敗した時は、機器の失敗をそのまま投げる', async () => {
  const keyboard = createFakeCornix({ failures: { failReadAt: { read: 3 } } })
  const fake = await keyboard.connect()
  const steps: string[] = []

  const first = await readReportFrom(fake, null, (progress) => steps.push(progress.step))
  expect(first.snapshot).toEqual(cornixSnapshot())
  expect(first.differencesFromPrevious).toBeNull()
  expect(first.device).toEqual({ name: 'Cornix', protocol: '偽の機器' })
  expect(steps).toContain('キーマップ')

  keyboard.snapshot.keymap[0][0] = 0x0005
  expect((await readReportFrom(fake, first.snapshot)).differencesFromPrevious).toBe(1)
  await expect(readReportFrom(fake, first.snapshot)).rejects.toMatchObject({ kind: 'timeout', step: 'キーマップ' })
})

/** 画面の状態の置き場の代わり。runRead が知らせた状態を、順に残す */
function heldStore() {
  let held: HeldRead | null = null
  const history: HeldRead[] = []
  return {
    get: () => held,
    history,
    set: (update: (current: HeldRead | null) => HeldRead | null) => {
      const next = update(held)
      if (next && next !== held) history.push(next)
      held = next
    },
  }
}

test('読み出しの流れ: 読み込み中 → いま読んでいるもの → 読み終えた内容、の順に知らせる', async () => {
  const fake = await createFakeCornix().connect()
  const store = heldStore()
  // 読み終えた記録を返す（編集中の状態に渡すため）
  const read = await runRead(fake, 1, store.set)
  expect(read?.snapshot).toEqual(cornixSnapshot())

  expect(store.history[0].state).toEqual({ status: 'reading', progress: null })
  expect(store.history[2].state).toEqual({ status: 'reading', progress: { step: 'キーマップ', done: 0, total: 1 } })
  expect(store.history.at(-1)!.state).toMatchObject({ status: 'done', report: { snapshot: cornixSnapshot() } })
  expect(readStateFor(store.get(), fake)).toBe(store.get()!.state)
})

test('読み出しの流れ: 失敗したら、読みかけの内容を持たず、原因だけを知らせる', async () => {
  const fake = await createFakeCornix({ failures: { failReadAt: { read: 1 } } }).connect()
  const store = heldStore()
  expect(await runRead(fake, 1, store.set)).toBeNull()
  expect(store.get()!.state).toEqual({
    status: 'failed',
    failure: describeReadError(new DeviceError('timeout', { step: 'キーマップ' })),
  })
})

test('読み出しの途中で機器が替わったら、前の機器の進み具合と結果で、いまの状態を上書きしない', async () => {
  const oldKeyboard = createFakeCornix({ name: '前の機器', stepDelayMs: 5 })
  const newKeyboard = createFakeCornix({ name: '次の機器', stepDelayMs: 20 })
  newKeyboard.snapshot.keymap[0][0] = 0x0005
  const [before, after] = [await oldKeyboard.connect(), await newKeyboard.connect()]
  const store = heldStore()

  const first = runRead(before, 1, store.set)
  // 前の機器を読んでいる途中で、次の機器の読み出しを始める。前の機器のほうが先に読み終わる
  await new Promise((resolve) => setTimeout(resolve, 8))
  expect(store.get()).toMatchObject({ device: before, state: { status: 'reading' } })
  const second = runRead(after, 2, store.set)
  await first

  // 前の機器が読み終わっても、状態は次の機器の読み込み中のまま
  expect(store.get()).toMatchObject({ device: after, run: 2, state: { status: 'reading' } })
  const startOfSecond = store.history.findIndex((held) => held.run === 2)
  expect(store.history.slice(startOfSecond).every((held) => held.device === after)).toBe(true)

  await second
  expect(store.get()).toMatchObject({ device: after, state: { status: 'done' } })
  expect((store.get()!.state as { report: { snapshot: { keymap: number[][] } } }).report.snapshot.keymap[0][0]).toBe(0x0005)
})

test('読み出しの途中で切断したら、後から届いた結果は画面に出さない。つなぎ直した機器は、読み込み中から始める', async () => {
  const keyboard = createFakeCornix({ stepDelayMs: 5 })
  const before = await keyboard.connect()
  const store = heldStore()
  const pending = runRead(before, 1, store.set)

  // 切断すると、接続中の機器がなくなる
  expect(readStateFor(store.get(), null)).toBeNull()
  await before.disconnect()
  await pending
  // 切断した機器の読み出しは失敗として残るが、どの機器にもつながっていない間は出さない
  expect(store.get()).toMatchObject({ device: before, state: { status: 'failed' } })
  expect(readStateFor(store.get(), null)).toBeNull()

  // つなぎ直した機器には、前の機器の失敗を出さない
  const again = await keyboard.connect()
  expect(readStateFor(store.get(), again)).toEqual({ status: 'reading', progress: null })
})

test('診断で読み直した結果は、その機器の読み出しが終わっている時だけ入れ替える', async () => {
  const keyboard = createFakeCornix()
  const fake = await keyboard.connect()
  const other = await createFakeCornix().connect()
  const store = heldStore()
  const reread = await readReportFrom(fake, null)

  // 読み込み中は入れ替えない
  const reading: HeldRead = { device: fake, run: 1, state: { status: 'reading', progress: null } }
  expect(replaceReport(reading, fake, reread)).toBe(reading)
  expect(replaceReport(null, fake, reread)).toBeNull()

  await runRead(fake, 1, store.set)
  // 別の機器の結果では入れ替えない
  expect(replaceReport(store.get(), other, reread)).toBe(store.get())
  expect(replaceReport(store.get(), fake, reread)).toMatchObject({ device: fake, run: 1, state: { status: 'done', report: reread } })
})

test('ヘッダーの「書き込み」に、編集の数を出す。押せないまま', () => {
  const html = header({ status: 'connected', device }, { read: true, changes: 3 })
  expect(html).toContain('<button type="button" class="primary" disabled="" title="準備中">書き込み（変更 3 件）</button>')
})

test('接続が切れた後のヘッダー: 残り枠数とボタンは出したまま、「未接続」と「接続」にする', () => {
  const html = header({ status: 'disconnected', lostAfterMs: 1000 }, { read: true, changes: 1 })
  expect(html).toContain('未接続</span><button type="button">接続</button>')
  expect(html).toContain('Tap Dance 残り <b>30</b> / 32')
  expect(html).toContain('書き込み（変更 1 件）')
  expect(html).not.toContain('▾')
})

test('つなぎ直して読み直している間のヘッダー: 読み終えるまで、本体の情報は開けない', () => {
  const html = renderToStaticMarkup(
    <AppHeader
      connection={{ status: 'connected', device }}
      supported
      slots={slotCounts(report.snapshot)}
      changes={1}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onDeviceInfo={null}
    />,
  )
  expect(html).toContain('<span class="chip chip-off">接続済み: Cornix</span>')
  expect(html).toContain('書き込み（変更 1 件）')
})

const banner = (connection: ConnectionState, options: { changes?: number; reading?: ReadState | null; supported?: boolean } = {}) =>
  renderToStaticMarkup(
    <SessionBanner
      connection={connection}
      reading={options.reading ?? null}
      supported={options.supported ?? true}
      changes={options.changes ?? 0}
      onConnect={() => {}}
      onRetry={() => {}}
    />,
  )

test('接続が切れた時の帯: 編集が残っていることと、「接続」を出す', () => {
  const html = banner({ status: 'disconnected', notice: '使わない', lostAfterMs: 185_000 }, { changes: 2 })
  expect(html).toBe(
    '<p class="banner banner-warning" role="alert">キーボードとの接続が切れました。編集した内容（2 件）は画面に残っています。' +
      'つなぎ直してから「接続」を押してください。（接続していた時間: 3 分 5 秒）<button type="button" class="primary">接続</button></p>',
  )
  // 編集がなければ、件数の文を出さない
  expect(banner({ status: 'disconnected', lostAfterMs: 1000 })).toContain('接続が切れました。つなぎ直してから')
})

test('接続していない間の帯: 自分で切った時、接続できなかった時、接続中、非対応ブラウザー', () => {
  expect(disconnectedNotice({ status: 'disconnected' }, 1)).toBe(
    'キーボードとの接続を切りました。編集した内容（1 件）は画面に残っています。続けるには「接続」を押してください。',
  )
  expect(disconnectedNotice({ status: 'disconnected', notice: describeError(new DeviceError('timeout')) }, 1)).toBe(
    'キーボードから応答がありません。電源と接続を確かめて、もう一度「接続」を押してください。編集した内容（1 件）は画面に残っています。',
  )
  const connecting = banner({ status: 'connecting' }, { changes: 1 })
  expect(connecting).toContain('キーボードに接続しています…編集した内容（1 件）は画面に残っています。')
  expect(connecting).toContain('disabled="">接続中…</button>')
  expect(banner({ status: 'disconnected' }, { supported: false })).toContain('disabled="">接続</button>')
})

test('つなぎ直した後の帯: 読み直している間はその旨を、失敗したら原因と「もう一度読み出す」を出す。読み終えたら出さない', () => {
  const connected: ConnectionState = { status: 'connected', device }
  const reading = banner(connected, { reading: { status: 'reading', progress: { step: 'キーマップ', done: 0, total: 1 } } })
  expect(reading).toBe('<p class="banner banner-warning" role="status">本体の設定を読み直しています…（キーマップ）</p>')
  const failed = banner(connected, {
    reading: { status: 'failed', failure: describeReadError(new DeviceError('timeout', { step: 'キーマップ' })) },
  })
  expect(failed).toContain('本体の設定を読み直せませんでした。「キーマップ」を読んでいる途中で、キーボードから応答がなくなりました。')
  expect(failed).toContain('もう一度読み出す</button>')
  expect(banner(connected, { reading: { status: 'done', report } })).toBe('')
})

test('本体の設定が変わっていた時のダイアログ: 編集を当て直すか、捨てるか、やめるかを選ばせる', () => {
  const html = renderToStaticMarkup(
    <ReloadDialog pending={{ reason: 'changed', fresh: cornixSnapshot() }} changes={2} onChoose={() => {}} />,
  )
  expect(html).toContain('<h2 id="reload-title" class="ng">本体の設定が変わっています</h2>')
  expect(html).toContain('編集した内容（2 件）を、読み直した内容の上に当て直して続けるか')
  expect(html).toContain(
    '<button type="button">やめる</button><button type="button" class="">編集を捨てる</button>' +
      '<button type="button" class="primary">編集を当て直して続ける</button>',
  )
})

test('別の機器だった時のダイアログ: 編集を捨てる前に確認する。当て直す選択肢は出さない', () => {
  const html = renderToStaticMarkup(
    <ReloadDialog pending={{ reason: 'other-device', fresh: cornixSnapshot() }} changes={1} onChoose={() => {}} />,
  )
  expect(html).toContain('前とは別のキーボードです')
  expect(html).toContain('編集した内容（1 件）は、前のキーボードのものなので、このキーボードには使えません。')
  expect(html).toContain('<button type="button">やめる</button><button type="button" class="primary">編集を捨てて、このキーボードを読み込む</button></div>')
  expect(html).not.toContain('当て直して続ける')
})
