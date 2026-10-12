import { expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { DeviceError, type WriteOperation } from '../types.ts'
import { ReadResult } from '../../ui/Diagnostics.tsx'
import { buildReadReport } from '../../ui/readReport.ts'
import { cornixSnapshot, createFakeCornix } from './cornix.ts'
import { failuresFromQuery } from './fakeDevice.ts'

const operations: WriteOperation[] = [
  { type: 'setKey', layer: 0, key: 1, keycode: 0x0004 },
  { type: 'setEncoder', layer: 1, encoder: 0, direction: 'right', keycode: 0x0052 },
  { type: 'setTapDance', index: 2, entry: { onTap: 4, onHold: 0xe0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 } },
  { type: 'setCombo', index: 0, entry: { keys: [4, 5, 0, 0], output: 0x29 } },
]

const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e)

test('実機から読んだ設定を初期値として読める。読んだ値を書き換えても、本体の中身は変わらない', async () => {
  const device = await createFakeCornix().connect()
  const steps: string[] = []
  const snapshot = await device.read((progress) => steps.push(progress.step))

  expect(snapshot).toEqual(cornixSnapshot())
  expect(snapshot.capabilities).toMatchObject({ layerCount: 10, tapDanceCount: 32, comboCount: 32 })
  expect(steps).toContain('キーマップ')

  snapshot.keymap[0][0] = 0xffff
  expect(await device.read()).toEqual(cornixSnapshot())
})

test('書いた操作が、次の読み出しに反映される。進み具合を知らせる', async () => {
  const device = await createFakeCornix().connect()
  const progress: number[] = []
  await device.write(operations, ({ done, total }) => progress.push(done / total))

  const expected = cornixSnapshot()
  expected.keymap[0][1] = 0x0004
  expected.encoders[1][0][1] = 0x0052
  expected.tapDances[2] = { onTap: 4, onHold: 0xe0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 }
  expected.combos[0] = { keys: [4, 5, 0, 0], output: 0x29 }
  expect(await device.read()).toEqual(expected)
  expect(progress).toEqual([0.25, 0.5, 0.75, 1])
})

test('書いた設定は、つなぎ直しても残る', async () => {
  const keyboard = createFakeCornix()
  const first = await keyboard.connect()
  await first.write([operations[0]])
  await first.disconnect()

  const second = await keyboard.connect()
  expect((await second.read()).keymap[0][1]).toBe(0x0004)
})

test('本体にない場所への書き込みは RangeError になる', async () => {
  const device = await createFakeCornix().connect()
  for (const operation of [
    { type: 'setKey', layer: 10, key: 0, keycode: 4 },
    { type: 'setKey', layer: 0, key: 56, keycode: 4 },
    { type: 'setEncoder', layer: 0, encoder: 2, direction: 'left', keycode: 4 },
    { type: 'setTapDance', index: 32, entry: { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 } },
    { type: 'setCombo', index: 32, entry: { keys: [0, 0, 0, 0], output: 0 } },
  ] satisfies WriteOperation[]) {
    expect(await failure(device.write([operation]))).toBeInstanceOf(RangeError)
  }
})

test('N 番目の書き込みで失敗すると、それより前の操作だけが書かれている。やり直すと通る', async () => {
  const keyboard = createFakeCornix({ failures: { failWriteAt: { operation: 3 } } })
  const device = await keyboard.connect()

  const error = await failure(device.write(operations))
  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'timeout', operation: 2 })
  const after = await device.read()
  expect(after.keymap[0][1]).toBe(0x0004)
  expect(after.encoders[1][0][1]).toBe(0x0052)
  expect(after.tapDances[2]).toEqual(cornixSnapshot().tapDances[2])
  expect(after.combos[0]).toEqual(cornixSnapshot().combos[0])

  // 失敗は1回だけ起きる。残りの操作をやり直すと書ける
  await device.write(operations.slice(2))
  expect((await device.read()).combos[0]).toEqual({ keys: [4, 5, 0, 0], output: 0x29 })
})

test('失敗の種類を指定できる', async () => {
  const keyboard = createFakeCornix({ failures: { failWriteAt: { operation: 1, kind: 'send-failed' } } })
  const device = await keyboard.connect()
  expect(await failure(device.write(operations))).toMatchObject({ kind: 'send-failed', operation: 0 })
})

test('書き込みの途中で切断すると、切断を1回知らせ、以後の読み書きは disconnected で失敗する', async () => {
  const keyboard = createFakeCornix({ failures: { disconnectAtWrite: 2 } })
  const device = await keyboard.connect()
  let notified = 0
  device.onDisconnect(() => notified++)

  expect(await failure(device.write(operations))).toMatchObject({ kind: 'disconnected', operation: 1 })
  expect(notified).toBe(1)
  expect(await failure(device.read())).toMatchObject({ kind: 'disconnected' })
  expect(await failure(device.write(operations))).toMatchObject({ kind: 'disconnected', operation: 0 })

  // つなぎ直すと、切断の前に書いた分だけが残っている
  const again = await keyboard.connect()
  const snapshot = await again.read()
  expect(snapshot.keymap[0][1]).toBe(0x0004)
  expect(snapshot.encoders[1][0][1]).toBe(cornixSnapshot().encoders[1][0][1])
  expect(notified).toBe(1)
})

test('機器がなくなると切断を知らせる。こちらから切断した時は知らせない', async () => {
  const keyboard = createFakeCornix()
  const lost = await keyboard.connect()
  let notified = 0
  lost.onDisconnect(() => notified++)
  keyboard.loseConnection()
  keyboard.loseConnection()
  expect(notified).toBe(1)
  // 登録より前になくなっていたら、登録した時にすぐ知らせる
  lost.onDisconnect(() => notified++)
  expect(notified).toBe(2)

  const closed = await keyboard.connect()
  let closedNotified = 0
  closed.onDisconnect(() => closedNotified++)
  await closed.disconnect()
  keyboard.loseConnection()
  expect(closedNotified).toBe(0)
  expect(await failure(closed.read())).toMatchObject({ kind: 'disconnected' })
})

test('読み直しで、指定した回だけ違う値を返す。本体の中身は変わらない', async () => {
  const keyboard = createFakeCornix({
    failures: { alterReadAt: { read: 2, alter: (snapshot) => (snapshot.keymap[0][0] = 0x0005) } },
  })
  const device = await keyboard.connect()
  expect(await device.read()).toEqual(cornixSnapshot())
  expect((await device.read()).keymap[0][0]).toBe(0x0005)
  expect(await device.read()).toEqual(cornixSnapshot())
})

test('指定した回の読み出しだけ、途中で失敗する。どこを読んでいたかを添え、次の読み出しは通る', async () => {
  const keyboard = createFakeCornix({ failures: { failReadAt: { read: 1 } } })
  const device = await keyboard.connect()
  const steps: string[] = []

  const error = await failure(device.read((progress) => steps.push(progress.step)))
  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'timeout', step: 'キーマップ' })
  // 失敗した所より後は読まない
  expect(steps).toEqual(['レイアウト定義', 'キーマップ'])
  expect(await device.read()).toEqual(cornixSnapshot())
})

test('読み出しの失敗は、読んでいた所と種類を指定できる', async () => {
  const keyboard = createFakeCornix({
    failures: { failReadAt: { read: 2, step: 'Tap Dance', kind: 'unexpected-response' } },
  })
  const device = await keyboard.connect()
  expect(await device.read()).toEqual(cornixSnapshot())
  expect(await failure(device.read())).toMatchObject({ kind: 'unexpected-response', step: 'Tap Dance' })
})

test('URL の指定から、読み出しの失敗を作る。指定がない時と、読めない指定では、失敗を起こさない', () => {
  const from = (query: string) => failuresFromQuery(new URLSearchParams(query))
  expect(from('fake&failRead=1')).toEqual({ failReadAt: { read: 1, kind: undefined } })
  expect(from('fake&failRead=2&failKind=disconnected')).toEqual({ failReadAt: { read: 2, kind: 'disconnected' } })
  expect(from('fake&failRead=1&failKind=unknown')).toEqual({ failReadAt: { read: 1, kind: undefined } })
  expect(from('fake')).toEqual({})
  expect(from('fake&failRead=0')).toEqual({})
  expect(from('fake&failRead=x')).toEqual({})
})

test('ほかから設定を変えられた場合を、本体の中身を直接書き換えてまねられる', async () => {
  const keyboard = createFakeCornix()
  const device = await keyboard.connect()
  keyboard.snapshot.keymap[0][0] = 0x0005
  expect((await device.read()).keymap[0][0]).toBe(0x0005)
})

test('診断の生の値の表に、偽の機器のデータを表示できる', async () => {
  const device = await createFakeCornix().connect()
  const report = buildReadReport({
    readAt: new Date('2026-10-12T00:00:00Z'),
    userAgent: 'test',
    device: { name: device.name, protocol: device.protocol },
    snapshot: await device.read(),
    differencesFromPrevious: null,
    exchanges: device.exchanges(),
  })
  const html = renderToStaticMarkup(createElement(ReadResult, { report }))
  expect(html).toContain('8 行 × 7 列')
  expect(html).toContain('<td>0x5222</td>')
  expect(html).toContain('<td>250</td>')
})
