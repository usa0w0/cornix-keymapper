import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import { LAYER_MODES, type Action } from '../model/action.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { countEdits, editEncoder, editKey, loadSnapshot, tryEditKey, type EditState } from '../session/editState.ts'
import { AppHeader } from './AppHeader.tsx'
import { editSlotCounts } from './deviceInfo.ts'
import { KeyEditor } from './KeyEditor.tsx'
import { KeymapView } from './KeymapView.tsx'
import { behaviorView, type KeyView } from './keyView.ts'
import { SlotShortageDialog } from './SlotShortageDialog.tsx'
import { shortageList } from './slotShortage.ts'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const ESC: Action = { kind: 'key', code: 0x29, mods: [] }
const CTRL: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] }
const A_ESC: KeyBehavior = { tap: A, doubleTap: ESC }

const count = (html: string, needle: string) => html.split(needle).length - 1

const editor = (behavior: KeyBehavior, options: { changed?: boolean; view?: KeyView } = {}) =>
  renderToStaticMarkup(
    <KeyEditor
      layer={2}
      place={{ row: 3, col: 5 }}
      behavior={behavior}
      view={options.view ?? behaviorView(behavior, 'us')}
      changed={options.changed ?? false}
      legend="us"
      layerCount={10}
      layerModes={LAYER_MODES}
      onChange={() => {}}
      onRevert={() => {}}
    />,
  )

/** 空いている枠がない設定。枠 2〜31 に別々の中身を入れ、レイヤー 9 のキーから1つずつ指す */
function full(alter: (snapshot: KeyboardSnapshot) => void = () => {}): KeyboardSnapshot {
  const snapshot = cornixSnapshot()
  for (let slot = 2; slot < 32; slot++) {
    snapshot.tapDances[slot] = { onTap: 0x04 + slot, onHold: 0, onDoubleTap: 0x2c, onTapHold: 0, tappingTerm: 250 }
    snapshot.keymap[9][slot] = 0x5700 + slot
  }
  alter(snapshot)
  return snapshot
}

test('編集欄: 選んだキーの見た目・場所・4つの欄を出す。中身のある欄にだけ、枠の中に「×」を出す', () => {
  const html = editor({ tap: A, hold: CTRL })
  expect(html).toContain('<h2>レイヤー 2 ・ 行 3 列 5 のキー</h2>')
  expect(html).toContain('<span class="key state-normal"><span class="face-main"><b class="">A</b></span>')
  for (const name of ['タップ', '長押し', '2回タップ', 'タップ後長押し']) {
    expect(html).toContain(`<span class="field-name">${name}</span>`)
  }
  // 最初は、タップの欄が選ばれている。「×」は、欄の枠（field-box）の中の右端
  expect(html).toContain(
    '<div class="field-box active"><button type="button" class="field-value" aria-pressed="true" aria-label="タップ: A">A</button><button type="button" class="field-clear" aria-label="タップを消す" title="この欄を消す">×</button></div>',
  )
  expect(html).toContain('aria-label="長押し: 左 Ctrl">左 Ctrl</button><button type="button" class="field-clear" aria-label="長押しを消す"')
  expect(html).toContain(
    '<div class="field-box unset"><button type="button" class="field-value" aria-pressed="false" aria-label="2回タップ: （なし）">（なし）</button></div>',
  )
  expect(count(html, 'class="field-clear"')).toBe(2)
  // 下に、選ばれている欄の、動作を選ぶ部品。いま入っている動作を選択中として見せる
  expect(html).toContain('「タップ」に入れる動作')
  expect(html).toMatch(/class="board-key"[^>]*aria-pressed="true" aria-label="A"/)
  // 変えていないキーには、取り消しを出さない。透過のスイッチは、欄がすべて空の時だけ
  expect(html).not.toContain('変更を取り消す')
  expect(html).not.toContain('role="switch"')
})

test('編集欄: 変更したキーには、変更ありの印と「変更を取り消す」を出す', () => {
  const html = editor({ tap: A }, { changed: true })
  expect(html).toContain('<span class="key state-normal changed"><span class="mark-changed" title="変更あり"></span>')
  expect(html).toContain('変更を取り消す</button>')
})

test('編集欄: 4つとも空のキーは、欄をすべて「（なし）」にして、何も起きない旨と、オフの「透過」のスイッチを出す', () => {
  const html = editor({ tap: { kind: 'none' } })
  expect(count(html, '（なし）</button>')).toBe(4)
  expect(html).not.toContain('field-clear')
  expect(html).toContain('role="switch" class="switch" aria-checked="false"')
  expect(html).toContain('欄がすべて空なので、このキーは押しても何も起きません。')
})

test('編集欄: 透過のキーは、オンのスイッチと、下のレイヤーで効く動作を出す。欄はすべて「（なし）」', () => {
  const view: KeyView = {
    ...behaviorView({ tap: { kind: 'transparent' } }, 'us'),
    inherited: { layer: 0, ...behaviorView({ tap: A, hold: CTRL }, 'us') },
  }
  const html = editor({ tap: { kind: 'transparent' } }, { view })
  expect(html).toContain('role="switch" class="switch" aria-checked="true"')
  expect(html).toContain('下のレイヤーの動作（レイヤー 0 の「タップ: A ／ 長押し: 左 Ctrl」）がそのまま効きます。')
  expect(count(html, '（なし）</button>')).toBe(4)
  expect(editor({ tap: { kind: 'transparent' } })).toContain('下のレイヤーに、効く動作がありません。')
})

test('編集欄: 編集不可のキーは、その旨と元の内容を出す。欄は消せないが、動作を選んで上書きはできる', () => {
  const html = editor({ tap: { kind: 'unsupported', raw: 0x7e00, label: 'BT0' } })
  expect(html).toContain('このキーの動作は、このサイトでは編集できません。')
  expect(html).toContain('別の動作で上書きすることはできます')
  expect(html).toContain('aria-label="タップ: BT0">BT0</button>')
  expect(html).not.toContain('field-clear')
  expect(html).not.toContain('role="switch"')
  expect(html).toContain('「タップ」に入れる動作')
})

const turnEditor = (action: Action, changed = false) =>
  renderToStaticMarkup(
    <KeyEditor
      layer={1}
      place={{ encoder: 0, direction: 'left' }}
      behavior={{ tap: action }}
      view={behaviorView({ tap: action }, 'us')}
      changed={changed}
      legend="us"
      layerCount={10}
      layerModes={LAYER_MODES}
      onChange={() => {}}
      onRevert={() => {}}
    />,
  )

test('編集欄: エンコーダーは、欄が1つ（回した時）。動作を選ぶ部品には、エンコーダーに入れられる動作だけを出す', () => {
  const html = turnEditor({ kind: 'key', code: 0xaa, mods: [] }, true)
  expect(html).toContain('<h2>レイヤー 1 ・ エンコーダー 1 の左回し</h2>')
  expect(html).toContain('<div class="fields fields-one">')
  expect(count(html, 'class="field-name"')).toBe(1)
  expect(html).toContain('<span class="field-name">回した時</span>')
  expect(html).toContain('aria-label="回した時: 音量を下げる">音量を下げる</button><button type="button" class="field-clear" aria-label="回した時を消す"')
  expect(html).toContain('「回した時」に入れる動作')
  expect(html).toContain('変更を取り消す</button>')
  for (const name of ['タップ', '長押し', '2回タップ', 'タップ後長押し']) expect(html).not.toContain(`>${name}<`)
  // 「押している間だけレイヤー N」は、エンコーダーには入れられない
  expect(html).not.toContain('押している間だけ')
})

test('編集欄: 欄が空のエンコーダーは、回しても何も起きない旨を出す。「透過」のスイッチは出さない', () => {
  const html = turnEditor({ kind: 'none' })
  expect(count(html, '（なし）</button>')).toBe(1)
  expect(html).not.toContain('field-clear')
  expect(html).not.toContain('role="switch"')
  expect(html).toContain('欄が空なので、この向きに回しても何も起きません。')
})

test('編集欄: 本体から読んだ値が透過のエンコーダーは、透過である旨を出す。スイッチは出さず、動作を選んで上書きはできる', () => {
  const html = turnEditor({ kind: 'transparent' })
  expect(html).toContain('<span class="key state-transparent">')
  expect(html).toContain('透過です。下のレイヤーに、効く動作がありません。')
  expect(html).not.toContain('role="switch"')
  expect(count(html, '（なし）</button>')).toBe(1)
  expect(html).toContain('「回した時」に入れる動作')
})

test('編集欄: 本体から読んだエンコーダーが Tap Dance などを指している時は、編集不可として出す。動作を選んで上書きはできる', () => {
  const html = turnEditor({ kind: 'unsupported', raw: 0x5703, label: 'Tap Dance 3' })
  expect(html).toContain('<span class="key state-locked">')
  expect(html).toContain('このエンコーダーの動作は、このサイトでは編集できません。')
  expect(html).toContain('別の動作で上書きすることはできます')
  expect(html).toContain('aria-label="回した時: Tap Dance 3">Tap Dance 3</button>')
  expect(html).not.toContain('field-clear')
  expect(html).toContain('「回した時」に入れる動作')
})

test('キーボード図: 編集したエンコーダーに、編集した後の内容と変更ありの印を出す。件数にも数える', () => {
  const loaded = loadSnapshot(cornixSnapshot())
  const state = editEncoder(editEncoder(loaded, 0, 0, 'left', { kind: 'key', code: 0xa9, mods: [] }), 0, 1, 'right', { kind: 'none' })
  const html = renderToStaticMarkup(<KeymapView state={state} onAction={() => {}} />)
  const figure = html.slice(html.indexOf('class="figure"'), html.indexOf('class="edit"'))
  expect(figure).toContain('<button type="button" class="key state-normal encoder encoder-left changed"')
  expect(figure).toContain('aria-label="エンコーダー 1 の左回し: 音量を上げる（変更あり）"')
  expect(figure).toContain('<button type="button" class="key state-none encoder encoder-right changed"')
  expect(figure).toContain('aria-label="エンコーダー 2 の右回し: 何もしない（変更あり）"')
  expect(count(figure, 'mark-changed')).toBe(2)
  // 変えていない方向は、そのまま
  expect(figure).toContain('aria-label="エンコーダー 1 の右回し: マウスのホイールを下へ"')
  expect(countEdits(state)).toBe(2)
})

test('キーボード図: 編集したキーに、編集した後の内容と変更ありの印を出す', () => {
  const state = editKey(loadSnapshot(cornixSnapshot()), 0, 1, { tap: A, hold: CTRL })
  const html = renderToStaticMarkup(<KeymapView state={state} onAction={() => {}} />)
  const figure = html.slice(html.indexOf('class="figure"'), html.indexOf('class="edit"'))
  expect(figure).toContain('<button type="button" class="key state-normal changed"')
  expect(figure).toContain('aria-label="行 0・列 1 のキー: タップ: A ／ 長押し: 左 Ctrl（変更あり）"')
  expect(figure).toContain(
    '<span class="mark-changed" title="変更あり"></span><span class="face-main"><b class="">A</b></span><span class="face-extra"><i>長押し</i>Ctrl</span>',
  )
  expect(count(figure, 'mark-changed')).toBe(1)
  // 凡例に、変更ありと選択中の見本がある
  expect(html).toContain('<span class="key state-normal changed">')
  expect(html).toContain('<span class="key state-normal selected">')
})

test('ヘッダーの Tap Dance の残り枠数は、編集に合わせて増減する', () => {
  let state: EditState = loadSnapshot(cornixSnapshot())
  expect(editSlotCounts(state)).toEqual({ tapDance: { total: 32, free: 30 }, combo: { total: 32, free: 32 } })
  state = editKey(state, 0, 1, A_ESC)
  expect(editSlotCounts(state).tapDance).toEqual({ total: 32, free: 29 })
  state = editKey(state, 0, 54, { tap: A })
  expect(editSlotCounts(state).tapDance).toEqual({ total: 32, free: 30 })
  const html = renderToStaticMarkup(
    <AppHeader
      connection={{ status: 'disconnected' }}
      supported
      slots={editSlotCounts(state)}
      changes={2}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onDeviceInfo={null}
    />,
  )
  expect(html).toContain('Tap Dance 残り <b>30</b> / 32')
})

test('枠が足りない時の一覧: 枠を使っているキーを、枠ごとに、場所と動作で出す。番号は出さない', () => {
  const state = loadSnapshot(full())
  const list = shortageList(state, 'us')
  expect(list.total).toBe(32)
  expect(list.unused).toBe(0)
  expect(list.rows).toHaveLength(32)
  expect(list.rows[0]).toEqual({
    slot: 0,
    name: 'タップ: Space ／ 長押し: 左 GUI（Cmd / Win）',
    keys: [
      { layer: 0, key: 26, place: 'レイヤー 0 ・ 行 3 列 5' },
      { layer: 1, key: 26, place: 'レイヤー 1 ・ 行 3 列 5' },
      { layer: 1, key: 54, place: 'レイヤー 1 ・ 行 7 列 5' },
      { layer: 2, key: 26, place: 'レイヤー 2 ・ 行 3 列 5' },
    ],
    others: 0,
  })
  expect(list.rows[1]).toMatchObject({ name: 'タップ: B ／ 長押し: 右 GUI（Cmd / Win）', keys: [{ layer: 0, key: 54 }] })

  const html = renderToStaticMarkup(
    <SlotShortageDialog list={list} attempted onJump={() => {}} onOverwrite={null} onClose={() => {}} />,
  )
  expect(html).toContain('この変更は、枠が足りないのでできません')
  expect(html).toContain('枠は 32 個あり、いまはすべて使われています。')
  expect(html).toContain('<button type="button">レイヤー 0 ・ 行 3 列 5</button>')
  expect(html).toContain('<span>タップ: Space ／ 長押し: 左 GUI（Cmd / Win）</span><span class="plain-list-note">（4 つのキーが同じ枠を共有）</span>')
  expect(count(html, '<li>')).toBe(32)
  expect(html).not.toContain('Tap Dance 0')
  expect(html).not.toContain('上書き')
  expect(html).toContain('<button type="button" class="primary">閉じる</button>')
})

test('枠が足りない時の一覧: 編集で枠を使うことにしたキーも出す。使われていない枠があれば、上書きして使うかを選ばせる', () => {
  // 枠 31 を、どのキーからも指さない。枠 1 を空けて、別のキーで使う
  const loaded = loadSnapshot(full((s) => (s.keymap[9][31] = 0)))
  const state = editKey(editKey(loaded, 0, 54, { tap: A }), 3, 8, A_ESC)
  const list = shortageList(state, 'us')
  expect(list.rows[1]).toMatchObject({ slot: 1, name: 'タップ: A ／ 2回タップ: Escape', keys: [{ layer: 3, key: 8, place: 'レイヤー 3 ・ 行 1 列 1' }] })
  expect(list.rows).toHaveLength(31)
  expect(list.unused).toBe(1)
  expect(tryEditKey(state, 0, 1, { tap: A, tapHold: ESC }).blocked).toMatchObject({ missing: 1, overwritable: 1 })

  const html = renderToStaticMarkup(
    <SlotShortageDialog list={list} attempted onJump={() => {}} onOverwrite={() => {}} onClose={() => {}} />,
  )
  expect(html).toContain('どのキーからも使われていない枠が 1 個あります')
  expect(html).toContain('この枠を上書きして使うと、この変更を行えます。')
  expect(html).toContain('<button type="button">使われていない枠を上書きして、変更する</button>')
})

test('読み直した後などで、いまの編集に枠が足りない時は、図の上に知らせる', () => {
  const state = { ...editKey(loadSnapshot(cornixSnapshot()), 0, 1, A_ESC), source: full() }
  const html = renderToStaticMarkup(<KeymapView state={state} onAction={() => {}} />)
  expect(html).toContain('いまの編集のうち 1 つのキーは、Tap Dance の枠が足りないので、本体に書き込めません。')
  expect(html).toContain('枠を使っているキーを見る</button>')
  expect(renderToStaticMarkup(<KeymapView state={loadSnapshot(full())} onAction={() => {}} />)).not.toContain('足りない')
})
