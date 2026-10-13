import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import type { Action } from '../model/action.ts'
import { customKeycodesOf } from '../model/keycodes.ts'
import { addCombo, comboKeyAt, comboList, editCombo, editKey, loadSnapshot, planKeys, type EditState } from '../session/editState.ts'
import { AppHeader } from './AppHeader.tsx'
import { ComboView } from './ComboView.tsx'
import {
  blockedReason,
  comboKeyName,
  comboOrderAt,
  draftContent,
  isLockedOutput,
  missingComboKeys,
  toggleComboKey,
  type ComboDraft,
} from './comboView.ts'
import { editSlotCounts } from './deviceInfo.ts'
import { KeymapView } from './KeymapView.tsx'

// 実機の設定のレイヤー 0: Q が キー 1、W が キー 2、B が キー 19 と 41、キー 26 は Tap Dance（Space、長押しで左 GUI）。
// レイヤー 1 には、Q も W も B もない
const Q = 0x14
const W = 0x1a
const B = 0x05
const ESC: Action = { kind: 'key', code: 0x29, mods: [] }
const A: Action = { kind: 'key', code: 0x04, mods: [] }

/** 実機の設定には、コンボが1つもないので、足して使う */
function withCombos(alter: (snapshot: KeyboardSnapshot) => void = () => {}): EditState {
  const snapshot = cornixSnapshot()
  snapshot.combos[0] = { keys: [Q, W, 0, 0], output: 0x29 }
  snapshot.combos[2] = { keys: [B, 0x5700, 0, 0], output: 0x0106 }
  alter(snapshot)
  return loadSnapshot(snapshot)
}

const count = (html: string, needle: string) => html.split(needle).length - 1
const render = (state: EditState, props: { layer?: number; draft?: ComboDraft; shown?: Parameters<typeof ComboView>[0]['initialShown'] } = {}) =>
  renderToStaticMarkup(
    <ComboView
      state={state}
      onAction={() => {}}
      shown={{ layer: props.layer ?? 0, legend: 'us', setLayer: () => {}, setLegend: () => {} }}
      initialDraft={props.draft}
      initialShown={props.shown}
    />,
  )
const figureOf = (html: string) => html.slice(html.indexOf('class="figure"'), html.indexOf('class="edit"'))

test('コンボがない時: 図と、空の一覧と、「コンボを追加」を出す。図のキーは押せない', () => {
  const html = render(loadSnapshot(cornixSnapshot()))
  expect(html).toContain('<section class="keymap combo" aria-label="コンボ">')
  // レイヤーの行と刻印の切り替えは、キーマップのタブと同じ
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>0<\/button>/)
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>US<\/button>/)
  expect(count(figureOf(html), 'role="img"')).toBe(54)
  expect(figureOf(html)).not.toContain('<button')
  expect(html).toContain('<h2>コンボ（複数のキーを同時に押した時の動作）</h2>')
  expect(html).toContain('どのレイヤーでも、同じ中身のキーを同時に押せば働きます。')
  expect(html).toContain('<button type="button" class="primary">コンボを追加</button>')
  expect(html).toContain('まだコンボはありません。')
  expect(figureOf(html)).not.toContain('in-combo')
})

test('本体に入っているコンボを、最初から一覧に出す。レイヤーは出さない', () => {
  const html = render(withCombos())
  const list = html.slice(html.indexOf('class="combo-list"'), html.indexOf('class="legend"'))
  expect(count(list, '<li')).toBe(2)
  expect(list).toContain(
    '<span class="combo-chip" title="Q"><b>1</b>Q</span><span class="combo-chip" title="W"><b>2</b>W</span>' +
      '<span class="combo-arrow">→</span><strong>Escape</strong>',
  )
  // 長押しなどを設定したキーは、いちばん上の欄と「ほか」。番号（Tap Dance 0）は出さない
  expect(list).toContain('<span class="combo-chip" title="タップ: Space ／ 長押し: 左 GUI（Cmd / Win）"><b>2</b>Space ほか</span>')
  expect(list).toContain('<strong>Ctrl + C</strong>')
  expect(list).not.toContain('Tap Dance')
  expect(list).not.toContain('レイヤー')
  expect(count(list, '>変更</button>')).toBe(2)
  expect(count(list, '>削除</button>')).toBe(2)
  // 行を押すまでは、図に何も示さない
  expect(figureOf(html)).not.toContain('in-combo')
})

test('一覧の行を選ぶと、いま開いているレイヤーで当たるキーを、図に緑で示す。同じ中身のキーが複数あれば、すべて', () => {
  const html = render(withCombos(), { shown: { slot: 2 } })
  const figure = figureOf(html)
  // B は、レイヤー 0 に2つある。どちらも 1 番、Tap Dance のキーが 2 番
  expect(count(figure, 'in-combo')).toBe(3)
  expect(figure).toContain('aria-label="行 2・列 5 のキー: B（コンボの 1 つ目のキー）"')
  expect(figure).toContain('aria-label="行 5・列 6 のキー: B（コンボの 1 つ目のキー）"')
  expect(figure).toContain('aria-label="行 3・列 5 のキー: タップ: Space ／ 長押し: 左 GUI（Cmd / Win）（コンボの 2 つ目のキー）"')
  expect(count(figure, '<span class="mark-combo">1</span>')).toBe(2)
  expect(count(figure, '<span class="mark-combo">2</span>')).toBe(1)
  expect(html).toMatch(/<li class="shown"><button type="button" class="combo-row" aria-pressed="true"/)
  expect(html).not.toContain('働きません')
})

test('当たるキーがないレイヤーでは、「このレイヤーでは働きません」と、足りないキーを添えて出す', () => {
  // レイヤー 1 には、B がない。Tap Dance のキー（枠 0）はある
  const html = render(withCombos(), { layer: 1, shown: { slot: 2 } })
  expect(html).toContain('<span class="combo-missing">レイヤー 1 には「B」のキーがないので、このレイヤーでは働きません</span>')
  expect(count(figureOf(html), 'in-combo')).toBe(2)
  const none = render(withCombos(), { layer: 1, shown: { slot: 0 } })
  expect(none).toContain('レイヤー 1 には「Q」「W」のキーがないので、このレイヤーでは働きません')
  expect(figureOf(none)).not.toContain('in-combo')
})

test('追加中: 図のキーを押して選ぶ。空のキー、透過のキー、エンコーダーは押せない。選んだキーに、押した順の番号を出す', () => {
  const state = withCombos((s) => (s.keymap[0][3] = 0x0001))
  const html = render(state, { draft: { ref: null, keys: [W, Q] } })
  const figure = figureOf(html)
  expect(count(figure, '<button type="button" class="key')).toBe(54)
  // 空のキー（キーのない場所は図に出ない）、透過にしたキー 3、エンコーダー 4 つ
  expect(figure).toMatch(/class="key state-transparent"[^>]*aria-pressed="false"[^>]*disabled=""/)
  expect(count(figure, 'disabled=""')).toBe(5)
  expect(figure).toContain('aria-label="行 0・列 2 のキー: W（コンボの 1 つ目のキー）"')
  expect(figure).toContain('aria-label="行 0・列 1 のキー: Q（コンボの 2 つ目のキー）"')
  expect(html).toContain('<h2>コンボを追加</h2>')
  expect(html).toContain('<span class="combo-chip" title="W"><b>1</b>W<button type="button" aria-label="W を外す">×</button></span>')
  // 出す動作を選ぶまでは、追加できない
  expect(html).toContain('<button type="button" class="primary" disabled="">追加する</button>')
  expect(html).toContain('（下から選ぶ）')
  expect(html).toContain('「出す動作」に入れる動作')
  // コンボの出力には、「押している間だけレイヤー N」を入れられない
  expect(html.slice(html.indexOf('class="picker"'))).not.toContain('押している間だけ')
})

test('追加中: キーを 4 個選んだ後は、選んであるキーだけを押せる（外せる）。2 個以上と出す動作がそろえば、追加できる', () => {
  const four = render(withCombos(), { draft: { ref: null, keys: [Q, W, 0x08, 0x15], output: ESC } })
  const figure = figureOf(four)
  expect(count(figure, 'in-combo')).toBe(4)
  expect(count(figure, 'disabled=""')).toBe(54 - 4)
  expect(four).toContain('<button type="button" class="primary">追加する</button>')
  expect(four).toContain('<span class="field-value">Escape</span>')
  const one = render(withCombos(), { draft: { ref: null, keys: [Q], output: ESC } })
  expect(one).toContain('<button type="button" class="primary" disabled="">追加する</button>')
})

test('変更中: 見出しとボタンが「変更」になる。このサイトで選べない出力は、内容を保ったまま、上書きできると知らせる', () => {
  const state = withCombos((s) => (s.combos[5] = { keys: [Q, 0x08, 0, 0], output: 0x5703 }))
  const list = render(state)
  expect(list).toContain('<strong>Tap Dance 3</strong>')
  expect(list).toContain('🔒 このサイトでは編集不可')
  const item = comboList(state).find((entry) => 'slot' in entry.ref && entry.ref.slot === 5)!
  expect(isLockedOutput(item.combo.output)).toBe(true)
  const html = render(state, { draft: { ref: item.ref, ...item.combo } })
  expect(html).toContain('<section class="edit" aria-label="コンボの変更">')
  expect(html).toContain('<h2>コンボを変更</h2>')
  expect(html).toContain('<span class="field-value">Tap Dance 3</span>')
  expect(html).toContain('いまの出す動作は、このサイトでは選べない動作です。')
  // そのままでも、同時に押すキーだけを変えて保存できる
  expect(html).toContain('<button type="button" class="primary">変更する</button>')
})

test('コンボの枠が残っていない時は、追加できず、理由を出す', () => {
  const state = withCombos((s) => {
    s.combos = s.combos.map((_, slot) => ({ keys: [0x04, 0x05 + slot, 0, 0], output: 0x29 }))
  })
  const html = render(state)
  expect(html).toContain('<button type="button" class="primary" disabled="">コンボを追加</button>')
  expect(html).toContain('コンボの枠（32 個）をすべて使っているので、追加できません。追加するには、下の一覧のどれかを削除してください。')
  // 1つ消すと、追加できる
  const freed = render(editCombo(state, { slot: 0 }, null))
  expect(freed).toContain('<button type="button" class="primary">コンボを追加</button>')
  expect(freed).not.toContain('追加できません')
  expect(blockedReason({ missingCombos: 1, missing: 0 }, 32)).toContain('コンボの枠が足りません')
  expect(blockedReason({ missingCombos: 0, missing: 1 }, 32)).toContain('Tap Dance の枠が足りない')
})

test('ヘッダーのコンボの残り枠数は、編集に合わせて増減する。足したコンボと変えたコンボには、変更ありと出す', () => {
  let state = withCombos()
  expect(editSlotCounts(state).combo).toEqual({ total: 32, free: 30 })
  state = addCombo(state, { keys: [Q, 0x08], output: A })
  expect(editSlotCounts(state).combo).toEqual({ total: 32, free: 29 })
  state = editCombo(state, { slot: 0 }, null)
  expect(editSlotCounts(state).combo).toEqual({ total: 32, free: 30 })
  const header = renderToStaticMarkup(
    <AppHeader
      connection={{ status: 'disconnected' }}
      supported
      slots={editSlotCounts(state)}
      changes={2}
      onWrite={() => {}}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onDeviceInfo={null}
    />,
  )
  expect(header).toContain('コンボ 残り <b>30</b> / 32')
  const html = render(state)
  expect(count(html, '<li')).toBe(2 + 10)
  expect(count(html, 'class="combo-changed"')).toBe(1)
})

test('キーの名前と、レイヤーでの当たり方は、編集を当てはめた後のキーコードで決める', () => {
  let state = withCombos()
  const custom = customKeycodesOf(state.source.layout)
  // キー 3 を、Tap Dance になる動作に変えて、コンボのキーにする
  state = editKey(state, 0, 3, { tap: A, doubleTap: ESC })
  const pending = comboKeyAt(state, { layer: 0, key: 3 })!
  const plan = planKeys(state)
  expect(comboKeyName(pending, plan, custom, 'us')).toEqual({ short: 'A ほか', full: 'タップ: A ／ 2回タップ: Escape' })
  expect(comboKeyName(Q, plan, custom, 'us')).toEqual({ short: 'Q', full: 'Q' })
  expect(comboKeyName(0x5700, plan, custom, 'us').short).toBe('Space ほか')
  expect(comboOrderAt([Q, 0x5702], plan, 0, 3)).toBe(1)
  expect(comboOrderAt([Q, 0x5702], plan, 0, 1)).toBe(0)
  expect(comboOrderAt([Q, 0x5702], plan, 0, 2)).toBeUndefined()
  // 空のキーは、どのコンボにも当たらない
  expect(comboOrderAt([0, Q], plan, 0, 6)).toBeUndefined()
  expect(missingComboKeys([Q, 0x5702], plan, 0)).toEqual([])
  expect(missingComboKeys([Q, 0x5702, undefined], plan, 1)).toEqual([0, 1, 2])
  // 図でもう一度押すと外れる。同じ中身かは、キーコードで比べる（枠 2 を指すキーコードと、その中身は、同じキー）
  expect(toggleComboKey([Q], pending, plan)).toEqual([Q, pending])
  expect(toggleComboKey([Q, pending], 0x5702, plan)).toEqual([Q])
  expect(toggleComboKey([Q, W], Q, plan)).toEqual([W])
  expect(toggleComboKey([Q, W, 0x08, 0x15], B, plan)).toEqual([Q, W, 0x08, 0x15])
  // 追加できる中身
  expect(draftContent({ ref: null, keys: [Q, W], output: ESC })).toEqual({ keys: [Q, W], output: ESC })
  expect(draftContent({ ref: null, keys: [Q, W] })).toBeUndefined()
  expect(draftContent({ ref: null, keys: [Q], output: ESC })).toBeUndefined()
  expect(draftContent({ ref: null, keys: [Q, W], output: { kind: 'none' } })).toBeUndefined()
})

test('キーマップのタブ: コンボの色や線は出さない。凡例に、コンボのキーの見本がある', () => {
  const html = renderToStaticMarkup(<KeymapView state={withCombos()} onAction={() => {}} />)
  expect(html.slice(html.indexOf('class="figure"'), html.indexOf('class="legend"'))).not.toContain('combo')
  expect(html).toContain('<span class="key state-normal in-combo"><span class="mark-combo">1</span>')
})
