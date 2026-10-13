import { expect, test } from 'vitest'
import { DeviceError } from '../types.ts'
import { findReportId, openVialDevice } from './connect.ts'
import { REPORT_SIZE, type HidDeviceLike } from './transport.ts'
import { sampleState } from './testing/sampleState.ts'
import { definitionJson } from './testing/definitionFixture.ts'
import { respond } from './testing/simulatedKeyboard.ts'
import { ExchangeLog, type HidEvents, type RawHidDevice } from './vialDevice.ts'
// 実機（Cornix LP、ファームウェア V1.12）から 2026-10-12 に取った記録。UID だけ、にせの値に置き換えてある
import cornixBluetooth from '../fixtures/cornix/bluetooth.json'
import cornixUsb from '../fixtures/cornix/usb.json'
import cornixVil from '../fixtures/cornix/cornix.vil?raw'

const collection = (usagePage: number, usage: number, reportId?: number): HIDCollectionInfo => ({
  usagePage,
  usage,
  outputReports: reportId === undefined ? [] : [{ reportId }],
})

type InputListener = (event: { data: DataView }) => void

/** 要求を受けるたびに、決めた応答を返す偽の HID 機器 */
class FakeHidDevice implements RawHidDevice, HidDeviceLike {
  opened = false
  productName = 'Cornix'
  collections = [collection(0xff60, 0x61)]
  private listeners = new Set<InputListener>()
  protected readonly reply: (request: Uint8Array) => Uint8Array

  constructor(reply: number[] | ((request: Uint8Array) => Uint8Array)) {
    this.reply =
      typeof reply === 'function'
        ? reply
        : () => {
            const report = new Uint8Array(REPORT_SIZE)
            report.set(reply)
            return report
          }
  }

  async open(): Promise<void> {
    this.opened = true
  }

  async close(): Promise<void> {
    this.opened = false
  }

  async sendReport(_reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const report = this.reply(data)
    queueMicrotask(() => this.deliver(report))
  }

  protected deliver(report: Uint8Array): void {
    for (const listener of this.listeners) listener({ data: new DataView(report.buffer) })
  }

  addEventListener(_type: 'inputreport', listener: InputListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'inputreport', listener: InputListener): void {
    this.listeners.delete(listener)
  }
}

/** 切断のイベントを、テストから起こせる偽の navigator.hid */
class FakeHid implements HidEvents {
  private listeners = new Set<(event: { device: unknown }) => void>()

  addEventListener(_type: 'disconnect', listener: (event: { device: unknown }) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'disconnect', listener: (event: { device: unknown }) => void): void {
    this.listeners.delete(listener)
  }

  disconnect(device: unknown): void {
    for (const listener of [...this.listeners]) listener({ device })
  }
}

test('Raw HID の出力レポートの ID を返す', () => {
  const device = { collections: [collection(0x01, 0x06, 1), collection(0xff60, 0x61, 4)] }
  expect(findReportId(device)).toBe(4)
})

test('出力レポートの情報がなければ 0 を返す', () => {
  expect(findReportId({ collections: [collection(0xff60, 0x61)] })).toBe(0)
  expect(findReportId({ collections: [] })).toBe(0)
})

test('応答の先頭が 0x01 なら接続し、機器名と VIA の版を持つ', async () => {
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, new FakeHid())
  expect(hidDevice.opened).toBe(true)
  expect(device.name).toBe('Cornix')
  expect(device.protocol).toBe('VIA プロトコル 9')
})

test('応答の先頭が 0x01 でなければ unexpected-response で失敗し、機器を閉じる', async () => {
  const hidDevice = new FakeHidDevice([0x12, 0x00, 0x09])
  const error = await openVialDevice(hidDevice, new FakeHid()).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'unexpected-response' })
  expect(hidDevice.opened).toBe(false)
})

test('機器がなくなると、切断を1回だけ知らせる。別の機器の切断では知らせない', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)
  let notified = 0
  device.onDisconnect(() => notified++)

  hid.disconnect({})
  expect(notified).toBe(0)
  hid.disconnect(hidDevice)
  hid.disconnect(hidDevice)
  expect(notified).toBe(1)
})

test('こちらから切断した後は、切断を知らせない', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)
  let notified = 0
  device.onDisconnect(() => notified++)

  await device.disconnect()
  expect(hidDevice.opened).toBe(false)
  hid.disconnect(hidDevice)
  expect(notified).toBe(0)
})

test('本体の設定をまとめて読み、進み具合を知らせ、通信を記録する', async () => {
  const state = sampleState()
  const device = await openVialDevice(new FakeHidDevice((request) => respond(state, request)), new FakeHid())
  const steps: string[] = []
  const snapshot = await device.read((progress) => steps.push(progress.step))

  expect(snapshot).toEqual({
    uid: '0123456789abcdef',
    layout: { rows: 2, cols: 3, encoderCount: 1, raw: definitionJson },
    capabilities: { viaProtocol: 9, vialProtocol: 6, layerCount: 3, tapDanceCount: 2, comboCount: 1 },
    keymap: state.keymap,
    encoders: state.encoders,
    tapDances: state.tapDances,
    combos: state.combos,
  })
  expect(new Set(steps)).toContain('キーマップ')
  const exchanges = device.exchanges()
  expect(exchanges[0]).toMatchObject({ request: expect.stringMatching(/^01/), response: expect.stringMatching(/^010009/) })
  expect(exchanges.length).toBeGreaterThan(10)
})

test('読み出しの途中で失敗したら、どこで失敗したかを添えて失敗する', async () => {
  const state = { ...sampleState(), failTapDanceAt: 1 }
  const device = await openVialDevice(new FakeHidDevice((request) => respond(state, request)), new FakeHid())
  const error = await device.read().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'unexpected-response', step: 'Tap Dance' })
})

test('最後のロックの状態の読み出しで通信に失敗しても、読み出しは失敗する', async () => {
  const state = sampleState()
  const reply = (request: Uint8Array) => {
    if (request[0] === 0xfe && request[1] === 0x05) throw new Error('送信できない')
    return respond(state, request)
  }
  const device = await openVialDevice(new FakeHidDevice(reply), new FakeHid())
  const error = await device.read().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'send-failed', step: 'ロックの状態' })
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// 実際に待つ時間を短くするための、テスト用の待ち時間
const TIMING = { timeoutMs: 30, settleMs: 15 }
const LATE = 45

/**
 * 応答を、要求の順のまま遅らせたり、余分な応答を挟んだりできる偽の HID 機器。
 * plan は、要求ごとに、応答を遅らせる時間（delayMs）と、応答の前に届ける余分な応答（extra）を返す
 */
class SlowHidDevice extends FakeHidDevice {
  requests: Uint8Array[] = []
  private deliveries = Promise.resolve()
  private readonly plan: (request: Uint8Array) => { delayMs?: number; extra?: number[] }

  constructor(reply: (request: Uint8Array) => Uint8Array, plan: SlowHidDevice['plan']) {
    super(reply)
    this.plan = plan
  }

  override async sendReport(_reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    this.requests.push(data.slice())
    const { delayMs, extra } = this.plan(data)
    const report = this.reply(data)
    if (extra) this.deliver(Uint8Array.from({ length: REPORT_SIZE }, (_, i) => extra[i] ?? 0))
    // 機器は要求の順に応答するので、遅れた応答の後ろの応答も、その後に届く
    this.deliveries = this.deliveries.then(async () => {
      if (delayMs !== undefined) await sleep(delayMs)
      this.deliver(report)
    })
  }

  count(command: number): number {
    return this.requests.filter((request) => request[0] === command).length
  }
}

const isEncoderRead = (request: Uint8Array) => request[0] === 0xfe && request[1] === 0x03

test('読み出しの途中のタイムアウトで、読み出しが最初からやり直される', async () => {
  const state = sampleState()
  let delayed = false
  const hidDevice = new SlowHidDevice(
    (request) => respond(state, request),
    (request) => {
      // エンコーダーの読み出しの応答を、1回だけ、待ち時間を超えて遅らせる
      if (delayed || !isEncoderRead(request)) return {}
      delayed = true
      return { delayMs: LATE }
    },
  )
  const device = await openVialDevice(hidDevice, new FakeHid(), TIMING)
  const steps: string[] = []
  const snapshot = await device.read((progress) => {
    if (progress.done === 0) steps.push(progress.step)
  })

  expect(snapshot.keymap).toEqual(state.keymap)
  expect(snapshot.encoders).toEqual(state.encoders)
  expect(snapshot.tapDances).toEqual(state.tapDances)
  expect(snapshot.combos).toEqual(state.combos)
  // エンコーダーまで読んだ後、最初から読み直している
  expect(steps.slice(0, 7)).toEqual([
    'VIA の版', 'Vial の版と UID', 'レイアウト定義', 'レイヤー数', 'キーマップ', 'エンコーダー', 'VIA の版',
  ])
  expect(steps.filter((step) => step === 'キーマップ')).toHaveLength(2)
  expect(device.exchanges().filter((exchange) => exchange.response === null)).toHaveLength(1)
})

test('やり直しても応答が遅れ続けたら、上限の回数でやめて、timeout で失敗する', async () => {
  const state = sampleState()
  // レイヤー数の応答が、いつも待ち時間を超えて遅れる
  const hidDevice = new SlowHidDevice(
    (request) => respond(state, request),
    (request) => (request[0] === 0x11 ? { delayMs: LATE } : {}),
  )
  const device = await openVialDevice(hidDevice, new FakeHid(), TIMING)
  const error = await device.read().catch((e: unknown) => e)

  expect(error).toBeInstanceOf(DeviceError)
  expect(error).toMatchObject({ kind: 'timeout', step: 'レイヤー数' })
  // 読み出し 3 回（最初の1回と、やり直し 2 回）で、それぞれ送り直しを1回
  expect(hidDevice.count(0x11)).toBe(6)
})

test('応答が1つずれたまま最後まで読んだら、最後の確認で気づいて、同期をやり直して読み直す', async () => {
  const state = sampleState()
  let shifted = false
  const hidDevice = new SlowHidDevice(
    (request) => respond(state, request),
    (request) => {
      // 応答が少し遅れて届く機器で、Tap Dance の読み出しの前に、余分な応答が1つ届く。
      // Vial の応答は要求と突き合わせられないので、以後の応答が1つずつずれる
      if (shifted || !(request[0] === 0xfe && request[1] === 0x0d && request[2] === 0x01)) return { delayMs: 0 }
      shifted = true
      return { delayMs: 0, extra: [0x00, 0x99] }
    },
  )
  const device = await openVialDevice(hidDevice, new FakeHid(), TIMING)
  const steps: string[] = []
  const snapshot = await device.read((progress) => {
    if (progress.done === 0) steps.push(progress.step)
  })

  expect(snapshot.tapDances).toEqual(state.tapDances)
  expect(snapshot.combos).toEqual(state.combos)
  expect(steps.filter((step) => step === 'VIA の版（読み出しの確認）')).toHaveLength(2)
  expect(steps.filter((step) => step === 'VIA の版')).toHaveLength(2)
})

test('応答の遅れがない失敗では、読み出しをやり直さない', async () => {
  const state = { ...sampleState(), failTapDanceAt: 1 }
  const hidDevice = new SlowHidDevice((request) => respond(state, request), () => ({}))
  const device = await openVialDevice(hidDevice, new FakeHid(), TIMING)
  await expect(device.read()).rejects.toMatchObject({ kind: 'unexpected-response', step: 'Tap Dance' })
  expect(hidDevice.count(0x11)).toBe(1)
})

test('切断の登録より前に機器がなくなっていたら、登録した時にすぐ知らせる', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)

  hid.disconnect(hidDevice)
  let notified = 0
  device.onDisconnect(() => notified++)
  expect(notified).toBe(1)
})

test('こちらから切断した後に登録しても、切断を知らせない', async () => {
  const hid = new FakeHid()
  const hidDevice = new FakeHidDevice([0x01, 0x00, 0x09])
  const device = await openVialDevice(hidDevice, hid)

  await device.disconnect()
  hid.disconnect(hidDevice)
  let notified = 0
  device.onDisconnect(() => notified++)
  expect(notified).toBe(0)
})

test('通信の記録は、上限を超えて古いものを捨てた後も、ある時点より後の分を正しく返す', () => {
  const log = new ExchangeLog(3)
  const record = (byte: number) => log.record(Uint8Array.of(byte), Uint8Array.of(byte), 1)
  ;[1, 2, 3].forEach(record)
  const before = log.count()
  ;[4, 5].forEach(record)

  expect(log.count()).toBe(5)
  expect(log.list(before).map((e) => e.request)).toEqual(['04', '05'])
  // 上限に達した後の読み出しでも、その読み出しの分だけが返る
  const later = log.count()
  record(6)
  expect(log.list(later).map((e) => e.request)).toEqual(['06'])
  expect(log.list()).toHaveLength(3)
})

const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))

/** 記録（「要求>応答@ミリ秒」）にある要求に、記録どおりの応答を返す */
function replay(exchanges: string[]): (request: Uint8Array) => Uint8Array {
  const pad = (hex: string) => hex.padEnd(REPORT_SIZE * 2, '0')
  const responses = new Map(
    exchanges.map((line) => {
      const [request, response] = line.replace(/@.*$/, '').split('>')
      return [pad(request), fromHex(pad(response))] as const
    }),
  )
  return (request) => {
    const key = Array.from(request, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const response = responses.get(key)
    if (!response) throw new Error(`記録にない要求: ${key}`)
    return response
  }
}

test.each([
  ['USB', cornixUsb],
  ['Bluetooth', cornixBluetooth],
])('実機の通信の記録（%s）から、その時と同じ内容を読み出せる', async (_name, recorded) => {
  const device = await openVialDevice(new FakeHidDevice(replay(recorded.exchanges)), new FakeHid())
  const snapshot = await device.read()

  expect(snapshot).toEqual(recorded.snapshot)
  expect(snapshot.layout).toMatchObject({ rows: 8, cols: 7, encoderCount: 2 })
  expect(snapshot.capabilities).toEqual({
    viaProtocol: 9,
    vialProtocol: 6,
    layerCount: 10,
    tapDanceCount: 32,
    comboCount: 32,
  })
})

test('実機の読み出しは、同じ時に Vial で保存した .vil と、同じ並び順で対応する', () => {
  const { snapshot } = cornixUsb
  const vil = JSON.parse(cornixVil) as {
    layout: (string | number)[][][]
    encoder_layout: string[][][]
    tap_dance: [string, string, string, string, number][]
    combo: string[][]
  }
  // .vil はキーコードを名前で持つ。同じ名前がいつも同じ数値に当たれば、並び順が合っている
  const valueOf = new Map<string | number, number>()
  const mismatches: string[] = []
  const pair = (names: (string | number)[], values: number[]) => {
    expect(names).toHaveLength(values.length)
    names.forEach((name, i) => {
      const known = valueOf.get(name) ?? values[i]
      valueOf.set(name, known)
      if (known !== values[i]) mismatches.push(`${name}: ${known} と ${values[i]}`)
    })
  }

  expect(vil.layout).toHaveLength(snapshot.keymap.length)
  vil.layout.forEach((layer, i) => pair(layer.flat(), snapshot.keymap[i]))
  vil.encoder_layout.forEach((layer, i) => pair(layer.flat(), snapshot.encoders[i].flat()))
  expect(vil.tap_dance).toHaveLength(snapshot.tapDances.length)
  vil.tap_dance.forEach(([onTap, onHold, onDoubleTap, onTapHold, tappingTerm], i) => {
    const entry = snapshot.tapDances[i]
    pair([onTap, onHold, onDoubleTap, onTapHold], [entry.onTap, entry.onHold, entry.onDoubleTap, entry.onTapHold])
    expect(tappingTerm).toBe(entry.tappingTerm)
  })
  expect(vil.combo).toHaveLength(snapshot.combos.length)
  vil.combo.forEach((names, i) => pair(names, [...snapshot.combos[i].keys, snapshot.combos[i].output]))

  expect(mismatches).toEqual([])
  // キーのない位置は .vil では -1、本体では 0
  expect(valueOf.get(-1)).toBe(0)
  expect(valueOf.get('MO(2)')).toBe(0x5222)
  expect(valueOf.get('OSL(1)')).toBe(0x5281)
  expect(valueOf.get('TD(0)')).toBe(0x5700)
  expect(valueOf.get('USER00')).toBe(0x7e00)
})
