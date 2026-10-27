import { expect, test } from 'vitest'
import type { KeyboardSnapshot, WriteOperation } from '../device/types.ts'
import { cornixSnapshot } from '../device/fake/cornix.ts'
import type { Action } from './action.ts'
import { decodeKey, tapDanceIndexOf } from './decode.ts'
import { listChanges, rewritesUsedTapDance, writeOperations, type ChangeInput } from './diff.ts'
import { EMPTY_EDITS, type Edits } from './edits.ts'
import { applyEdits, planKeyEdits } from './encode.ts'
import { customKeycodesOf, keycodeToAction } from './keycodes.ts'

const key = (code: number): Action => ({ kind: 'key', code, mods: [] })
const A = key(0x04)
const B = key(0x05)
const C = key(0x06)
const ESC = key(0x29)
const L_CTRL: Action = { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] }

// 実機の設定（src/device/fixtures/cornix/usb.json）: レイヤー 0 の 8 番（行 1 列 1）は A。
// Tap Dance は 2 枠だけ使っている。0 番（タップ Space、長押し 左 GUI）を 4 つのキーが共有し、1 番（タップ B、長押し 右 GUI）は 1 つのキーが使う
const SHARED = [
  { layer: 0, key: 26 },
  { layer: 1, key: 26 },
  { layer: 1, key: 54 },
  { layer: 2, key: 26 },
]
const ALONE = { layer: 0, key: 54 }

const edits = (partial: Partial<Edits>): Edits => ({ ...EMPTY_EDITS, ...partial })

/** 基準と出発点が同じ（.vil などを読み込んでいない）時の、変更点の一覧を作る元 */
const fromDevice = (snapshot: KeyboardSnapshot, partial: Partial<Edits>): ChangeInput => ({
  baseline: snapshot,
  source: snapshot,
  edits: edits(partial),
})

/** 書き込む目標 */
function targetOf(source: KeyboardSnapshot, partial: Partial<Edits>): KeyboardSnapshot {
  const target = structuredClone(source)
  applyEdits(target, edits(partial))
  return target
}

/** 操作1つを、本体の設定に当てはめる */
function apply(snapshot: KeyboardSnapshot, operation: WriteOperation): void {
  switch (operation.type) {
    case 'setKey':
      snapshot.keymap[operation.layer][operation.key] = operation.keycode
      break
    case 'setEncoder':
      snapshot.encoders[operation.layer][operation.encoder][operation.direction === 'left' ? 0 : 1] = operation.keycode
      break
    case 'setTapDance':
      snapshot.tapDances[operation.index] = { ...operation.entry }
      break
    case 'setCombo':
      snapshot.combos[operation.index] = { keys: [...operation.entry.keys], output: operation.entry.output }
      break
  }
}

/** 操作を、最初から1つずつ当てはめていった時の、途中の状態すべて（最初の状態と、最後の状態を含む） */
function steps(source: KeyboardSnapshot, operations: readonly WriteOperation[]): KeyboardSnapshot[] {
  const states = [structuredClone(source)]
  for (const operation of operations) {
    const next = structuredClone(states.at(-1)!)
    apply(next, operation)
    states.push(next)
  }
  return states
}

/** キー、エンコーダー、コンボの動作を、場所ごとに、比べられる文字列にしたもの */
function behaviors(snapshot: KeyboardSnapshot): string[] {
  const custom = customKeycodesOf(snapshot.layout)
  const name = (keycode: number) => JSON.stringify(decodeKey(keycode, snapshot.tapDances, custom))
  return [
    ...snapshot.keymap.flat().map(name),
    ...snapshot.encoders.flat(2).map((keycode) => JSON.stringify(keycodeToAction(keycode, custom))),
    ...snapshot.combos.map((combo) => `${combo.keys.map(name).join('+')}→${name(combo.output)}`),
  ]
}

/** いくつもの種類の編集を、まとめて入れたもの。新しく枠を使うキー、枠を空けるキー、エンコーダー、コンボを含む */
const MIXED: Partial<Edits> = {
  keys: [
    { layer: 0, key: 8, behavior: { tap: A, doubleTap: B } },
    { layer: 3, key: 9, behavior: { tap: C, hold: L_CTRL, tapHold: ESC } },
    { ...ALONE, behavior: { tap: B } },
    { layer: 1, key: 10, behavior: { tap: ESC } },
  ],
  encoders: [{ layer: 0, encoder: 0, direction: 'right', action: A }],
  combos: [{ ref: { added: 0 }, combo: { keys: [0x04, 0x05], output: ESC } }],
}

// ---- 変更点の一覧 ----

test('編集がなければ、変更点も、機器に送る操作も空', () => {
  const snapshot = cornixSnapshot()
  expect(listChanges(fromDevice(snapshot, {}))).toEqual([])
  expect(writeOperations(snapshot, targetOf(snapshot, {}))).toEqual([])
  expect(writeOperations(snapshot, cornixSnapshot())).toEqual([])
  expect(rewritesUsedTapDance(snapshot, snapshot)).toBe(false)
})

test('キーの変更は、場所と、変える前後の動作を、日本語で出す', () => {
  const snapshot = cornixSnapshot()
  expect(listChanges(fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: { tap: B } }] }))).toEqual([
    {
      id: 'key-0-8',
      undo: { kind: 'edit', place: { kind: 'key', layer: 0, key: 8 } },
      lines: [{ where: 'レイヤー 0 ・ 行 1 列 1', before: 'A', after: 'B' }],
      notes: [],
    },
  ])
  // 欄が複数あるキーは、欄の名前を付けて出す。MT で書ける内容は、枠を使わない
  const [mt] = listChanges(fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: { tap: A, hold: L_CTRL } }] }))
  expect(mt.lines).toEqual([{ where: 'レイヤー 0 ・ 行 1 列 1', before: 'A', after: 'タップ: A ／ 長押し: 左 Ctrl' }])
  expect(mt.notes).toEqual([])
  // 欄をすべて消したキーと、透過のキー
  const [none] = listChanges(fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: { tap: { kind: 'none' } } }] }))
  expect(none.lines[0].after).toBe('何もしない')
  const [through] = listChanges(fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: { tap: { kind: 'transparent' } } }] }))
  expect(through.lines[0].after).toBe('透過')
})

test('Tap Dance の枠を新しく使う変更と、枠が空く変更は、番号を見せずに、その行に添える', () => {
  const snapshot = cornixSnapshot()
  const [uses] = listChanges(fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: { tap: A, doubleTap: B } }] }))
  expect(uses.lines).toEqual([{ where: 'レイヤー 0 ・ 行 1 列 1', before: 'A', after: 'タップ: A ／ 2回タップ: B' }])
  expect(uses.notes).toEqual(['本体の Tap Dance の枠を 1つ使います。'])

  // 1つのキーだけが使っていた枠は、そのキーを変えると空く
  const [frees] = listChanges(fromDevice(snapshot, { keys: [{ ...ALONE, behavior: { tap: B } }] }))
  expect(frees.lines).toEqual([{ where: 'レイヤー 0 ・ 行 7 列 5', before: 'タップ: B ／ 長押し: 右 GUI（Cmd / Win）', after: 'B' }])
  expect(frees.notes).toEqual(['使っていた Tap Dance の枠が 1つ空きます。'])

  // ほかのキーも使っている枠は、空かない。同じ内容の枠が本体にあれば、その枠を共有するので、新しくは使わない
  const [stays] = listChanges(fromDevice(snapshot, { keys: [{ ...SHARED[0], behavior: { tap: B } }] }))
  expect(stays.notes).toEqual([])
  const [shares] = listChanges(
    fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: decodeKey(0x5701, snapshot.tapDances) }] }),
  )
  expect(shares.notes).toEqual([])

  // 一覧のどこにも、Tap Dance の番号と、本体のキーコードは出ない
  const text = JSON.stringify(listChanges(fromDevice(snapshot, MIXED)).map(({ title, lines, notes }) => ({ title, lines, notes })))
  expect(text).not.toMatch(/Tap Dance \d|TD\(|0x/)
})

test('連動して変えたキーの組は、まとめて1行にし、キーごとの前後を持つ', () => {
  const snapshot = cornixSnapshot()
  const behavior = { tap: A, doubleTap: B }
  const changes = listChanges(
    fromDevice(snapshot, {
      keys: [
        // 編集した順は、一覧の並びに関わらない
        ...[...SHARED].reverse().map((place) => ({ ...place, behavior, link: 0 })),
        { layer: 0, key: 8, behavior: { tap: B } },
      ],
    }),
  )
  expect(changes.map((change) => change.id)).toEqual(['key-0-8', 'key-0-26'])
  const [, group] = changes
  expect(group.title).toBe('連動して変えたキー（4 つ）')
  expect(group.undo).toEqual({ kind: 'edit', place: { kind: 'key', ...SHARED[0] } })
  expect(group.lines.map((line) => line.where)).toEqual([
    'レイヤー 0 ・ 行 3 列 5',
    'レイヤー 1 ・ 行 3 列 5',
    'レイヤー 1 ・ 行 7 列 5',
    'レイヤー 2 ・ 行 3 列 5',
  ])
  for (const line of group.lines) {
    expect(line.before).toBe('タップ: Space ／ 長押し: 左 GUI（Cmd / Win）')
    expect(line.after).toBe('タップ: A ／ 2回タップ: B')
  }
  // 内容が替わるので、空いている枠へ移り、元の枠は空く
  expect(group.notes).toEqual(['本体の Tap Dance の枠を 1つ使います。', '使っていた Tap Dance の枠が 1つ空きます。'])
})

test('エンコーダーの変更は、回す向きごとに1行', () => {
  const snapshot = cornixSnapshot()
  const changes = listChanges(
    fromDevice(snapshot, {
      encoders: [
        { layer: 1, encoder: 0, direction: 'right', action: B },
        { layer: 0, encoder: 1, direction: 'left', action: { kind: 'none' } },
        { layer: 1, encoder: 0, direction: 'left', action: A },
      ],
    }),
  )
  expect(changes.map((change) => [change.lines[0].where, change.lines[0].after])).toEqual([
    ['レイヤー 0 ・ エンコーダー 2 の左回し', '何もしない'],
    ['レイヤー 1 ・ エンコーダー 1 の左回し', 'A'],
    ['レイヤー 1 ・ エンコーダー 1 の右回し', 'B'],
  ])
  expect(changes[1].undo).toEqual({ kind: 'edit', place: { kind: 'encoder', layer: 1, encoder: 0, direction: 'left' } })
  expect(changes[1].lines[0].before).not.toBe('A')
})

test('コンボの追加・変更・削除は、同時に押すキーと、出す動作で出す', () => {
  const snapshot = cornixSnapshot()
  snapshot.combos[0] = { keys: [0x04, 0x05, 0, 0], output: 0x29 }
  snapshot.combos[1] = { keys: [0x5700, 0x06, 0, 0], output: 0x04 }
  const changes = listChanges(
    fromDevice(snapshot, {
      combos: [
        { ref: { added: 0 }, combo: { keys: [0x05, 0x06], output: A } },
        { ref: { slot: 1 }, combo: null },
        { ref: { slot: 0 }, combo: { keys: [0x04, 0x06], output: ESC } },
      ],
    }),
  )
  expect(changes.map(({ id, lines }) => [id, ...lines])).toEqual([
    ['combo-slot-0', { where: 'コンボ（変更）', before: '「A」と「B」を同時に押す → Escape', after: '「A」と「C」を同時に押す → Escape' }],
    [
      'combo-slot-1',
      {
        where: 'コンボ（削除）',
        before: '「タップ: Space ／ 長押し: 左 GUI（Cmd / Win）」と「C」を同時に押す → A',
        after: '（なし）',
      },
    ],
    ['combo-added-0', { where: 'コンボ（追加）', before: '（なし）', after: '「B」と「C」を同時に押す → A' }],
  ])
  expect(changes[2].undo).toEqual({ kind: 'edit', place: { kind: 'combo', ref: { added: 0 } } })
  // コンボが指していた枠は、ほかのキーも使っているので、空かない
  expect(changes.flatMap((change) => change.notes)).toEqual([])
})

test('この画面で編集して Tap Dance になるキーを使うコンボは、その中身で出し、枠を使うことを添える', () => {
  const snapshot = cornixSnapshot()
  const fields = { onTap: 0x04, onHold: 0, onDoubleTap: 0x05, onTapHold: 0 }
  const [change] = listChanges(
    fromDevice(snapshot, { combos: [{ ref: { added: 0 }, combo: { keys: [{ tapDance: fields }, 0x06], output: ESC } }] }),
  )
  expect(change.lines[0].after).toBe('「タップ: A ／ 2回タップ: B」と「C」を同時に押す → Escape')
  expect(change.notes).toEqual(['本体の Tap Dance の枠を 1つ使います。'])
})

test('使われていない枠を上書きする変更は、消える内容を出す', () => {
  const snapshot = cornixSnapshot()
  // 空いている枠をなくす。2 番から後ろは、中身はあるが、どこからも使われていない枠（Vial で作りかけの枠）
  snapshot.tapDances = snapshot.tapDances.map((entry, slot) => (slot < 2 ? entry : { ...entry, onTap: 0x04 + slot, onHold: 0xe0 }))
  const [change] = listChanges(
    fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: { tap: A, doubleTap: B } }], overwriteUnusedTapDances: true }),
  )
  expect(change.notes).toEqual([
    'どこからも使われていなかった Tap Dance の枠を上書きします。その枠の内容（タップ: C ／ 長押し: 左 Ctrl）は消えます。',
  ])
})

test('目標に入らない編集も行として出し、書き込めない理由を添える', () => {
  const snapshot = cornixSnapshot()
  snapshot.tapDances = snapshot.tapDances.slice(0, 2)
  snapshot.combos = snapshot.combos.slice(0, 1)
  snapshot.combos[0] = { keys: [0x04, 0x05, 0, 0], output: 0x29 }
  const changes = listChanges(
    fromDevice(snapshot, {
      keys: [{ layer: 0, key: 8, behavior: { tap: A, doubleTap: B } }],
      encoders: [{ layer: 0, encoder: 0, direction: 'left', action: { kind: 'layer', mode: 'momentary', layer: 1 } }],
      combos: [{ ref: { added: 0 }, combo: { keys: [0x05, 0x06], output: A } }],
    }),
  )
  expect(changes.map(({ lines, notes }) => [lines[0].after, notes])).toEqual([
    ['タップ: A ／ 2回タップ: B', ['Tap Dance の枠が足りないので、この変更は書き込めません。']],
    ['押している間だけレイヤー 1', ['この動作は、本体の設定に直せないので、書き込めません。']],
    ['「B」と「C」を同時に押す → A', ['コンボの枠が足りないので、この変更は書き込めません。']],
  ])
})

test('刻印を JIS にすると、名前も JIS で出す', () => {
  const snapshot = cornixSnapshot()
  const input = fromDevice(snapshot, { keys: [{ layer: 0, key: 8, behavior: { tap: key(0x2f) } }] })
  expect(listChanges(input, 'us')[0].lines[0].after).toBe('[')
  expect(listChanges(input, 'jis')[0].lines[0].after).toBe('@')
})

test('出発点を入れ替えた時は、編集していない場所の違いを、まとめて1行にする', () => {
  const baseline = cornixSnapshot()
  const source = cornixSnapshot()
  source.keymap[0][8] = 0x05
  source.keymap[0][9] = 0x06
  source.encoders[0][0][0] = 0x04
  source.combos[3] = { keys: [0x04, 0x05, 0, 0], output: 0x29 }
  // 動作は同じで、持ち方だけが違うキー（MT で入っていたものが、同じ内容の Tap Dance になる）
  baseline.keymap[4][8] = 0x2104
  source.keymap[4][8] = 0x5702
  source.tapDances[2] = { ...source.tapDances[2], onTap: 0x04, onHold: 0xe0 }
  // どこからも使われていない枠の中身と、時間の値
  source.tapDances[5] = { ...source.tapDances[5], onTap: 0x07 }
  source.tapDances[6] = { ...source.tapDances[6], tappingTerm: 180 }

  const changes = listChanges({ baseline, source, edits: edits({ keys: [{ layer: 0, key: 9, behavior: { tap: ESC } }] }) })
  expect(changes.map((change) => change.id)).toEqual(['source', 'key-0-9'])
  const [loaded, edited] = changes
  expect(loaded.undo).toEqual({ kind: 'source' })
  expect(loaded.title).toBe('読み込んだ設定（.vil、バックアップ）')
  expect(loaded.lines).toEqual([
    { where: 'レイヤー 0 ・ 行 1 列 1', before: 'A', after: 'B' },
    { where: 'レイヤー 0 ・ エンコーダー 1 の左回し', before: 'マウスのホイールを上へ', after: 'A' },
    { where: 'コンボ（追加）', before: '（なし）', after: '「A」と「B」を同時に押す → Escape' },
  ])
  expect(loaded.notes).toEqual([
    '動作は同じで、本体の中での持ち方だけが変わるキーが 1つあります。',
    '本体の Tap Dance の枠を 1つ使います。',
    'このほかに、Tap Dance の枠 1つの内容が変わります。',
    'Tap Dance の枠 1つで、長押しと判定するまでの時間が変わります。',
  ])
  // 編集した場所は、編集の行に出す。前は、読み込んだ設定ではなく、いまの本体の内容
  expect(edited.lines).toEqual([{ where: 'レイヤー 0 ・ 行 1 列 2', before: 'S', after: 'Escape' }])

  // 編集で、いまの本体と同じ内容にした場所は、そう添える（取り消すと、読み込んだ設定の内容になる）
  const [, same] = listChanges({ baseline, source, edits: edits({ keys: [{ layer: 0, key: 8, behavior: { tap: A } }] }) })
  expect(same.lines).toEqual([{ where: 'レイヤー 0 ・ 行 1 列 1', before: 'A', after: 'A' }])
  expect(same.notes).toEqual(['いまの本体と同じ内容です（読み込んだ設定とは違います）。'])

  // 読み込んだ設定が、動作としては同じでも、取り消しの単位として1行を出す
  const copy = cornixSnapshot()
  expect(listChanges({ baseline: copy, source: cornixSnapshot(), edits: EMPTY_EDITS })).toEqual([
    { id: 'source', undo: { kind: 'source' }, title: '読み込んだ設定（.vil、バックアップ）', lines: [], notes: [] },
  ])
})

// ---- 機器に送る操作 ----

test('機器に送る操作は、違う所だけを書く。出発点に順に当てはめると、目標と一致する', () => {
  const source = cornixSnapshot()
  const target = targetOf(source, MIXED)
  const operations = writeOperations(source, target)
  const counts = Object.fromEntries(
    (['setTapDance', 'setKey', 'setEncoder', 'setCombo'] as const).map((type) => [type, operations.filter((op) => op.type === type).length]),
  )
  // 新しく使う枠が 2 つ、空にする枠が 1 つ。キーは編集した 4 つ
  expect(counts).toEqual({ setTapDance: 3, setKey: 4, setEncoder: 1, setCombo: 1 })
  expect(steps(source, operations).at(-1)).toEqual(target)
  // 同じ計算で、目標から出発点へも戻せる（書き込み前の状態に戻す）
  expect(steps(target, writeOperations(target, source)).at(-1)).toEqual(source)
  // 書き終えた後は、送るものがない
  expect(writeOperations(target, target)).toEqual([])
})

test('操作の順: 新しく使う Tap Dance の枠 → キーマップ・エンコーダー・コンボ → 残りの Tap Dance の枠', () => {
  const source = cornixSnapshot()
  const operations = writeOperations(source, targetOf(source, MIXED))
  expect(operations.map((operation) => operation.type)).toEqual([
    'setTapDance',
    'setTapDance',
    'setKey',
    'setKey',
    'setKey',
    'setKey',
    'setEncoder',
    'setCombo',
    'setTapDance',
  ])
  const tapDances = operations.flatMap((operation) => (operation.type === 'setTapDance' ? [operation] : []))
  // 先に書くのは、本体でいまどこからも指されていない枠。後に書くのは、指されていた枠（空にする）
  expect(tapDances.map((operation) => operation.index)).toEqual([2, 3, 1])
  expect(tapDances[2].entry).toEqual({ onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 250 })
  expect(rewritesUsedTapDance(source, targetOf(source, MIXED))).toBe(false)
})

test('途中のどこで止まっても、キーは、変える前か後の動作のどちらかで、触っていないキーが指す枠の中身は変わらない', () => {
  const source = cornixSnapshot()
  // 共有していたキーを連動して変える編集も足す（元の枠は、キーマップを書いた後に空にする）
  const mixed = {
    ...MIXED,
    keys: [...MIXED.keys!, ...SHARED.map((place) => ({ ...place, behavior: { tap: ESC, tapHold: A }, link: 0 }))],
  }
  const target = targetOf(source, mixed)
  const operations = writeOperations(source, target)
  const [before, after] = [behaviors(source), behaviors(target)]
  const untouched = source.keymap.flatMap((keys, layer) =>
    keys.flatMap((keycode, index) => {
      const slot = tapDanceIndexOf(keycode)
      return slot !== undefined && target.keymap[layer][index] === keycode ? [slot] : []
    }),
  )
  const states = steps(source, operations)
  expect(states.length).toBeGreaterThan(10)
  for (const state of states) {
    behaviors(state).forEach((behavior, place) => expect([before[place], after[place]]).toContain(behavior))
    for (const slot of untouched) expect(state.tapDances[slot]).toEqual(source.tapDances[slot])
  }

  // 触っていないキーが残っている枠（共有のうち1つだけを変えた時）は、書かない
  const one = writeOperations(source, targetOf(source, { keys: [{ ...SHARED[0], behavior: { tap: B } }] }))
  expect(one).toEqual([{ type: 'setKey', ...SHARED[0], keycode: 0x05 }])
})

test('空いている枠がなく、使用中の枠の中身を書き換えるしかない時は、そう分かる。触っていないキーは、その時も変わらない', () => {
  const source = cornixSnapshot()
  source.tapDances = source.tapDances.slice(0, 2)
  // 枠を1つだけで使っていたキーを、別の内容の Tap Dance にする。空いた枠を、そのまま使う
  const target = targetOf(source, { keys: [{ ...ALONE, behavior: { tap: A, doubleTap: B } }] })
  const operations = writeOperations(source, target)
  expect(operations).toEqual([
    { type: 'setTapDance', index: 1, entry: { onTap: 0x04, onHold: 0, onDoubleTap: 0x05, onTapHold: 0, tappingTerm: 250 } },
  ])
  expect(rewritesUsedTapDance(source, target)).toBe(true)
  const [before, last] = [behaviors(source), steps(source, operations).at(-1)!]
  expect(last).toEqual(target)
  const place = ALONE.layer * source.keymap[0].length + ALONE.key
  behaviors(last).forEach((behavior, index) => expect(behavior === before[index]).toBe(index !== place))
})

test('機器に送る操作は、編集の順番によらない', () => {
  const source = cornixSnapshot()
  const reversed = { ...MIXED, keys: [...MIXED.keys!].reverse() }
  expect(writeOperations(source, targetOf(source, reversed))).toEqual(writeOperations(source, targetOf(source, MIXED)))
  expect(planKeyEdits(source, edits(reversed)).missing).toBe(0)
})
