import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { LAYER_MODES, type Action, type ActionSlot, type PickerContext } from '../model/action.ts'
import { ActionPicker, KeyboardChoices, LayerChoices, OtherChoices, SearchResults, type ActionPickerProps } from './ActionPicker.tsx'

const count = (html: string, needle: string) => html.split(needle).length - 1
const ignore = () => {}

const context = (slot: ActionSlot, extra: Partial<PickerContext> = {}): PickerContext => ({
  slot,
  layerCount: 10,
  layerModes: LAYER_MODES,
  ...extra,
})

const picker = (props: Partial<ActionPickerProps> = {}) =>
  renderToStaticMarkup(
    <ActionPicker slot="tap" slotName="タップ" layerCount={10} layerModes={LAYER_MODES} legend="us" onPick={ignore} {...props} />,
  )

const choices = (slot: ActionSlot, current?: Action, extra: Partial<PickerContext> = {}) => ({
  context: context(slot, extra),
  legend: 'us' as const,
  current,
  onPick: ignore,
})

/** 選択中として見せているボタンの名前 */
const pressed = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(?:<small>[^<]*<\/small>)?([^<]*)</g)].map((m) => m[1])

test('見出し、検索の欄、3つの分類を出し、最初は「キーボード」を開く', () => {
  const html = picker()
  expect(html).toContain('<span class="picker-title">「タップ」に入れる動作</span>')
  expect(html).toContain('type="search"')
  const tabs = html.slice(html.indexOf('class="picker-tabs"'), html.indexOf('class="picker-row"'))
  expect([...tabs.matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1])).toEqual(['キーボード', 'レイヤー切り替え', 'メディア・その他'])
  expect(pressed(tabs)).toEqual(['キーボード'])
  expect(html).toContain('class="board"')
  // 「透過」と「何もしない」は、この部品の選択肢に入れない
  expect(html).not.toContain('透過')
  expect(html).not.toContain('何もしない')
})

test('いま入っている動作の分類を開き、ショートカットの修飾キーを選んだ状態で、そのキーを選択中として見せる', () => {
  // レイヤー切り替え
  const layer = picker({ current: { kind: 'layer', mode: 'oneShot', layer: 3 } })
  expect(pressed(layer)).toEqual(['レイヤー切り替え', '次の1キーだけ', 'レイヤー 3'])
  expect(pressed(picker({ slot: 'hold', slotName: '長押し', current: { kind: 'layer', mode: 'momentary', layer: 2 } }))).toEqual([
    'レイヤー切り替え',
    '押している間だけ',
    'レイヤー 2',
  ])
  // メディア・その他
  expect(pressed(picker({ current: { kind: 'key', code: 0xa9, mods: [] } }))).toEqual(['メディア・その他', '音量を上げる'])
  // ショートカットと、Shift で出る記号
  expect(pressed(picker({ current: { kind: 'key', code: 0x06, mods: [{ kind: 'ctrl', side: 'left' }] } }))).toEqual(['キーボード', 'Ctrl', 'C'])
  expect(pressed(picker({ current: { kind: 'key', code: 0x1e, mods: [{ kind: 'shift', side: 'left' }] } }))).toEqual(['キーボード', 'Shift', '!'])
  // 修飾キーだけの動作は、図の修飾キーそのものを選択中にし、「一緒に押す修飾キー」は選ばない
  const rightShift = picker({ slot: 'hold', slotName: '長押し', current: { kind: 'key', mods: [{ kind: 'shift', side: 'right' }] } })
  expect(pressed(rightShift)).toEqual(['キーボード', 'Shift'])
  expect(rightShift).toContain('aria-pressed="true" aria-label="右 Shift"')
  // 空の欄は「キーボード」で、何も選択中にしない
  expect(pressed(picker())).toEqual(['キーボード'])
})

test('キーボードの図: 「一緒に押す修飾キー」と、キー1つぶん 44px の並びを出す', () => {
  const html = renderToStaticMarkup(<KeyboardChoices {...choices('tap')} />)
  expect(html).toContain('<span>一緒に押す修飾キー</span>')
  for (const name of ['Ctrl', 'Shift', 'Alt', 'GUI']) expect(html).toContain(`<button type="button" aria-pressed="false">${name}</button>`)
  // 図のキーは 85 個（文字のかたまり 75 個と、Ins / Del などと矢印の 10 個）
  expect(count(html, 'class="board-key"')).toBe(85)
  expect(count(html, 'class="board-block"')).toBe(2)
  expect(html).toContain('<button type="button" class="board-key" style="width:40px" aria-pressed="false" aria-label="A" title="A">A</button>')
  expect(html).toContain('style="width:216px" aria-pressed="false" aria-label="Space"')
  // 数字と記号のキーは、Shift を押しながら打った時の字を左上に小さく出す
  expect(html).toContain('aria-label="1" title="1"><small>!</small>1</button>')
  expect(html).toContain('aria-label=";" title=";"><small>:</small>;</button>')
  // 修飾キーそのものは、左右を名前で見分けられる
  expect(html).toContain('aria-label="左 Shift" title="左 Shift">Shift</button>')
  expect(html).toContain('aria-label="右 GUI（Cmd / Win）" title="右 GUI（Cmd / Win）">GUI</button>')
})

test('キーボードの図: Shift を選んでいる時は、Shift で出る記号を出す', () => {
  const html = renderToStaticMarkup(<KeyboardChoices {...choices('tap')} together={['shift']} />)
  expect(html).toContain('<button type="button" aria-pressed="true">Shift</button>')
  expect(html).toContain('aria-label="!（Shift + 1）" title="!（Shift + 1）">!</button>')
  expect(html).toContain('aria-label="Shift + A" title="Shift + A">A</button>')
  expect(html).not.toContain('<small>')
  // 修飾キーそのものは、単体のまま
  expect(html).toContain('aria-label="左 Ctrl" title="左 Ctrl">Ctrl</button>')
})

test('キーボードの図: いま入っている動作のキーを、選択中として見せる', () => {
  const copy: Action = { kind: 'key', code: 0x06, mods: [{ kind: 'ctrl', side: 'left' }] }
  expect(pressed(renderToStaticMarkup(<KeyboardChoices {...choices('tap', { kind: 'key', code: 0x1e, mods: [] })} />))).toEqual(['1'])
  // ショートカットは、同じ修飾キーを選んでいる時にだけ当たる
  expect(pressed(renderToStaticMarkup(<KeyboardChoices {...choices('tap', copy)} />))).toEqual([])
  expect(pressed(renderToStaticMarkup(<KeyboardChoices {...choices('tap', copy)} together={['ctrl']} />))).toEqual(['Ctrl', 'C'])
  // 修飾キーだけの動作は、左右を区別する
  const rightAlt: Action = { kind: 'key', mods: [{ kind: 'alt', side: 'right' }] }
  const html = renderToStaticMarkup(<KeyboardChoices {...choices('hold', rightAlt)} />)
  expect(count(html, 'aria-pressed="true"')).toBe(1)
  expect(html).toContain('aria-pressed="true" aria-label="右 Alt"')
})

test('レイヤー切り替え: タップの欄には「押している間だけ」以外の3つと、本体にあるレイヤーだけを出す', () => {
  const html = renderToStaticMarkup(<LayerChoices {...choices('tap', undefined, { layerCount: 4 })} />)
  expect(html).not.toContain('押している間だけ')
  for (const name of ['押すたびにオン・オフ', 'そのレイヤーに移動', '次の1キーだけ']) expect(html).toContain(`>${name}</button>`)
  expect(pressed(html)).toEqual(['押すたびにオン・オフ'])
  expect([...html.matchAll(/>(レイヤー \d+)<\/button>/g)].map((m) => m[1])).toEqual(['レイヤー 0', 'レイヤー 1', 'レイヤー 2', 'レイヤー 3'])
  expect(html).toContain('aria-label="押すたびにレイヤー 1 をオン・オフ"')
})

test('レイヤー切り替え: 長押しの欄とタップ後長押しの欄には「押している間だけ」だけを出す', () => {
  for (const slot of ['hold', 'tapHold'] as const) {
    const html = renderToStaticMarkup(<LayerChoices {...choices(slot)} />)
    expect(pressed(html)).toEqual(['押している間だけ'])
    for (const name of ['押すたびにオン・オフ', 'そのレイヤーに移動', '次の1キーだけ']) expect(html).not.toContain(name)
    expect(html).toContain('aria-label="押している間だけレイヤー 9"')
    expect(html).not.toContain('レイヤー 10')
  }
})

test('レイヤー切り替え: いま入っている切り替え方から始め、その切り替え先を選択中として見せる', () => {
  const html = renderToStaticMarkup(<LayerChoices {...choices('tap', { kind: 'layer', mode: 'oneShot', layer: 1 })} />)
  expect(pressed(html)).toEqual(['次の1キーだけ', 'レイヤー 1'])
  // 欄を変えて、その切り替え方が入れられなくなった時は、入れられるものにする
  const moved = renderToStaticMarkup(<LayerChoices {...choices('hold', { kind: 'layer', mode: 'oneShot', layer: 1 })} />)
  expect(pressed(moved)).toEqual(['押している間だけ'])
})

test('レイヤー切り替え: 使えない方式は出さず、1つも入れられない時はその旨を出す', () => {
  const html = renderToStaticMarkup(<LayerChoices {...choices('tap', undefined, { layerModes: ['momentary', 'to'] })} />)
  expect([...html.matchAll(/aria-pressed="(?:true|false)">([^<]+)<\/button>/g)].map((m) => m[1])).toEqual(['そのレイヤーに移動'])
  const none = renderToStaticMarkup(<LayerChoices {...choices('hold', undefined, { layerModes: ['toggle', 'to', 'oneShot'] })} />)
  expect(none).toBe('<p class="picker-empty">この欄に入れられるレイヤー切り替えは、ありません。</p>')
})

test('メディア・その他: 図にないキーを、日本語の名前で出す', () => {
  const html = renderToStaticMarkup(<OtherChoices {...choices('tap', { kind: 'key', code: 0xa8, mods: [] })} />)
  for (const name of ['音量を上げる', '再生 / 一時停止', 'マウスのホイールを上へ', 'マウスの左ボタン', 'テンキー 1', 'F13', 'Print Screen']) {
    expect(html).toContain(`>${name}</button>`)
  }
  expect(pressed(html)).toEqual(['消音'])
  // 図にあるキーと、選択肢に出さない印を付けたキーは出さない
  expect(html).not.toContain('>Enter</button>')
  expect(html).not.toContain('電卓')
  expect(html).not.toContain('レイヤー')
})

test('検索: 全部の分類から探し、その欄に入れられる動作だけを出す', () => {
  const names = (query: string, slot: ActionSlot, extra: Partial<PickerContext> = {}) =>
    [...renderToStaticMarkup(<SearchResults query={query} {...choices(slot, undefined, extra)} />).matchAll(/>([^<]+)<\/button>/g)].map(
      (m) => m[1],
    )
  // キーボード、メディア・その他、レイヤー切り替えのどれも当たる
  expect(names('enter', 'tap')).toEqual(['Enter', 'テンキー Enter'])
  expect(names('音量', 'tap')).toEqual(['音量を下げる', '音量を上げる'])
  expect(names('!', 'tap')).toEqual(['!（Shift + 1）'])
  expect(names('レイヤー 1', 'tap')).toEqual(['押すたびにレイヤー 1 をオン・オフ', 'レイヤー 1 に移動', '次の1キーだけレイヤー 1'])
  expect(names('レイヤー 1', 'hold')).toEqual(['押している間だけレイヤー 1'])
  // 存在しないレイヤーと、使えない方式は当たらない
  expect(names('レイヤー 5', 'hold', { layerCount: 4 })).toEqual([])
  expect(names('次の1キー', 'tap', { layerModes: ['toggle'] })).toEqual([])
  // 「透過」と「何もしない」は、どの欄でも当たらない
  expect(names('透過', 'tap')).toEqual([])
  expect(names('何もしない', 'tap')).toEqual([])
})

test('検索: 当たるものがない時は、その旨を出す', () => {
  const html = renderToStaticMarkup(<SearchResults query="zzzz" {...choices('tap')} />)
  expect(html).toBe('<div class="chips"><span class="picker-empty">見つかりません。</span></div>')
})
