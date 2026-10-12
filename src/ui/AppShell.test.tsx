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
import { ConnectStage, ReadFailedStage, ReadingStage } from './Stage.tsx'
import { describeError, formatDuration, type ConnectionState } from './useConnection.ts'
import { readReportFrom } from './useDeviceRead.ts'

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

const header = (connection: ConnectionState, options: { supported?: boolean; read?: boolean } = {}) =>
  renderToStaticMarkup(
    <AppHeader
      connection={connection}
      supported={options.supported ?? true}
      slots={options.read ? slotCounts(report.snapshot) : null}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onDeviceInfo={() => {}}
    />,
  )

const count = (html: string, needle: string) => html.split(needle).length - 1

test('接続前の画面: ヘッダーは「未接続」と「接続」、図の代わりに、つなぎ方の手順のカードを出す', () => {
  const html = renderToStaticMarkup(<App connector={createFakeCornix()} supported />)
  expect(html).toContain('<span class="chip chip-off" aria-live="polite">未接続</span><button type="button">接続</button>')
  expect(html).toContain('Cornix をつないで、設定を読み込みます')
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
