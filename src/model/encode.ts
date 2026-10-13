// キーの動作（4欄）を、本体の設定（キーコードと Tap Dance の枠）に直す。
// 機能の自動判定と、Tap Dance の枠の割り当てを受け持つ（docs/design.md「機能の自動判定」「枠の割り当て」）。
// 編集したキーとエンコーダーにだけ行う。編集していないキー、エンコーダー、枠は、出発点の値のまま残す
import type { KeyboardSnapshot, TapDanceEntry } from '../device/types.ts'
import { canPlace, isKeyCode, type Action } from './action.ts'
import { BEHAVIOR_SLOTS, type BehaviorSlot, type KeyBehavior } from './behavior.ts'
import { LAYER_TAP, MOD_TAP, TAP_DANCE, tapDanceIndexOf } from './decode.ts'
import type { EncoderEdit, Edits, KeyEdit } from './edits.ts'
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

// ---- Tap Dance の枠の割り当て ----

/** 枠の割り当てに使う、本体の設定の部分 */
export type KeySettings = Pick<KeyboardSnapshot, 'keymap' | 'encoders' | 'combos' | 'tapDances'>

const isEmptyEntry = (entry: TapDanceFields) => FIELDS.every((field) => entry[field] === KC_NO)

const sameFields = (a: TapDanceFields, b: TapDanceFields) => FIELDS.every((field) => a[field] === b[field])

/**
 * 使われている枠の番号。キー、エンコーダー、コンボの出力のどれかから指されている枠。
 * このサイトが解釈できないキーコードとして残っているものも、Tap Dance を指していれば数える
 */
function pointedSlots({ keymap, encoders, combos }: Omit<KeySettings, 'tapDances'>): Set<number> {
  const pointed = new Set<number>()
  for (const keycode of [...keymap.flat(), ...encoders.flat(2), ...combos.map((combo) => combo.output)]) {
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
  /** この枠を指している、エンコーダーの方向とコンボの出力の数 */
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
  for (const keycode of [...encoders.flat(2), ...combos.map((combo) => combo.output)]) {
    const use = entryFor(keycode)
    if (use) use.others++
  }
  return [...uses.values()].sort((a, b) => a.slot - b.slot)
}

/** キーとエンコーダーの編集を、出発点に当てはめた結果 */
export interface KeyEditPlan {
  /**
   * 編集を当てはめたキーマップ、エンコーダー、Tap Dance の枠。
   * missing、invalid、invalidEncoders がある時は、書き込めない（残り枠数などの目安にだけ使う）
   */
  keymap: number[][]
  encoders: [number, number][][]
  tapDances: TapDanceEntry[]
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
}

/** まだ枠が決まっていないキーの印。Tap Dance のキーコードではない値 */
const PENDING = -1

/**
 * キーとエンコーダーの編集を出発点に当てはめ、Tap Dance の枠を割り当てる。
 *
 * - エンコーダーは、動作1つをキーコード1つに直すだけで、枠は使わない。ただし、Tap Dance を指していたエンコーダーを変えると、
 *   その枠は使われなくなる（枠が使われているかは、編集した後のエンコーダーで見る）
 * - 出発点で中身が入っている枠は、どこからも指されていなくても、勝手に空にしない。出発点にある枠どうしは、まとめない
 * - 編集したキーが Tap Dance を必要とする時は、次の順で枠を決める。同じ内容のキーは、1つの枠を共有する
 *   1. 4欄が同じ内容の枠が出発点にあれば、その枠（複数あれば番号の小さいもの）
 *   2. 空いている枠（出発点で中身が空で、どこからも指されていない枠）
 *   3. この編集で使われなくなった枠
 *   4. 利用者が認めていれば、中身はあるがどこからも使われていない枠（上書きする）
 * - この編集で使われなくなった枠（出発点では指されていて、目標ではどこからも指されない枠）は、空にする
 * - 時間の値は、枠ごとに、出発点の値のまま残す
 *
 * 結果は、編集の順番によらない（キーを、レイヤー、キーの番号の順に見る）
 */
export function planKeyEdits(
  source: KeySettings,
  edits: Pick<Edits, 'keys' | 'encoders' | 'overwriteUnusedTapDances'>,
): KeyEditPlan {
  const keymap = source.keymap.map((keys) => [...keys])
  const encoders = source.encoders.map((layer) => layer.map((turns): [number, number] => [...turns]))
  const invalidEncoders: EncoderEdit[] = []
  for (const edit of edits.encoders) {
    const keycode = encoders[edit.layer]?.[edit.encoder] === undefined ? undefined : encodeEncoderAction(edit.action)
    if (keycode === undefined) invalidEncoders.push(edit)
    else encoders[edit.layer][edit.encoder][edit.direction === 'left' ? 0 : 1] = keycode
  }
  const tapDances = source.tapDances.map((entry) => ({ ...entry }))
  const invalid: KeyEdit[] = []
  // 枠が要るキーを、枠の中身ごとにまとめる
  const groups = new Map<string, { fields: TapDanceFields; keys: KeyEdit[] }>()
  for (const edit of [...edits.keys].sort((a, b) => a.layer - b.layer || a.key - b.key)) {
    const encoded = keymap[edit.layer]?.[edit.key] === undefined ? undefined : encodeBehavior(edit.behavior)
    if (!encoded) {
      invalid.push(edit)
    } else if (encoded.feature !== 'tapDance') {
      keymap[edit.layer][edit.key] = encoded.keycode
    } else {
      keymap[edit.layer][edit.key] = PENDING
      const id = FIELDS.map((field) => encoded.fields[field]).join(',')
      const group = groups.get(id) ?? { fields: encoded.fields, keys: [] }
      group.keys.push(edit)
      groups.set(id, group)
    }
  }
  const assign = (keys: KeyEdit[], slot: number) => {
    for (const { layer, key } of keys) keymap[layer][key] = TAP_DANCE.from + slot
  }

  // 1. 同じ内容の枠が出発点にあれば、その枠を使う
  const waiting = [...groups.values()].filter(({ fields, keys }) => {
    const slot = source.tapDances.findIndex((entry) => sameFields(entry, fields))
    if (slot < 0 || slot >= TAP_DANCE.count) return true
    assign(keys, slot)
    return false
  })

  // 2〜4. 残りは、空いている枠、この編集で使われなくなった枠、（認めていれば）使われていない枠の順に使う
  const pointedBefore = pointedSlots(source)
  const pointedNow = pointedSlots({ ...source, keymap, encoders })
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
  for (const { fields, keys } of waiting) {
    const slot = available.shift()
    if (slot === undefined) {
      missing++
      unplaced.push(...keys)
      for (const { layer, key } of keys) keymap[layer][key] = source.keymap[layer][key]
      continue
    }
    taken.add(slot)
    tapDances[slot] = { ...fields, tappingTerm: tapDances[slot].tappingTerm }
    assign(keys, slot)
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
    free: missing > 0 ? 0 : countFreeTapDances({ ...source, keymap, encoders, tapDances }),
    missing,
    unplaced,
    invalid,
    invalidEncoders,
    overwritable: unused.filter((slot) => !taken.has(slot)).length,
  }
}

/**
 * 編集を本体の設定に直して、目標（出発点の写し）に書き込む。session/editState.ts の buildTarget に渡す。
 * 枠が足りない編集と、本体の設定に直せない編集は、状態に反映する前に止めているので、ここに来たら失敗にする
 */
export function applyEdits(target: KeyboardSnapshot, edits: Edits): void {
  if (edits.combos.length > 0) throw new Error('コンボの編集を本体の設定に直す処理は、まだない（#13）')
  const plan = planKeyEdits(target, edits)
  if (plan.invalid.length > 0) throw new Error('本体の設定に直せないキーの動作がある')
  if (plan.invalidEncoders.length > 0) throw new Error('本体の設定に直せないエンコーダーの動作がある')
  if (plan.missing > 0) throw new Error(`Tap Dance の枠が ${plan.missing} 個足りない`)
  target.keymap = plan.keymap
  target.encoders = plan.encoders
  target.tapDances = plan.tapDances
}
