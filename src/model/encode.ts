// キーの動作（4欄）を、本体の設定（キーコードと Tap Dance の枠）に直す。
// 機能の自動判定と、Tap Dance の枠とコンボの枠の割り当てを受け持つ（docs/design.md「機能の自動判定」「枠の割り当て」「コンボ」）。
// 編集したキー、エンコーダー、コンボにだけ行う。編集していないキー、エンコーダー、コンボ、枠は、出発点の値のまま残す
import type { ComboEntry, KeyboardSnapshot, TapDanceEntry } from '../device/types.ts'
import { canPlace, isKeyCode, type Action } from './action.ts'
import { BEHAVIOR_SLOTS, type BehaviorSlot, type KeyBehavior } from './behavior.ts'
import { LAYER_TAP, MOD_TAP, TAP_DANCE, tapDanceIndexOf } from './decode.ts'
import type { ComboEdit, ComboKey, EncoderEdit, Edits, KeyEdit } from './edits.ts'
import { actionToKeycode, KC_TRANSPARENT, modsToBits } from './keycodes.ts'

const KC_NO = 0x0000
/** LT で表せるレイヤーの数（キーコードの中の 4 ビット） */
const LAYER_TAP_LIMIT = 16

/** Tap Dance の枠の中身。4欄のキーコード（空の欄は 0） */
export type TapDanceFields = Pick<TapDanceEntry, 'onTap' | 'onHold' | 'onDoubleTap' | 'onTapHold'>

/** 自動判定で選ぶ機能。通常のキー、MO、MT、LT、Tap Dance */
export type KeyFeature = 'key' | 'mo' | 'mt' | 'lt' | 'tapDance'

/** キーの動作を本体の設定に直したもの。Tap Dance だけが枠を使い、枠の番号は割り当ての時に決める */
export type EncodedKey =
  | { feature: Exclude<KeyFeature, 'tapDance'>; keycode: number }
  | { feature: 'tapDance'; fields: TapDanceFields }

const FIELD_OF: Record<BehaviorSlot, keyof TapDanceFields> = {
  tap: 'onTap',
  hold: 'onHold',
  doubleTap: 'onDoubleTap',
  tapHold: 'onTapHold',
}
const FIELDS = BEHAVIOR_SLOTS.map((slot) => FIELD_OF[slot])

/** MT と LT のタップ側に入れられる、修飾なしの基本キーか */
const plainKeyOf = (action: Action): number | undefined =>
  action.kind === 'key' && action.code !== undefined && action.mods.length === 0 && isKeyCode(action.code)
    ? action.code
    : undefined

const isMomentary = (action: Action): action is Extract<Action, { kind: 'layer' }> =>
  action.kind === 'layer' && action.mode === 'momentary'

/**
 * キーの動作から、使う機能を選んで、本体の設定に直す。枠を使わない軽い機能を優先し、上から順に、最初に合ったものを使う。
 *
 * 1. タップだけ → そのキーコード1つ
 * 2. 長押しだけで、「押している間だけレイヤー N」 → MO
 * 3. タップ（修飾なしの基本キー）＋ 長押し（片側の修飾キーの組）→ MT
 * 4. タップ（修飾なしの基本キー）＋ 長押し（「押している間だけレイヤー N」、N は 0〜15）→ LT
 * 5. それ以外 → Tap Dance
 *
 * 本体の設定に直せない動作（左右が混ざった修飾キーの組、ほかの欄と組み合わせた透過など）は undefined
 */
export function encodeBehavior(behavior: KeyBehavior): EncodedKey | undefined {
  // 「何もしない」は、欄が空なのと同じ
  const filled = BEHAVIOR_SLOTS.filter((slot) => behavior[slot] !== undefined && behavior[slot].kind !== 'none')
  if (filled.length === 0) return { feature: 'key', keycode: KC_NO }
  // 透過は、キー全体の性質。ほかの欄とは組み合わせられない
  if (filled.some((slot) => behavior[slot]!.kind === 'transparent')) {
    return filled.length === 1 && filled[0] === 'tap' ? { feature: 'key', keycode: KC_TRANSPARENT } : undefined
  }
  const only = (...slots: BehaviorSlot[]) => filled.length === slots.length && slots.every((slot) => filled.includes(slot))
  const { tap, hold } = behavior

  if (only('tap')) {
    const keycode = actionToKeycode(tap!)
    return keycode === undefined ? undefined : { feature: 'key', keycode }
  }
  if (only('hold') && hold && isMomentary(hold)) {
    const keycode = actionToKeycode(hold)
    if (keycode !== undefined) return { feature: 'mo', keycode }
  }
  const code = tap && plainKeyOf(tap)
  if (only('tap', 'hold') && hold && code !== undefined) {
    if (hold.kind === 'key' && hold.code === undefined) {
      const bits = modsToBits(hold.mods)
      if (bits) return { feature: 'mt', keycode: MOD_TAP.from | (bits << 8) | code }
    }
    if (isMomentary(hold) && Number.isInteger(hold.layer) && hold.layer >= 0 && hold.layer < LAYER_TAP_LIMIT) {
      return { feature: 'lt', keycode: LAYER_TAP.from | (hold.layer << 8) | code }
    }
  }

  const fields: TapDanceFields = { onTap: KC_NO, onHold: KC_NO, onDoubleTap: KC_NO, onTapHold: KC_NO }
  for (const slot of filled) {
    const keycode = actionToKeycode(behavior[slot]!)
    if (keycode === undefined) return undefined
    fields[FIELD_OF[slot]] = keycode
  }
  return { feature: 'tapDance', fields }
}

/**
 * エンコーダーの1方向の動作を、キーコードに直す。動作1つが、キーコード1つになる。
 * 「何もしない」は入れられる（欄を消した時）。本体から読んだ、このサイトで扱わない動作は、元の値に戻る。
 * 「透過」（実機で効くか確かめていない。docs/design.md「実機で確かめること」の 18）、
 * 「押している間だけレイヤー N」（回す操作には「押している間」がない）、キーコード1つで表せない動作は undefined
 */
export function encodeEncoderAction(action: Action): number | undefined {
  const allowed = action.kind === 'none' || action.kind === 'unsupported'
  return allowed || canPlace(action, 'encoder') ? actionToKeycode(action) : undefined
}

/**
 * コンボの出力の動作を、キーコードに直す。動作1つが、キーコード1つになる。
 * 本体から読んだ、このサイトで扱わない動作は、元の値に戻る（同時に押すキーだけを変えた時に、出力を保つため）。
 * 「何もしない」「透過」「押している間だけレイヤー N」、キーコード1つで表せない動作は undefined
 */
export function encodeComboOutput(action: Action): number | undefined {
  const keycode = action.kind === 'unsupported' || canPlace(action, 'combo') ? actionToKeycode(action) : undefined
  return keycode === KC_NO ? undefined : keycode
}

/** コンボ1つで、同時に押すキーの数 */
export const COMBO_KEYS = { min: 2, max: 4 }

// ---- Tap Dance の枠とコンボの枠の割り当て ----

/** 枠の割り当てに使う、本体の設定の部分 */
export type KeySettings = Pick<KeyboardSnapshot, 'keymap' | 'encoders' | 'combos' | 'tapDances'>

const isEmptyEntry = (entry: TapDanceFields) => FIELDS.every((field) => entry[field] === KC_NO)

const sameFields = (a: TapDanceFields, b: TapDanceFields) => FIELDS.every((field) => a[field] === b[field])

/** コンボが指しているキーコード。同時に押すキーと、出力 */
const comboKeycodes = (combos: readonly ComboEntry[]) => combos.flatMap((combo) => [...combo.keys, combo.output])

/**
 * 使われている枠の番号。キー、エンコーダー、コンボ（同時に押すキーと出力）のどれかから指されている枠。
 * このサイトが解釈できないキーコードとして残っているものも、Tap Dance を指していれば数える
 */
function pointedSlots({ keymap, encoders, combos }: Omit<KeySettings, 'tapDances'>): Set<number> {
  const pointed = new Set<number>()
  for (const keycode of [...keymap.flat(), ...encoders.flat(2), ...comboKeycodes(combos)]) {
    const index = tapDanceIndexOf(keycode)
    if (index !== undefined) pointed.add(index)
  }
  return pointed
}

/** 空いている枠（中身が空で、どこからも指されていない枠）の数。ヘッダーの残り枠数 */
export function countFreeTapDances(settings: KeySettings): number {
  const pointed = pointedSlots(settings)
  return settings.tapDances.filter((entry, index) => isEmptyEntry(entry) && !pointed.has(index)).length
}

/** 枠1つの使われ方 */
export interface TapDanceUse {
  slot: number
  /** この枠を指しているキー。レイヤー、キーの番号の順 */
  keys: { layer: number; key: number }[]
  /** この枠を指している、エンコーダーの方向と、コンボ（同時に押すキーと出力）の数 */
  others: number
}

/** 使われている枠と、それを指しているキーの一覧。枠の番号順。本体にない枠を指すキーコードは含めない */
export function tapDanceUses({ keymap, encoders, combos, tapDances }: KeySettings): TapDanceUse[] {
  const uses = new Map<number, TapDanceUse>()
  const entryFor = (keycode: number): TapDanceUse | undefined => {
    const slot = tapDanceIndexOf(keycode)
    if (slot === undefined || slot >= tapDances.length) return undefined
    if (!uses.has(slot)) uses.set(slot, { slot, keys: [], others: 0 })
    return uses.get(slot)
  }
  keymap.forEach((keys, layer) => keys.forEach((keycode, key) => entryFor(keycode)?.keys.push({ layer, key })))
  for (const keycode of [...encoders.flat(2), ...comboKeycodes(combos)]) {
    const use = entryFor(keycode)
    if (use) use.others++
  }
  return [...uses.values()].sort((a, b) => a.slot - b.slot)
}

const emptyCombo = (): ComboEntry => ({ keys: [KC_NO, KC_NO, KC_NO, KC_NO], output: KC_NO })

const isEmptyCombo = (combo: ComboEntry) => combo.output === KC_NO && combo.keys.every((key) => key === KC_NO)

/** 空いているコンボの枠（キーも出力も入っていない枠）の数。ヘッダーの残り枠数 */
export const countFreeCombos = (combos: readonly ComboEntry[]) => combos.filter(isEmptyCombo).length

/** Tap Dance の枠の中身を、1つの文字列にしたもの。同じ中身をまとめるのに使う */
const fieldsId = (fields: TapDanceFields) => FIELDS.map((field) => fields[field]).join(',')

/** 編集を、出発点に当てはめた結果 */
export interface KeyEditPlan {
  /**
   * 編集を当てはめたキーマップ、エンコーダー、Tap Dance の枠、コンボの枠。
   * missing、missingCombos と、invalid で始まるものがある時は、書き込めない（残り枠数などの目安にだけ使う）
   */
  keymap: number[][]
  encoders: [number, number][][]
  tapDances: TapDanceEntry[]
  combos: ComboEntry[]
  /** 残り枠数（空いている枠の数） */
  free: number
  /** 足りない枠の数。0 なら、すべてのキーに枠を割り当てられた */
  missing: number
  /** 枠を割り当てられなかったキー。キーマップでは、出発点のまま */
  unplaced: KeyEdit[]
  /** 本体の設定に直せない動作のキー、出発点にない場所のキー */
  invalid: KeyEdit[]
  /** 本体の設定に直せない動作のエンコーダー、出発点にない場所のエンコーダー。エンコーダーでは、出発点のまま */
  invalidEncoders: EncoderEdit[]
  /**
   * 上書きすれば使える枠（中身はあるが、どこからも使われていない枠）のうち、まだ使っていないものの数。
   * 上書きを認めていない時は、認めれば使える数
   */
  overwritable: number
  /** コンボの残り枠数（空いている枠の数） */
  freeCombos: number
  /** 足りないコンボの枠の数。0 なら、足したコンボすべてに枠を割り当てられた */
  missingCombos: number
  /** 本体の設定に直せないコンボ（キーの数が 2〜4 個でない、出力を直せない）、出発点にない枠のコンボ。コンボの枠では、出発点のまま */
  invalidCombos: ComboEdit[]
  /** 足したコンボに割り当てた枠。枠を割り当てられなかったコンボは、ない */
  addedCombos: { added: number; slot: number }[]
  /** この編集で枠を決めた Tap Dance の、中身（fieldsId）ごとの枠の番号。コンボのキーを、キーコードに直すのに使う */
  tapDanceSlots: ReadonlyMap<string, number>
}

/** まだ枠が決まっていないキーの印。Tap Dance のキーコードではない値 */
const PENDING = -1

/** コンボの、まだキーコードに直っていないキー（Tap Dance の枠が決まるのを待っている） */
interface WaitingComboKey {
  slot: number
  index: number
  fields: TapDanceFields
}

/**
 * コンボの編集を出発点に当てはめ、足したコンボに枠を割り当てる。同時に押すキーのうち、Tap Dance の中身で持っているものは、
 * まだ直さない（waiting に入れて返す。その間、枠の中では 0）
 *
 * - 出発点にあるコンボを変える・消す編集は、その枠に書く。消したコンボの枠は空にする
 * - 足したコンボは、足した順に、空いている枠（番号の小さいものから）、この編集で消したコンボの枠の順に入れる
 */
function placeCombos(source: readonly ComboEntry[], edits: readonly ComboEdit[]) {
  const combos = source.map((combo): ComboEntry => ({ keys: [...combo.keys], output: combo.output }))
  const waiting: WaitingComboKey[] = []
  const invalid: ComboEdit[] = []
  const addedCombos: { added: number; slot: number }[] = []
  // 本体の設定に直せるコンボなら、枠に入れる
  const put = (slot: number, edit: ComboEdit): boolean => {
    const { keys, output } = edit.combo!
    const keycode = encodeComboOutput(output)
    const usable = keys.every((key) => (typeof key === 'number' ? Number.isInteger(key) && key > KC_NO : !isEmptyEntry(key.tapDance)))
    if (keycode === undefined || !usable || keys.length < COMBO_KEYS.min || keys.length > COMBO_KEYS.max) return false
    combos[slot] = emptyCombo()
    combos[slot].output = keycode
    keys.forEach((key, index) => {
      if (typeof key === 'number') combos[slot].keys[index] = key
      else waiting.push({ slot, index, fields: key.tapDance })
    })
    return true
  }

  const removed: number[] = []
  for (const edit of edits) {
    if ('added' in edit.ref) continue
    const { slot } = edit.ref
    if (!source[slot]) invalid.push(edit)
    else if (edit.combo === null) {
      combos[slot] = emptyCombo()
      if (!isEmptyCombo(source[slot])) removed.push(slot)
    } else if (!put(slot, edit)) invalid.push(edit)
  }
  const free = source.map((_, slot) => slot).filter((slot) => isEmptyCombo(source[slot]) && isEmptyCombo(combos[slot]))
  const available = [...free, ...removed.sort((a, b) => a - b)]
  let missing = 0
  const added = edits.flatMap((edit) => ('added' in edit.ref && edit.combo ? [{ edit, added: edit.ref.added }] : []))
  for (const { edit, added: number } of added.sort((a, b) => a.added - b.added)) {
    const slot = available[0]
    if (slot === undefined) missing++
    else if (!put(slot, edit)) invalid.push(edit)
    else {
      available.shift()
      addedCombos.push({ added: number, slot })
    }
  }
  return { combos, waiting, invalid, missing, addedCombos }
}

/**
 * キー、エンコーダー、コンボの編集を出発点に当てはめ、Tap Dance の枠とコンボの枠を割り当てる。
 *
 * - エンコーダーとコンボの出力は、動作1つをキーコード1つに直すだけで、Tap Dance の枠は使わない。ただし、Tap Dance を
 *   指していたものを変えると、その枠は使われなくなる（枠が使われているかは、編集した後の内容で見る）
 * - 出発点で中身が入っている枠は、どこからも指されていなくても、勝手に空にしない。出発点にある枠どうしは、まとめない
 * - 編集したキーが Tap Dance を必要とする時は、次の順で枠を決める。同じ内容のキーは、1つの枠を共有する
 *   1. 4欄が同じ内容の枠が出発点にあれば、その枠（複数あれば番号の小さいもの）
 *   2. 空いている枠（出発点で中身が空で、どこからも指されていない枠）
 *   3. この編集で使われなくなった枠
 *   4. 利用者が認めていれば、中身はあるがどこからも使われていない枠（上書きする）
 * - コンボの同時に押すキーを、Tap Dance の中身で持っている時（この画面で編集したキーを選んだ時）は、その中身の枠を、
 *   キーと同じ決まりで決めて、その枠を指すキーコードに直す。同じ中身のキーがもうなくても、枠を1つ使う
 * - この編集で使われなくなった枠（出発点では指されていて、目標ではどこからも指されない枠）は、空にする
 * - 時間の値は、枠ごとに、出発点の値のまま残す
 * - コンボの枠の割り当ては placeCombos のとおり
 *
 * 結果は、編集の順番によらない（キーを、レイヤー、キーの番号の順に見る。コンボのキーだけが使う中身は、その後に、枠の番号順）
 */
export function planKeyEdits(
  source: KeySettings,
  edits: Pick<Edits, 'keys' | 'encoders' | 'overwriteUnusedTapDances'> & Partial<Pick<Edits, 'combos'>>,
): KeyEditPlan {
  const keymap = source.keymap.map((keys) => [...keys])
  const encoders = source.encoders.map((layer) => layer.map((turns): [number, number] => [...turns]))
  const invalidEncoders: EncoderEdit[] = []
  for (const edit of edits.encoders) {
    const keycode = encoders[edit.layer]?.[edit.encoder] === undefined ? undefined : encodeEncoderAction(edit.action)
    if (keycode === undefined) invalidEncoders.push(edit)
    else encoders[edit.layer][edit.encoder][edit.direction === 'left' ? 0 : 1] = keycode
  }
  const placed = placeCombos(source.combos, edits.combos ?? [])
  const { combos } = placed
  const tapDances = source.tapDances.map((entry) => ({ ...entry }))
  const invalid: KeyEdit[] = []
  // 枠が要るキーと、コンボのキーを、枠の中身ごとにまとめる
  const groups = new Map<string, { fields: TapDanceFields; keys: KeyEdit[]; comboKeys: WaitingComboKey[] }>()
  const groupOf = (fields: TapDanceFields) => {
    const id = fieldsId(fields)
    if (!groups.has(id)) groups.set(id, { fields, keys: [], comboKeys: [] })
    return groups.get(id)!
  }
  for (const edit of [...edits.keys].sort((a, b) => a.layer - b.layer || a.key - b.key)) {
    const encoded = keymap[edit.layer]?.[edit.key] === undefined ? undefined : encodeBehavior(edit.behavior)
    if (!encoded) {
      invalid.push(edit)
    } else if (encoded.feature !== 'tapDance') {
      keymap[edit.layer][edit.key] = encoded.keycode
    } else {
      keymap[edit.layer][edit.key] = PENDING
      groupOf(encoded.fields).keys.push(edit)
    }
  }
  for (const comboKey of [...placed.waiting].sort((a, b) => a.slot - b.slot || a.index - b.index)) {
    groupOf(comboKey.fields).comboKeys.push(comboKey)
  }
  const tapDanceSlots = new Map<string, number>()
  const assign = ({ fields, keys, comboKeys }: { fields: TapDanceFields; keys: KeyEdit[]; comboKeys: WaitingComboKey[] }, slot: number) => {
    for (const { layer, key } of keys) keymap[layer][key] = TAP_DANCE.from + slot
    for (const comboKey of comboKeys) combos[comboKey.slot].keys[comboKey.index] = TAP_DANCE.from + slot
    tapDanceSlots.set(fieldsId(fields), slot)
  }

  // 1. 同じ内容の枠が出発点にあれば、その枠を使う
  const waiting = [...groups.values()].filter((group) => {
    const slot = source.tapDances.findIndex((entry) => sameFields(entry, group.fields))
    if (slot < 0 || slot >= TAP_DANCE.count) return true
    assign(group, slot)
    return false
  })

  // 2〜4. 残りは、空いている枠、この編集で使われなくなった枠、（認めていれば）使われていない枠の順に使う
  const pointedBefore = pointedSlots(source)
  const pointedNow = pointedSlots({ keymap, encoders, combos })
  const slots = source.tapDances.map((_, slot) => slot).slice(0, TAP_DANCE.count)
  const free = slots.filter((slot) => isEmptyEntry(source.tapDances[slot]) && !pointedBefore.has(slot))
  const released = slots.filter((slot) => pointedBefore.has(slot) && !pointedNow.has(slot))
  const unused = slots.filter(
    (slot) => !isEmptyEntry(source.tapDances[slot]) && !pointedBefore.has(slot) && !pointedNow.has(slot),
  )
  const available = [...free, ...released, ...(edits.overwriteUnusedTapDances ? unused : [])]
  const taken = new Set<number>()
  const unplaced: KeyEdit[] = []
  let missing = 0
  for (const group of waiting) {
    const slot = available.shift()
    if (slot === undefined) {
      missing++
      unplaced.push(...group.keys)
      for (const { layer, key } of group.keys) keymap[layer][key] = source.keymap[layer][key]
      // キーを直せなかったコンボは、枠を出発点のままにする
      for (const comboKey of group.comboKeys) {
        combos[comboKey.slot] = { keys: [...source.combos[comboKey.slot].keys], output: source.combos[comboKey.slot].output }
      }
      continue
    }
    taken.add(slot)
    tapDances[slot] = { ...group.fields, tappingTerm: tapDances[slot].tappingTerm }
    assign(group, slot)
  }

  // この編集で使われなくなった枠は、空にする
  for (const slot of released) {
    if (taken.has(slot)) continue
    tapDances[slot] = { onTap: KC_NO, onHold: KC_NO, onDoubleTap: KC_NO, onTapHold: KC_NO, tappingTerm: tapDances[slot].tappingTerm }
  }

  return {
    keymap,
    encoders,
    tapDances,
    combos,
    free: missing > 0 ? 0 : countFreeTapDances({ keymap, encoders, combos, tapDances }),
    missing,
    unplaced,
    invalid,
    invalidEncoders,
    overwritable: unused.filter((slot) => !taken.has(slot)).length,
    freeCombos: placed.missing > 0 ? 0 : countFreeCombos(combos),
    missingCombos: placed.missing,
    invalidCombos: placed.invalid,
    addedCombos: placed.addedCombos,
    tapDanceSlots,
  }
}

/**
 * コンボの同時に押すキー1つの、編集を当てはめた後のキーコード。
 * Tap Dance の中身で持っているキーは、その中身の枠を指すキーコード。枠が決まらなかった時（枠が足りない時）は undefined
 */
export function comboKeycode(plan: Pick<KeyEditPlan, 'tapDanceSlots'>, key: ComboKey): number | undefined {
  if (typeof key === 'number') return key
  const slot = plan.tapDanceSlots.get(fieldsId(key.tapDance))
  return slot === undefined ? undefined : TAP_DANCE.from + slot
}

/**
 * 編集を本体の設定に直して、目標（出発点の写し）に書き込む。session/editState.ts の buildTarget に渡す。
 * 枠が足りない編集と、本体の設定に直せない編集は、状態に反映する前に止めているので、ここに来たら失敗にする
 */
export function applyEdits(target: KeyboardSnapshot, edits: Edits): void {
  const plan = planKeyEdits(target, edits)
  if (plan.invalid.length > 0) throw new Error('本体の設定に直せないキーの動作がある')
  if (plan.invalidEncoders.length > 0) throw new Error('本体の設定に直せないエンコーダーの動作がある')
  if (plan.invalidCombos.length > 0) throw new Error('本体の設定に直せないコンボがある')
  if (plan.missing > 0) throw new Error(`Tap Dance の枠が ${plan.missing} 個足りない`)
  if (plan.missingCombos > 0) throw new Error(`コンボの枠が ${plan.missingCombos} 個足りない`)
  target.keymap = plan.keymap
  target.encoders = plan.encoders
  target.tapDances = plan.tapDances
  target.combos = plan.combos
}
