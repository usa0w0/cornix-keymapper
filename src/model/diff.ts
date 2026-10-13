// 差分。2種類あり、別のものとして扱う（docs/design.md「書き込みの流れ」）。
// - 変更点の一覧: 基準と、書き込む目標を、それぞれキーの動作に直して比べ、日本語の言葉で前後を出す。利用者の確認に使う
// - 機器に送る操作: 目標と、本体の現在値を、本体の表現のまま比べる。KeyboardDevice.write に渡す
import type { ComboEntry, KeyboardSnapshot, TapDanceEntry, WriteOperation } from '../device/types.ts'
import { labelOf, type Action, type Legend } from './action.ts'
import { BEHAVIOR_SLOT_NAMES, filledSlots, type KeyBehavior } from './behavior.ts'
import { decodeKey, TAP_DANCE, tapDanceIndexOf } from './decode.ts'
import type { ComboEdit, ComboKey, EditPlace, Edits } from './edits.ts'
import {
  comboKeycode,
  isEmptyCombo,
  isEmptyEntry,
  planKeyEdits,
  pointedSlots,
  sameFields,
  type KeyEditPlan,
  type KeySettings,
} from './encode.ts'
import { customKeycodesOf, keycodeToAction, type CustomKeycode } from './keycodes.ts'
import { encoderName, placeName } from './layout.ts'

// ---- 変更点の一覧 ----

/** 取り消すもの。利用者の編集1回（その場所の編集）か、出発点の入れ替え（.vil やバックアップの読み込み） */
export type ChangeUndo = { kind: 'edit'; place: EditPlace } | { kind: 'source' }

/** 場所1つぶんの前後。before は本体のいまの内容（基準）、after は書き込む内容（目標） */
export interface ChangeLine {
  where: string
  before: string
  after: string
}

/**
 * 変更点の一覧の1行。取り消しの単位（利用者の編集1回）に対応する。
 * 連動して変えたキーの組と、出発点の入れ替えは、場所をいくつも持つ1行になる
 */
export interface Change {
  id: string
  undo: ChangeUndo
  /** 場所をいくつも持つ行の見出し（連動して変えたキーの組、読み込んだ設定）。場所が1つの行にはない */
  title?: string
  /** 場所ごとの前後。出発点の入れ替えで、動作が変わる場所がなければ、空 */
  lines: ChangeLine[]
  /**
   * キーの動作の言葉で表せない変更と、書き込めない理由。
   * その編集のために本体の中で起きること（Tap Dance の枠を使う、枠が空く、使われていない枠を上書きする、など）
   */
  notes: string[]
}

/** 変更点の一覧を作る元。編集中の状態（session/editState.ts の EditState）を、そのまま渡せる */
export interface ChangeInput {
  /** 基準: 本体から読んだもの */
  baseline: KeyboardSnapshot
  /** 出発点: 通常は基準と同じもの。.vil やバックアップを読み込むと入れ替わる */
  source: KeyboardSnapshot
  edits: Edits
}

const NOTHING = '（なし）'

/** キーの動作の名前。タップだけなら動作の名前、ほかの欄があれば「タップ: Space ／ 長押し: 左 GUI」の形 */
function behaviorName(behavior: KeyBehavior, legend: Legend): string {
  const filled = filledSlots(behavior)
  if (filled.length === 0) return '何もしない'
  if (filled.length === 1 && filled[0] === 'tap') return labelOf(behavior.tap!, legend).full
  return filled.map((slot) => `${BEHAVIOR_SLOT_NAMES[slot]}: ${labelOf(behavior[slot]!, legend).full}`).join(' ／ ')
}

/** 名前を作るのに使うもの。本体の設定（基準か目標）と、その独自のキー、刻印 */
interface Naming {
  tapDances: readonly TapDanceEntry[]
  custom: readonly CustomKeycode[]
  legend: Legend
}

const keyName = (keycode: number | undefined, { tapDances, custom, legend }: Naming) =>
  keycode === undefined ? NOTHING : behaviorName(decodeKey(keycode, tapDances, custom), legend)

const encoderActionName = (keycode: number | undefined, { custom, legend }: Naming) =>
  keycode === undefined ? NOTHING : labelOf(keycodeToAction(keycode, custom), legend).full

/** コンボの名前。「「A」と「B」を同時に押す → Escape」の形。同時に押すキーは、キーの中身（4欄）で出す */
function comboName(keys: readonly ComboKey[], output: Action, naming: Naming): string {
  const names = keys.map((key) => {
    const behavior =
      typeof key === 'number'
        ? decodeKey(key, naming.tapDances, naming.custom)
        : decodeKey(TAP_DANCE.from, [{ ...key.tapDance, tappingTerm: 0 }], naming.custom)
    return `「${behaviorName(behavior, naming.legend)}」`
  })
  return `${names.join('と')}を同時に押す → ${labelOf(output, naming.legend).full}`
}

const comboEntryName = (entry: ComboEntry | undefined, naming: Naming) =>
  !entry || isEmptyCombo(entry)
    ? NOTHING
    : comboName(
        entry.keys.filter((key) => key !== 0),
        keycodeToAction(entry.output, naming.custom),
        naming,
      )

/** キーコードの並びが指している、Tap Dance の枠の番号 */
const slotsOf = (keycodes: readonly (number | undefined)[]) =>
  new Set(keycodes.flatMap((keycode) => (keycode === undefined ? [] : (tapDanceIndexOf(keycode) ?? []))))

const comboCodes = (entry: ComboEntry | undefined) => (entry ? [...entry.keys, entry.output] : [])

const countOf = (count: number) => (count === 1 ? '1つ' : `${count} つ`)

/** 作りかけの1行。前後の本体のキーコードを集めて、最後に、本体の中で起きることを notes に足す */
interface Draft extends Change {
  before: (number | undefined)[]
  after: (number | undefined)[]
}

/**
 * 変更点の一覧。基準と、書き込む目標（出発点に編集を当てはめたもの）を、場所ごとにキーの動作に直して比べる。
 *
 * - 1行は、取り消しの単位（利用者の編集1回）。キー、エンコーダーの1方向、コンボが1行ずつ。
 *   連動して変えたキーの組は、まとめて1行。出発点の入れ替えは、全体で1行（編集していない場所の違いを、すべて持つ）。
 *   行数は、編集の数（session/editState.ts の countEdits）と同じになる
 * - 並びは、出発点の入れ替え、キー（レイヤー、キーの番号の順）、エンコーダー、コンボ（枠の番号順、足した順）
 * - 利用者には、Tap Dance とコンボの枠の番号を見せない。その編集のために本体の中で起きることは、
 *   別の行にせず、その行の notes に添える（取り消しの単位と、件数をそろえるため）
 * - 目標を作れない編集（Tap Dance の枠が足りない、など）も、行として出し、書き込めない理由を notes に入れる
 */
export function listChanges(
  input: ChangeInput,
  legend: Legend = 'us',
  plan: KeyEditPlan = planKeyEdits(input.source, input.edits),
): Change[] {
  const { baseline, source, edits } = input
  const replaced = source !== baseline
  const { cols } = source.layout
  const before: Naming = { tapDances: baseline.tapDances, custom: customKeycodesOf(baseline.layout), legend }
  const after: Naming = { tapDances: plan.tapDances, custom: customKeycodesOf(source.layout), legend }
  const keyWhere = (layer: number, key: number) => placeName(layer, { row: Math.floor(key / cols), col: key % cols })
  const encoderWhere = (layer: number, encoder: number, direction: 'left' | 'right') =>
    `レイヤー ${layer} ・ ${encoderName({ encoder, direction })}`
  const draft = (id: string, undo: ChangeUndo): Draft => ({ id, undo, lines: [], notes: [], before: [], after: [] })

  // ---- キー。連動して変えたキーの組は、1行にまとめる ----
  const unplaced = new Set(plan.unplaced)
  const invalid = new Set(plan.invalid)
  const keyDrafts: Draft[] = []
  const linked = new Map<number, Draft>()
  for (const edit of [...edits.keys].sort((a, b) => a.layer - b.layer || a.key - b.key)) {
    const { layer, key } = edit
    let row = edit.link === undefined ? undefined : linked.get(edit.link)
    if (!row) {
      row = draft(`key-${layer}-${key}`, { kind: 'edit', place: { kind: 'key', layer, key } })
      keyDrafts.push(row)
      if (edit.link !== undefined) linked.set(edit.link, row)
    }
    const failed = unplaced.has(edit) || invalid.has(edit)
    const [from, to] = [baseline.keymap[layer]?.[key], plan.keymap[layer]?.[key]]
    row.lines.push({
      where: keyWhere(layer, key),
      before: keyName(from, before),
      // 目標に入らなかった編集は、目標ではなく、利用者が入れた動作を出す
      after: failed ? behaviorName(edit.behavior, legend) : keyName(to, after),
    })
    row.before.push(from)
    if (!failed) row.after.push(to)
    if (unplaced.has(edit)) addNote(row, 'Tap Dance の枠が足りないので、この変更は書き込めません。')
    if (invalid.has(edit)) addNote(row, 'この動作は、本体の設定に直せないので、書き込めません。')
  }
  for (const row of keyDrafts) {
    if (row.lines.length > 1) row.title = `連動して変えたキー（${row.lines.length} つ）`
  }

  // ---- エンコーダー ----
  const invalidEncoders = new Set(plan.invalidEncoders)
  const turn = (direction: 'left' | 'right') => (direction === 'left' ? 0 : 1)
  const encoderDrafts = [...edits.encoders]
    .sort((a, b) => a.layer - b.layer || a.encoder - b.encoder || turn(a.direction) - turn(b.direction))
    .map((edit) => {
      const { layer, encoder, direction } = edit
      const row = draft(`encoder-${layer}-${encoder}-${direction}`, {
        kind: 'edit',
        place: { kind: 'encoder', layer, encoder, direction },
      })
      const failed = invalidEncoders.has(edit)
      const from = baseline.encoders[layer]?.[encoder]?.[turn(direction)]
      const to = plan.encoders[layer]?.[encoder]?.[turn(direction)]
      row.lines.push({
        where: encoderWhere(layer, encoder, direction),
        before: encoderActionName(from, before),
        after: failed ? labelOf(edit.action, legend).full : encoderActionName(to, after),
      })
      row.before.push(from)
      if (failed) addNote(row, 'この動作は、本体の設定に直せないので、書き込めません。')
      else row.after.push(to)
      return row
    })

  // ---- コンボ。出発点にあるコンボ（枠の番号順）の後に、足したコンボ（足した順） ----
  const invalidCombos = new Set(plan.invalidCombos)
  const order = ({ ref }: ComboEdit) => ('slot' in ref ? ref.slot : source.combos.length + ref.added)
  const comboSlots = new Set<number>()
  const comboDrafts = [...edits.combos]
    .sort((a, b) => order(a) - order(b))
    .map((edit) => {
      const { ref, combo } = edit
      const row = draft('slot' in ref ? `combo-slot-${ref.slot}` : `combo-added-${ref.added}`, {
        kind: 'edit',
        place: { kind: 'combo', ref },
      })
      // 足したコンボの枠は、目標を作る時に決まっている。枠が足りなかったコンボには、ない
      const slot = 'slot' in ref ? ref.slot : plan.addedCombos.find((item) => item.added === ref.added)?.slot
      const shortOfTapDance = combo !== null && combo.keys.some((key) => comboKeycode(plan, key) === undefined)
      const failed = slot === undefined || invalidCombos.has(edit) || shortOfTapDance
      const from = slot === undefined ? undefined : baseline.combos[slot]
      const to = slot === undefined ? undefined : plan.combos[slot]
      const names = {
        before: comboEntryName(from, before),
        after: !failed ? comboEntryName(to, after) : combo ? comboName(combo.keys, combo.output, after) : NOTHING,
      }
      const kind = names.before === NOTHING ? '追加' : names.after === NOTHING ? '削除' : '変更'
      row.lines.push({ where: `コンボ（${kind}）`, ...names })
      row.before.push(...comboCodes(from))
      if (!failed) row.after.push(...comboCodes(to))
      if (slot !== undefined) comboSlots.add(slot)
      if (invalidCombos.has(edit)) addNote(row, 'このコンボは、本体の設定に直せないので、書き込めません。')
      else if (slot === undefined) addNote(row, 'コンボの枠が足りないので、この変更は書き込めません。')
      else if (shortOfTapDance) addNote(row, 'Tap Dance の枠が足りないので、この変更は書き込めません。')
      return row
    })

  // ---- 出発点の入れ替え。編集していない場所の、基準と目標の違いを、すべて持つ ----
  const sourceDraft = replaced ? draft('source', { kind: 'source' }) : null
  if (sourceDraft) {
    sourceDraft.title = '読み込んだ設定（.vil、バックアップ）'
    // 動作は同じで、本体のキーコードだけが違う場所の数（MT で書ける内容が、Tap Dance で入っている、など）
    let sameName = 0
    const compare = (where: string, from: number | undefined, to: number | undefined, nameOf: typeof keyName) => {
      if (from === to) return
      const line = { where, before: nameOf(from, before), after: nameOf(to, after) }
      if (line.before === line.after) sameName++
      else sourceDraft.lines.push(line)
      sourceDraft.before.push(from)
      sourceDraft.after.push(to)
    }
    const editedKeys = new Set(edits.keys.map(({ layer, key }) => `${layer}:${key}`))
    plan.keymap.forEach((keys, layer) =>
      keys.forEach((to, key) => {
        if (!editedKeys.has(`${layer}:${key}`)) compare(keyWhere(layer, key), baseline.keymap[layer]?.[key], to, keyName)
      }),
    )
    const editedEncoders = new Set(edits.encoders.map(({ layer, encoder, direction }) => `${layer}:${encoder}:${direction}`))
    plan.encoders.forEach((turns, layer) =>
      turns.forEach((pair, encoder) =>
        (['left', 'right'] as const).forEach((direction) => {
          if (editedEncoders.has(`${layer}:${encoder}:${direction}`)) return
          const from = baseline.encoders[layer]?.[encoder]?.[turn(direction)]
          compare(encoderWhere(layer, encoder, direction), from, pair[turn(direction)], encoderActionName)
        }),
      ),
    )
    let sameCombo = 0
    plan.combos.forEach((to, slot) => {
      const from = baseline.combos[slot]
      if (comboSlots.has(slot) || (from && from.output === to.output && from.keys.every((key, index) => key === to.keys[index]))) return
      const names = { before: comboEntryName(from, before), after: comboEntryName(to, after) }
      const kind = names.before === NOTHING ? '追加' : names.after === NOTHING ? '削除' : '変更'
      if (names.before === names.after) sameCombo++
      else sourceDraft.lines.push({ where: `コンボ（${kind}）`, ...names })
      sourceDraft.before.push(...comboCodes(from))
      sourceDraft.after.push(...comboCodes(to))
    })
    if (sameName > 0) addNote(sourceDraft, `動作は同じで、本体の中での持ち方だけが変わるキーが ${countOf(sameName)}あります。`)
    if (sameCombo > 0) addNote(sourceDraft, `内容は同じで、本体の中での持ち方だけが変わるコンボが ${countOf(sameCombo)}あります。`)
  }

  // ---- 本体の中で起きること（Tap Dance の枠）。番号は見せず、その枠を使う行・使っていた行に添える ----
  const drafts = [...(sourceDraft ? [sourceDraft] : []), ...keyDrafts, ...encoderDrafts, ...comboDrafts]
  const pointedBefore = pointedSlots(baseline)
  const pointedAfter = pointedSlots(plan)
  const explained = new Set<number>()
  const changedFields = (slot: number) => {
    const [from, to] = [baseline.tapDances[slot], plan.tapDances[slot]]
    return from !== undefined && to !== undefined && !sameFields(from, to)
  }
  for (const row of drafts) {
    const written = [...slotsOf(row.after)].filter(changedFields).sort((a, b) => a - b)
    // 中身はあるが、どこからも使われていなかった枠（Vial で作りかけの枠など）を上書きする時は、消える内容を出す
    const overwritten = written.filter((slot) => !isEmptyEntry(baseline.tapDances[slot]) && !pointedBefore.has(slot))
    const used = written.length - overwritten.length
    const freed = [...slotsOf(row.before)].filter(
      (slot) => changedFields(slot) && !pointedAfter.has(slot) && isEmptyEntry(plan.tapDances[slot]),
    )
    for (const slot of [...written, ...freed]) explained.add(slot)
    if (used > 0) addNote(row, `本体の Tap Dance の枠を ${countOf(used)}使います。`)
    for (const slot of overwritten) {
      const content = keyName(TAP_DANCE.from + slot, before)
      addNote(row, `どこからも使われていなかった Tap Dance の枠を上書きします。その枠の内容（${content}）は消えます。`)
    }
    if (freed.length > 0) addNote(row, `使っていた Tap Dance の枠が ${countOf(freed.length)}空きます。`)
    // 入れ替えた出発点の上で、いまの本体と同じ内容にした編集
    const same = replaced && row !== sourceDraft && row.lines.every((line) => line.before === line.after)
    if (same && row.notes.length === 0) addNote(row, 'いまの本体と同じ内容です（読み込んだ設定とは違います）。')
  }
  if (sourceDraft) {
    // どの場所からも説明が付かない枠の違い（どこからも使われていない枠の中身、時間の値）
    const slots = plan.tapDances.map((_, slot) => slot).filter((slot) => !explained.has(slot) && baseline.tapDances[slot])
    const fields = slots.filter(changedFields).length
    const terms = slots.filter(
      (slot) => !changedFields(slot) && baseline.tapDances[slot].tappingTerm !== plan.tapDances[slot].tappingTerm,
    ).length
    if (fields > 0) addNote(sourceDraft, `このほかに、Tap Dance の枠 ${countOf(fields)}の内容が変わります。`)
    if (terms > 0) addNote(sourceDraft, `Tap Dance の枠 ${countOf(terms)}で、長押しと判定するまでの時間が変わります。`)
  }

  return drafts.map(({ id, undo, title, lines, notes }) => (title === undefined ? { id, undo, lines, notes } : { id, undo, title, lines, notes }))
}

function addNote(change: Change, note: string) {
  if (!change.notes.includes(note)) change.notes.push(note)
}

// ---- 機器に送る操作 ----

const sameEntry = (a: TapDanceEntry | undefined, b: TapDanceEntry) =>
  a !== undefined && sameFields(a, b) && a.tappingTerm === b.tappingTerm

const sameCombo = (a: ComboEntry | undefined, b: ComboEntry) =>
  a !== undefined && a.output === b.output && a.keys.length === b.keys.length && a.keys.every((key, index) => key === b.keys[index])

/**
 * 機器に送る操作。目標（target）と、本体の現在値（current）を、本体の表現のまま比べて、違う所だけを書く操作にする。
 * 書き込み、再試行、書き込み前の状態に戻す、のどれも、この同じ計算を使う（キーの動作への変換は通さない）。
 *
 * 次の順に並べる（docs/design.md「書き込みの流れ」の 5）。途中で失敗した時に、キーが、変える前とも後とも違う動作にならないようにするため
 * 1. 本体でいまどこからも指されていない Tap Dance の枠（新しく使う枠）。指しているキーがないので、書いても動作は変わらない
 * 2. キーマップ、エンコーダー、コンボ。新しい枠を指すキーは、1 で中身が入った後に書く
 * 3. 残りの Tap Dance の枠（使われなくなった枠を空にする、など）。指していたキーは、2 で別のキーコードになっている
 *
 * 現在値で指されている枠の中身を、目標でも指したまま変える時だけは、2 と 3 の間で、その枠を指すキーが目標と違う動作になる
 * （rewritesUsedTapDance）
 */
export function writeOperations(current: KeySettings, target: KeySettings): WriteOperation[] {
  const pointed = pointedSlots(current)
  const tapDances = target.tapDances.flatMap((entry, index): WriteOperation[] =>
    sameEntry(current.tapDances[index], entry) ? [] : [{ type: 'setTapDance', index, entry: { ...entry } }],
  )
  const unused = (operation: WriteOperation) => operation.type === 'setTapDance' && !pointed.has(operation.index)
  const keys = target.keymap.flatMap((layer, layerIndex) =>
    layer.flatMap((keycode, key): WriteOperation[] =>
      current.keymap[layerIndex]?.[key] === keycode ? [] : [{ type: 'setKey', layer: layerIndex, key, keycode }],
    ),
  )
  const encoders = target.encoders.flatMap((layer, layerIndex) =>
    layer.flatMap((turns, encoder) =>
      (['left', 'right'] as const).flatMap((direction, turn): WriteOperation[] =>
        current.encoders[layerIndex]?.[encoder]?.[turn] === turns[turn]
          ? []
          : [{ type: 'setEncoder', layer: layerIndex, encoder, direction, keycode: turns[turn] }],
      ),
    ),
  )
  const combos = target.combos.flatMap((entry, index): WriteOperation[] =>
    sameCombo(current.combos[index], entry) ? [] : [{ type: 'setCombo', index, entry: { keys: [...entry.keys], output: entry.output } }],
  )
  return [...tapDances.filter(unused), ...keys, ...encoders, ...combos, ...tapDances.filter((operation) => !unused(operation))]
}

/**
 * 使用中の枠の中身を、書き換えるしかない書き込みか。本体の現在値でも、目標でも指されている枠の、4欄の中身が変わる時。
 * 空いている枠がなく、使われなくなった枠を、別の内容のキーが続けて使う時に起きる。
 * この時は、書き込みの途中で失敗すると、その枠を指すキーが、変える前とも後とも違う動作になりうる（書き込み前の確認で伝える）
 */
export function rewritesUsedTapDance(current: KeySettings, target: KeySettings): boolean {
  const [before, after] = [pointedSlots(current), pointedSlots(target)]
  return target.tapDances.some((entry, slot) => {
    const from = current.tapDances[slot]
    return before.has(slot) && after.has(slot) && from !== undefined && !sameFields(from, entry)
  })
}
