import { expect, test } from 'vitest'
import {
  ACTION_CATEGORIES,
  canPlace,
  candidates,
  KEY_CODES,
  labelOf,
  LAYER_MODES,
  layerModeName,
  layerModesFor,
  searchActions,
  type Action,
  type ActionSlot,
  type Mod,
  type PickerContext,
} from './action.ts'

const key = (code: number, ...mods: Mod[]): Action => ({ kind: 'key', code, mods })
const mods = (...list: Mod[]): Action => ({ kind: 'key', mods: list })
const L = (kind: Mod['kind']): Mod => ({ kind, side: 'left' })
const R = (kind: Mod['kind']): Mod => ({ kind, side: 'right' })
const layer = (mode: (typeof LAYER_MODES)[number], n: number): Action => ({ kind: 'layer', mode, layer: n })

const SLOTS: ActionSlot[] = ['tap', 'hold', 'doubleTap', 'tapHold', 'encoder', 'combo']
const context = (slot: ActionSlot, extra: Partial<PickerContext> = {}): PickerContext => ({
  slot,
  layerCount: 10,
  layerModes: LAYER_MODES,
  ...extra,
})

// ---- 表示名 ----

test('文字、数字、記号、移動のキーの表示名', () => {
  expect(labelOf(key(0x04))).toMatchObject({ short: 'A', full: 'A' })
  expect(labelOf(key(0x1d))).toMatchObject({ short: 'Z', full: 'Z' })
  expect(labelOf(key(0x2a))).toMatchObject({ short: 'BS', full: 'Backspace' })
  expect(labelOf(key(0x45))).toMatchObject({ short: 'F12' })
  expect(labelOf(key(0x68))).toMatchObject({ short: 'F13' })
  expect(labelOf(key(0x73))).toMatchObject({ short: 'F24' })
  expect(labelOf(key(0x52))).toMatchObject({ short: '↑' })
  expect(labelOf(key(0x90))).toMatchObject({ short: 'かな', full: 'かな（LANG1）' })
  expect(labelOf(key(0xa9))).toMatchObject({ short: '音量＋', full: '音量を上げる' })
  expect(labelOf(key(0xd3))).toMatchObject({ short: '中クリック', full: 'マウスの中ボタン' })
  expect(labelOf(key(0x59))).toMatchObject({ short: '1', note: 'テンキー', full: 'テンキー 1' })
  expect(labelOf(key(0x62))).toMatchObject({ short: '0', full: 'テンキー 0' })
})

test('数字と記号のキーは、Shift を押しながら打った時の字も返す', () => {
  expect(labelOf(key(0x1e))).toMatchObject({ short: '1', shifted: '!' })
  expect(labelOf(key(0x27))).toMatchObject({ short: '0', shifted: ')' })
  expect(labelOf(key(0x33))).toMatchObject({ short: ';', shifted: ':' })
  expect(labelOf(key(0x38))).toMatchObject({ short: '/', shifted: '?' })
  expect(labelOf(key(0x04)).shifted).toBeUndefined()
  expect(labelOf(key(0x28)).shifted).toBeUndefined()
})

test('刻印を JIS 配列にすると、数字と記号のキーの見え方だけが変わる', () => {
  expect(labelOf(key(0x1f), 'jis')).toMatchObject({ short: '2', shifted: '"' })
  expect(labelOf(key(0x27), 'jis')).toEqual({ short: '0', full: '0', shifted: undefined })
  expect(labelOf(key(0x2e), 'jis')).toMatchObject({ short: '^', shifted: '~' })
  expect(labelOf(key(0x2f), 'jis')).toMatchObject({ short: '@', shifted: '`' })
  expect(labelOf(key(0x34), 'jis')).toMatchObject({ short: ':', shifted: '*' })
  expect(labelOf(key(0x35), 'jis')).toMatchObject({ short: '半/全', full: '半角 / 全角' })
  // US と同じ字のキーは変わらない
  expect(labelOf(key(0x1e), 'jis')).toEqual(labelOf(key(0x1e), 'us'))
  expect(labelOf(key(0x04), 'jis')).toEqual(labelOf(key(0x04), 'us'))
  expect(labelOf(key(0x36), 'jis')).toEqual(labelOf(key(0x36), 'us'))
})

test('修飾キーだけの動作の表示名', () => {
  expect(labelOf(mods(L('ctrl')))).toEqual({ short: 'Ctrl', full: '左 Ctrl' })
  expect(labelOf(mods(R('shift')))).toEqual({ short: 'Shift', full: '右 Shift' })
  expect(labelOf(mods(L('gui')))).toEqual({ short: 'GUI', full: '左 GUI（Cmd / Win）' })
  expect(labelOf(mods(L('ctrl'), L('shift')))).toEqual({ short: 'Ctrl+Shift', full: 'Ctrl + Shift' })
  expect(labelOf(mods(R('ctrl'), R('alt')))).toEqual({ short: 'Ctrl+Alt', full: '右 Ctrl + 右 Alt' })
})

test('ショートカットの表示名。Shift だけを付けた数字と記号は、出る字で表す', () => {
  expect(labelOf(key(0x06, L('ctrl')))).toEqual({ short: 'Ctrl+C', full: 'Ctrl + C' })
  expect(labelOf(key(0x09, R('ctrl')))).toEqual({ short: 'Ctrl+F', full: '右 Ctrl + F' })
  expect(labelOf(key(0x2a, L('ctrl'), L('alt')))).toEqual({ short: 'Ctrl+Alt+BS', full: 'Ctrl + Alt + Backspace' })
  expect(labelOf(key(0x33, L('shift')))).toEqual({ short: ':', full: ':（Shift + ;）' })
  expect(labelOf(key(0x37, R('shift')))).toEqual({ short: '>', full: '>（右 Shift + .）' })
  expect(labelOf(key(0x33, L('shift')), 'jis')).toEqual({ short: '+', full: '+（Shift + ;）' })
  // 出る字が変わらないキーと、ほかの修飾キーもある時は、組み合わせで表す
  expect(labelOf(key(0x04, L('shift')))).toEqual({ short: 'Shift+A', full: 'Shift + A' })
  expect(labelOf(key(0x1e, L('ctrl'), L('shift')))).toEqual({ short: 'Ctrl+Shift+1', full: 'Ctrl + Shift + 1' })
  // 編集欄には、Shift で出る字を出さない
  expect(labelOf(key(0x1e, L('ctrl'))).shifted).toBeUndefined()
})

test('レイヤー切り替えは、平易な日本語で表す', () => {
  expect(labelOf(layer('momentary', 1))).toEqual({ short: 'レイヤー 1', note: '押している間', full: '押している間だけレイヤー 1' })
  expect(labelOf(layer('toggle', 2))).toEqual({ short: 'レイヤー 2', note: 'オン / オフ', full: '押すたびにレイヤー 2 をオン・オフ' })
  expect(labelOf(layer('to', 0))).toEqual({ short: 'レイヤー 0', note: '移動', full: 'レイヤー 0 に移動' })
  expect(labelOf(layer('oneShot', 3))).toEqual({ short: 'レイヤー 3', note: '次の1キー', full: '次の1キーだけレイヤー 3' })
  expect(LAYER_MODES.map(layerModeName)).toEqual(['押している間だけ', '押すたびにオン・オフ', 'そのレイヤーに移動', '次の1キーだけ'])
})

test('透過、何もしない、unsupported、表にないキーの表示名', () => {
  expect(labelOf({ kind: 'transparent' })).toEqual({ short: '透過', full: '透過' })
  expect(labelOf({ kind: 'none' })).toEqual({ short: '', full: '何もしない' })
  expect(labelOf({ kind: 'unsupported', raw: 0x7e00, label: 'BT0' })).toEqual({ short: 'BT0', full: 'BT0' })
  expect(labelOf(key(0x03))).toEqual({ short: '0x0003', full: 'キーコード 0x0003' })
})

test('表にあるキーは、どれも名前を持つ', () => {
  for (const code of KEY_CODES) {
    for (const legend of ['us', 'jis'] as const) {
      const label = labelOf(key(code), legend)
      expect(label.short, `0x${code.toString(16)}`).not.toBe('')
      expect(label.full, `0x${code.toString(16)}`).not.toMatch(/0x/)
    }
  }
  // 修飾キー（0xE0〜0xE7）は code には入れない
  expect(KEY_CODES.filter((code) => code >= 0xe0 || code < 0x04)).toEqual([])
})

// ---- 欄ごとの決まり ----

test('「透過」と「何もしない」はタップ欄にだけ入れられる', () => {
  for (const action of [{ kind: 'transparent' }, { kind: 'none' }] as Action[]) {
    expect(SLOTS.filter((slot) => canPlace(action, slot))).toEqual(['tap'])
  }
})

test('「押している間だけ」は長押し欄とタップ後長押し欄にだけ、ほかのレイヤー切り替えはそれ以外に入れられる', () => {
  expect(SLOTS.filter((slot) => canPlace(layer('momentary', 1), slot))).toEqual(['hold', 'tapHold'])
  for (const mode of ['toggle', 'to', 'oneShot'] as const) {
    expect(SLOTS.filter((slot) => canPlace(layer(mode, 1), slot))).toEqual(['tap', 'doubleTap', 'encoder', 'combo'])
  }
})

test('キーはどの欄にも入れられ、unsupported はどの欄にも選べない', () => {
  expect(SLOTS.filter((slot) => canPlace(key(0x04, L('ctrl')), slot))).toEqual(SLOTS)
  expect(SLOTS.filter((slot) => canPlace({ kind: 'unsupported', raw: 0x7e00, label: 'BT0' }, slot))).toEqual([])
})

// ---- 対応するレイヤー切り替えの方式 ----

test('実機で確かめた Vial の版では、確かめた方式を返す', () => {
  expect(layerModesFor(6)).toEqual({ modes: ['momentary', 'toggle', 'to', 'oneShot'], verified: true })
})

test('確かめていない版では、4つとも選べるようにして、確かめていないと分かるようにする', () => {
  expect(layerModesFor(5)).toEqual({ modes: LAYER_MODES, verified: false })
  expect(layerModesFor(7)).toEqual({ modes: LAYER_MODES, verified: false })
})

// ---- 候補 ----

const layerCandidates = (c: PickerContext) =>
  candidates(c).flatMap(({ action }) => (action.kind === 'layer' ? [`${action.mode} ${action.layer}`] : []))

test('候補は3つの分類に分かれ、どれも空ではない', () => {
  expect(ACTION_CATEGORIES.map((category) => category.name)).toEqual(['キーボード', 'レイヤー切り替え', 'メディア・その他'])
  const all = candidates(context('tap'))
  for (const { id } of ACTION_CATEGORIES) {
    expect(all.some((candidate) => candidate.category === id), id).toBe(true)
  }
  // 「透過」と「何もしない」、unsupported は候補に出さない
  expect(all.every(({ action }) => action.kind === 'key' || action.kind === 'layer')).toBe(true)
})

test('候補の表示名は、分類の中で重ならない', () => {
  for (const legend of ['us', 'jis'] as const) {
    const names = candidates(context('tap')).map(({ action }) => labelOf(action, legend).full)
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([])
  }
})

test('キーボードの分類には、文字・数字・記号・修飾キー・移動のキーが入る', () => {
  const keyboard = candidates(context('tap'))
    .filter((candidate) => candidate.category === 'keyboard')
    .map(({ action }) => labelOf(action).full)
  expect(keyboard).toEqual(expect.arrayContaining(['A', '1', ';', 'Enter', '左 Ctrl', '右 GUI（Cmd / Win）', '←', 'Home', '!（Shift + 1）']))
  const other = candidates(context('tap'))
    .filter((candidate) => candidate.category === 'other')
    .map(({ action }) => labelOf(action).full)
  expect(other).toEqual(expect.arrayContaining(['消音', '音量を上げる', 'マウスのホイールを上へ', 'マウスの中ボタン']))
})

test('レイヤー切り替えの候補は、欄に入れられる方式と、本体にあるレイヤーだけ', () => {
  expect(layerCandidates(context('hold', { layerCount: 3 }))).toEqual(['momentary 0', 'momentary 1', 'momentary 2'])
  expect(layerCandidates(context('tap', { layerCount: 2 }))).toEqual(['toggle 0', 'toggle 1', 'to 0', 'to 1', 'oneShot 0', 'oneShot 1'])
  expect(layerCandidates(context('encoder', { layerCount: 1 }))).toEqual(['toggle 0', 'to 0', 'oneShot 0'])
})

test('本体が対応していない方式を、候補から外せる', () => {
  expect(layerCandidates(context('tap', { layerCount: 2, layerModes: ['momentary', 'toggle'] }))).toEqual(['toggle 0', 'toggle 1'])
  expect(layerCandidates(context('hold', { layerCount: 2, layerModes: ['toggle', 'to'] }))).toEqual([])
  expect(layerCandidates(context('tap', { layerCount: 2, layerModes: [] }))).toEqual([])
})

// ---- 検索 ----

const found = (query: string, c: PickerContext = context('tap'), legend: 'us' | 'jis' = 'us') =>
  searchActions(query, c, legend).map(({ action }) => labelOf(action, legend).full)

test('名前で検索できる。ちょうど合うものを先に出す', () => {
  expect(found('a')[0]).toBe('A')
  expect(found('enter').slice(0, 2)).toEqual(['Enter', 'テンキー Enter'])
  expect(found('f1')).toEqual(['F1', 'F10', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19'])
  expect(found('音量')).toEqual(['音量を下げる', '音量を上げる'])
  expect(found('')).toEqual([])
  expect(found('   ')).toEqual([])
  expect(found('そんな動作はない')).toEqual([])
})

test('全角と半角、大文字と小文字、空白の有無を区別しない', () => {
  expect(found('ＣＴＲＬ')).toEqual(['左 Ctrl', '右 Ctrl'])
  expect(found('左ctrl')).toEqual(['左 Ctrl'])
  expect(found('BACKSPACE')).toEqual(['Backspace'])
  expect(found('レイヤー1に移動')).toEqual(['レイヤー 1 に移動'])
})

test('別名と、Shift で出る記号でも探せる', () => {
  expect(found('エンター')).toEqual(['Enter'])
  expect(found('command')).toEqual(['左 GUI（Cmd / Win）', '右 GUI（Cmd / Win）'])
  expect(found('ミュート')).toEqual(['消音'])
  expect(found('!')).toEqual(['!（Shift + 1）'])
  // 刻印が JIS なら、JIS で出る字で探す
  expect(found('"', context('tap'), 'jis')).toEqual(['"（Shift + 2）'])
  expect(found('@', context('tap'), 'jis')[0]).toBe('@')
})

test('検索は、レイヤー切り替えを含む全部の分類から、その欄に入れられる動作だけを探す', () => {
  const tap = context('tap', { layerCount: 2 })
  const hold = context('hold', { layerCount: 2 })
  expect(found('レイヤー', tap)).toEqual([
    '押すたびにレイヤー 0 をオン・オフ',
    '押すたびにレイヤー 1 をオン・オフ',
    'レイヤー 0 に移動',
    'レイヤー 1 に移動',
    '次の1キーだけレイヤー 0',
    '次の1キーだけレイヤー 1',
  ])
  expect(found('レイヤー', hold)).toEqual(['押している間だけレイヤー 0', '押している間だけレイヤー 1'])
  expect(found('押している間', tap)).toEqual([])
  expect(searchActions('消音', hold).map((candidate) => candidate.category)).toEqual(['other'])
})
