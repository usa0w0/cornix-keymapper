import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import realVil from '../device/fixtures/cornix/cornix.vil?raw'
import type { Action } from '../model/action.ts'
import { listChanges } from '../model/diff.ts'
import { editKey, loadSnapshot, replaceSource, type EditState } from '../session/editState.ts'
import { vilToSnapshot, type VilExtras } from '../storage/vil.ts'
import { VilDialog } from './VilDialog.tsx'
import { extrasText, summarizeLoad, vilFailureText, vilFileName, type LoadSummary, type VilScene } from './vilFlow.ts'

const A: Action = { kind: 'key', code: 0x04, mods: [] }
const B: Action = { kind: 'key', code: 0x05, mods: [] }
const NO_EXTRAS: VilExtras = { macros: 0, keyOverrides: 0, altRepeatKeys: 0, settings: 0 }
const REAL_EXTRAS: VilExtras = { ...NO_EXTRAS, settings: 9 }

const dialog = (scene: VilScene, options: { changes?: number; summary?: LoadSummary; saveBlocked?: string | null } = {}) =>
  renderToStaticMarkup(
    <VilDialog
      scene={scene}
      changes={options.changes ?? 0}
      summary={options.summary ?? { places: null, hidden: false, edits: 0 }}
      saveBlocked={options.saveBlocked ?? null}
      onSave={() => {}}
      onReview={() => {}}
      onClose={() => {}}
    />,
  )

/** 実物の .vil の、キーを書き換えたもの。uid は精度が落ちるので、元の文字のまま差し込み直す */
function vilWith(change: (layout: (string | number)[][][]) => void): KeyboardSnapshot {
  const data = JSON.parse(realVil) as { uid: number; layout: (string | number)[][][] }
  data.uid = 0
  change(data.layout)
  const result = vilToSnapshot(JSON.stringify(data).replace('"uid":0', '"uid":17279655951921914625'), cornixSnapshot())
  if (!result.ok) throw new Error('読み込めない')
  return result.snapshot
}

/** .vil を読み込んだ後の、画面に出すまとめ */
const loaded = (state: EditState, snapshot: KeyboardSnapshot) => summarizeLoad(listChanges(replaceSource(state, snapshot)))

test('ファイル名は、利用者の時刻で作る', () => {
  expect(vilFileName(new Date(2026, 9, 13, 14, 32))).toBe('cornix-20261013-1432.vil')
  expect(vilFileName(new Date(2026, 0, 2, 3, 4))).toBe('cornix-20260102-0304.vil')
  expect(vilFileName(new Date(2026, 9, 12, 10, 32), 'backup')).toBe('cornix-backup-20261012-1032.vil')
})

test('保存の前の確認: ファイル名と、マクロなどが含まれない旨を出す', () => {
  const html = dialog({ scene: 'save', at: new Date(2026, 9, 13, 14, 32) })
  expect(html).toContain('<h2 id="vil-title">.vil ファイルに保存</h2>')
  expect(html).toContain('<p>この画面の内容を、Vial と同じ形式のファイルに保存します。</p>')
  expect(html).toContain('<p>ファイル名: cornix-20261013-1432.vil</p>')
  expect(html).toContain('マクロなどは、このファイルに含まれません（マクロ、Key Override、Alt Repeat Key、QMK Settings）。')
  expect(html).toContain('このファイルを Vial で本体に書き戻すと、それらは空になることがあります。')
  expect(html).toContain('<button type="button">やめる</button><button type="button" class="primary">保存する</button>')
})

test('保存の前の確認: まだ書き込んでいない変更がある時は、それも含めて保存することを出す', () => {
  const html = dialog({ scene: 'save', at: new Date(2026, 9, 13, 14, 32) }, { changes: 3 })
  expect(html).toContain('この画面の内容（まだ本体に書き込んでいない変更 3 件を含む）を、Vial と同じ形式のファイルに保存します。')
})

test('保存の前の確認: 目標を作れない時は、理由を出し、保存できなくする', () => {
  const html = dialog({ scene: 'save', at: new Date(2026, 9, 13, 14, 32) }, { changes: 1, saveBlocked: '書き込めない変更があるので、保存できません。' })
  expect(html).toContain('<p class="ng" role="alert">書き込めない変更があるので、保存できません。</p>')
  expect(html).toContain('<button type="button" class="primary" disabled="">保存する</button>')
})

test('読み込んだ後の知らせ: 本体にはまだ書き込んでいないこと、違う所の数、取り消し方、書き込まれない項目の数を出す', () => {
  const state = loadSnapshot(cornixSnapshot())
  const summary = loaded(
    state,
    vilWith((layout) => {
      layout[0][0][1] = 'KC_B'
      layout[1][0][1] = 'MO(3)'
      layout[2][1][1] = 'LSFT(KC_A)'
    }),
  )
  expect(summary).toEqual({ places: 3, hidden: false, edits: 0 })

  const html = dialog({ scene: 'loaded', name: 'cornix.vil', extras: REAL_EXTRAS, editsBefore: 0 }, { changes: 1, summary })
  expect(html).toContain('<h2 id="vil-title">cornix.vil を読み込みました</h2>')
  expect(html).toContain('<p>ファイルの内容を、この画面に入れました。本体には、まだ書き込んでいません。</p>')
  expect(html).toContain('<p>いまの本体と違う所は 3 か所です。変更点の一覧では、「読み込んだ設定」として、まとめて 1 件になります。</p>')
  expect(html).toContain('右上の「書き込み（変更 1 件）」で、変更点を確かめてから書き込んでください。')
  expect(html).toContain('読み込みをやめる時は、変更点の一覧で「読み込みを取り消す」を選びます。')
  expect(html).toContain('<p class="write-note">このファイルのマクロなど 9 件は、本体に書き込まれません（QMK Settings 9 件）。</p>')
  expect(html).toContain('<button type="button">変更点を確かめる</button><button type="button" class="primary">閉じる</button>')
  // 編集していなかった時は、編集のことを出さない
  expect(html).not.toContain('読み込む前に編集していた内容')
})

test('読み込んだ後の知らせ: 本体と同じ内容のファイルは、そう出す', () => {
  const state = loadSnapshot(cornixSnapshot())
  const summary = loaded(state, vilWith(() => {}))
  expect(summary).toEqual({ places: null, hidden: false, edits: 0 })

  const html = dialog({ scene: 'loaded', name: 'cornix.vil', extras: NO_EXTRAS, editsBefore: 0 }, { summary })
  expect(html).toContain('<p>ファイルの内容は、いまの本体と同じでした。このファイルから書き込むものは、ありません。</p>')
  expect(html).not.toContain('本体には、まだ書き込んでいません')
  expect(html).not.toContain('本体に書き込まれません')
  expect(html).not.toContain('変更点を確かめる')
})

test('読み込んだ後の知らせ: 編集は、読み込んだ設定の上に残る。読み込んだ設定と同じになった編集は、なくなる', () => {
  let state = loadSnapshot(cornixSnapshot())
  state = editKey(state, 0, 1, { tap: B })
  state = editKey(state, 0, 2, { tap: A })
  const before = summarizeLoad(listChanges(state))
  expect(before).toEqual({ places: null, hidden: false, edits: 2 })

  // 編集していない場所だけが違うファイル。編集は2つとも残る
  const kept = loaded(state, vilWith((layout) => (layout[3][0][1] = 'KC_B')))
  expect(kept).toEqual({ places: 1, hidden: false, edits: 2 })
  const keptHtml = dialog({ scene: 'loaded', name: 'a.vil', extras: NO_EXTRAS, editsBefore: 2 }, { changes: 3, summary: kept })
  expect(keptHtml).toContain('<p>読み込む前に編集していた内容（2 件）は、読み込んだ設定の上に、そのまま残しています。</p>')
  expect(keptHtml).toContain('右上の「書き込み（変更 3 件）」で')

  // 編集した場所の1つが、編集と同じ内容になっているファイル。その編集は、編集ではなくなる
  const partly = loaded(state, vilWith((layout) => (layout[0][0][1] = 'KC_B')))
  expect(partly).toEqual({ places: 1, hidden: false, edits: 1 })
  const partlyHtml = dialog({ scene: 'loaded', name: 'a.vil', extras: NO_EXTRAS, editsBefore: 2 }, { changes: 2, summary: partly })
  expect(partlyHtml).toContain(
    '読み込む前に編集していた内容（2 件）は、読み込んだ設定の上に残しています。そのうち 1 件は、読み込んだ設定と同じ内容だったので、編集ではなくなりました。',
  )
})

test('読み込めない時: 理由を出し、画面の内容を変えていないことを出す', () => {
  const html = dialog({ scene: 'failed', name: 'other.vil', failure: { reason: 'uid' } })
  expect(html).toContain('<h2 id="vil-title" class="ng">この .vil は読み込めません</h2>')
  expect(html).toContain('<p>other.vil: ファイルが、この画面に読み込んであるキーボードのものではありません（機器の識別が違います）。</p>')
  expect(html).toContain('画面の内容は変えていません。</p>')
  expect(html).toContain('<div class="dialog-actions"><button type="button" class="primary">閉じる</button></div>')
})

test('読み込めない理由の文', () => {
  const cause = (failure: Parameters<typeof vilFailureText>[0]) => vilFailureText(failure).cause
  expect(cause({ reason: 'not-json' })).toBe('ファイルの中身を読めませんでした（JSON の形になっていません）。')
  expect(cause({ reason: 'not-vil', what: 'layout' })).toBe('ファイルが、.vil の形をしていません（layout の形が違います）。')
  expect(cause({ reason: 'layers', actual: 8, expected: 10 })).toBe(
    'レイヤーの数が、このキーボードと合いません（ファイルは 8、このキーボードは 10）。',
  )
  expect(cause({ reason: 'rows', actual: 4, expected: 8 })).toContain('キーの数（行列の行の数）が、このキーボードと合いません')
  expect(cause({ reason: 'cols', actual: 6, expected: 7 })).toContain('キーの数（行列の列の数）が、このキーボードと合いません')
  expect(cause({ reason: 'encoders', actual: 0, expected: 2 })).toContain('エンコーダーの数が、このキーボードと合いません（ファイルは 0、このキーボードは 2）')
  expect(cause({ reason: 'tap-dance', actual: 8, expected: 32 })).toContain('Tap Dance の枠の数が、このキーボードと合いません')
  expect(cause({ reason: 'combo', actual: 8, expected: 32 })).toContain('コンボの枠の数が、このキーボードと合いません')
  expect(cause({ reason: 'missing-key', place: { kind: 'key', layer: 4, row: 1, col: 2 } })).toBe(
    'このキーボードにあるキー（レイヤー 4 ・ 行 1 列 2）が、ファイルでは「キーなし」になっています。',
  )
  expect(cause({ reason: 'unreadable' })).toBe('ファイルを開けませんでした。')
  expect(cause({ reason: 'too-large' })).toContain('ファイルが大きすぎます')
})

test('解釈できない名前は、名前と場所を並べる。多い時は、残りを数で出す', () => {
  const names = [
    { name: 'KC_UNKNOWN', place: { kind: 'key', layer: 1, row: 2, col: 3 } },
    { name: 'RGB_TOG', place: { kind: 'encoder', layer: 2, encoder: 1 } },
    { name: 'FOO(1)', place: { kind: 'tapDance', index: 7 } },
    { name: 'BAR', place: { kind: 'combo', index: 9 } },
  ] as const
  expect(vilFailureText({ reason: 'keycode', names: [...names] }).cause).toBe(
    'このサイトが解釈できないキーコードの名前があります: KC_UNKNOWN（レイヤー 1 ・ 行 2 列 3）、RGB_TOG（レイヤー 2 ・ エンコーダー 2）、FOO(1)（Tap Dance の 8 番目の枠）、BAR（コンボの 10 番目の枠）。',
  )
  const many = Array.from({ length: 8 }, (_, i) => ({ name: `X${i}`, place: { kind: 'key', layer: 0, row: 0, col: i } }) as const)
  expect(vilFailureText({ reason: 'keycode', names: many }).cause).toMatch(/X4（レイヤー 0 ・ 行 0 列 4）、ほか 3 種類。$/)
})

test('書き込まれない項目の数は、種類ごとの内訳を添える。なければ出さない', () => {
  expect(extrasText(NO_EXTRAS)).toBeNull()
  expect(extrasText(REAL_EXTRAS)).toBe('このファイルのマクロなど 9 件は、本体に書き込まれません（QMK Settings 9 件）。')
  expect(extrasText({ macros: 2, keyOverrides: 3, altRepeatKeys: 1, settings: 9 })).toBe(
    'このファイルのマクロなど 15 件は、本体に書き込まれません（マクロ 2 件、Key Override 3 件、Alt Repeat Key 1 件、QMK Settings 9 件）。',
  )
})
