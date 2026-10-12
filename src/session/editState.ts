// 編集中の状態。基準（本体から読んだもの）・出発点（編集の土台）・編集（利用者が変えたものだけ）の3つで持つ。
// 編集していない設定は、出発点の値のまま書く（docs/design.md「状態の置き場」）。
// React にも WebHID にも依存しない。画面は、sessionReducer を useReducer に渡して使う
import type { ComboEntry, KeyboardSnapshot } from '../device/types.ts'
import type { Action } from '../model/action.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { decodeKey } from '../model/decode.ts'
import { applyEdits as encodeEdits, planKeyEdits, type KeyEditPlan } from '../model/encode.ts'
import {
  EMPTY_EDITS,
  isEmptyEdits,
  sameComboRef,
  type ComboContent,
  type ComboRef,
  type EditPlace,
  type Edits,
} from '../model/edits.ts'
import { customKeycodesOf, keycodeToAction, type CustomKeycode } from '../model/keycodes.ts'

export interface EditState {
  /** 基準: 本体から読んだもの。変更点の一覧を作る相手 */
  baseline: KeyboardSnapshot
  /** 出発点: 通常は基準と同じもの。.vil やバックアップを読み込むと入れ替わる */
  source: KeyboardSnapshot
  /** 利用者が変えたものだけ */
  edits: Edits
}

/** 中身が同じか。値のない項目（undefined）は、ない項目と同じに扱う */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>]
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => sameValue(left[key], right[key]))
}

/** 2つのスナップショットが、機器の識別・レイアウト定義・枠数も含めて、すべて同じか */
export const sameSnapshot = (a: KeyboardSnapshot, b: KeyboardSnapshot) => sameValue(a, b)

/** 読み出した内容から始める。基準と出発点は同じもので、編集はない */
export const loadSnapshot = (snapshot: KeyboardSnapshot): EditState => ({
  baseline: snapshot,
  source: snapshot,
  edits: EMPTY_EDITS,
})

/** 出発点が、基準から入れ替わっているか（.vil やバックアップを読み込んだ後） */
export const isSourceReplaced = (state: EditState) => state.source !== state.baseline

/** 本体にまだ書いていない内容があるか。ある間は、ページを離れる前に確認を出す */
export const hasUnwrittenChanges = (state: EditState) => !isEmptyEdits(state.edits) || isSourceReplaced(state)

/**
 * 編集の数。取り消しの単位で数える: キー、エンコーダーの1方向、コンボが1件ずつ。
 * 出発点の入れ替え（.vil やバックアップの読み込み）は、全体で1件
 */
export function countEdits(state: EditState): number {
  const { keys, encoders, combos } = state.edits
  return keys.length + encoders.length + combos.length + (isSourceReplaced(state) ? 1 : 0)
}

/** 出発点の枠にあるコンボ。空の枠は null。本体にない枠は undefined */
function comboAt(source: KeyboardSnapshot, slot: number, custom: readonly CustomKeycode[]): ComboContent | null | undefined {
  const entry: ComboEntry | undefined = source.combos[slot]
  if (!entry) return undefined
  const keys = entry.keys.filter((key) => key !== 0)
  return keys.length === 0 && entry.output === 0 ? null : { keys, output: keycodeToAction(entry.output, custom) }
}

/**
 * 出発点と同じ内容になった編集と、出発点にない場所の編集を取り除く。
 * 編集は「利用者が変えたものだけ」なので、元の内容に戻したものは、編集として数えない
 */
function prune(source: KeyboardSnapshot, edits: Edits): Edits {
  const custom = customKeycodesOf(source.layout)
  const keys = edits.keys.filter(({ layer, key, behavior }) => {
    const keycode = source.keymap[layer]?.[key]
    return keycode !== undefined && !sameValue(behavior, decodeKey(keycode, source.tapDances, custom))
  })
  const encoders = edits.encoders.filter(({ layer, encoder, direction, action }) => {
    const keycode = source.encoders[layer]?.[encoder]?.[direction === 'left' ? 0 : 1]
    return keycode !== undefined && !sameValue(action, keycodeToAction(keycode, custom))
  })
  const combos = edits.combos.filter(({ ref, combo }) => {
    if ('added' in ref) return combo !== null
    const current = comboAt(source, ref.slot, custom)
    return current !== undefined && !sameValue(combo, current)
  })
  // 使われていない枠を上書きしてよい、という利用者の答えは、キーの編集がある間だけ持つ
  const overwrite = edits.overwriteUnusedTapDances === true && keys.length > 0
  const unchanged =
    keys.length === edits.keys.length &&
    encoders.length === edits.encoders.length &&
    combos.length === edits.combos.length &&
    overwrite === (edits.overwriteUnusedTapDances === true)
  if (unchanged) return edits
  return overwrite ? { keys, encoders, combos, overwriteUnusedTapDances: true } : { keys, encoders, combos }
}

/**
 * 土台（出発点）が別の内容に替わる時の編集。使われていない枠を上書きしてよい、という答えは、
 * 前の内容を見て出したものなので、持ち越さない（別の枠を、聞かずに上書きしないため）
 */
function carryOver(source: KeyboardSnapshot, edits: Edits): Edits {
  const { keys, encoders, combos } = edits
  return prune(source, { keys, encoders, combos })
}

/** 編集を入れ替える。中身が変わらなければ、同じ状態を返す（画面を描き直さない） */
const withEdits = (state: EditState, edits: Edits): EditState => {
  const pruned = prune(state.source, edits)
  return sameValue(pruned, state.edits) ? state : { ...state, edits: pruned }
}

/**
 * キーの動作を変える。同じキーの前の編集は置き換える。出発点と同じ内容なら、編集はなくなる。
 * overwriteUnused は、Tap Dance の枠が足りない時に、中身はあるがどこからも使われていない枠を上書きして使ってよいか
 * （利用者が認めた時だけ true。1回認めたら、キーの編集がなくなるまで続く）
 */
export function editKey(
  state: EditState,
  layer: number,
  key: number,
  behavior: KeyBehavior,
  overwriteUnused = false,
): EditState {
  const others = state.edits.keys.filter((edit) => edit.layer !== layer || edit.key !== key)
  const keys = [...others, { layer, key, behavior }]
  return withEdits(state, overwriteUnused ? { ...state.edits, keys, overwriteUnusedTapDances: true } : { ...state.edits, keys })
}

/** キーの編集を出発点に当てはめた結果（キーコードと Tap Dance の枠の割り当て、残り枠数、足りない枠の数） */
export const planKeys = (state: EditState): KeyEditPlan => planKeyEdits(state.source, state.edits)

/** キーの編集を受け付けたか。止めた時は、その編集を当てはめた場合の結果（blocked）を返す。状態は変えていない */
export interface KeyEditResult {
  state: EditState
  blocked: KeyEditPlan | null
}

/**
 * 編集した後の状態（next）で目標を作れるかを計算し、次の編集は、状態に反映せずに止める。
 * - Tap Dance の枠が足りなくなる編集（足りない枠の数が、いまより増えない編集は通す。
 *   読み直した内容に編集を当て直した後など、すでに足りない時に、枠を減らす編集を止めないため）
 * - 本体の設定に直せない動作
 */
function guard(state: EditState, next: EditState): KeyEditResult {
  if (next === state) return { state, blocked: null }
  const plan = planKeys(next)
  const before = planKeys(state)
  const worse = plan.missing > before.missing || plan.invalid.length > before.invalid.length
  return worse ? { state, blocked: plan } : { state: next, blocked: null }
}

/** キーの動作を変える。Tap Dance の枠が足りなくなる編集は、状態に反映せずに止める */
export const tryEditKey = (state: EditState, layer: number, key: number, behavior: KeyBehavior, overwriteUnused = false) =>
  guard(state, editKey(state, layer, key, behavior, overwriteUnused))

/**
 * その場所の編集を取り消す。取り消すと Tap Dance の枠が足りなくなる時は、止める
 * （枠を空けた編集を、空いた枠をほかのキーが使った後で取り消す場合）
 */
export const tryRevertEdit = (state: EditState, place: EditPlace) => guard(state, revertEdit(state, place))

/** エンコーダーの1方向の動作を変える */
export function editEncoder(
  state: EditState,
  layer: number,
  encoder: number,
  direction: 'left' | 'right',
  action: Action,
): EditState {
  const others = state.edits.encoders.filter(
    (edit) => edit.layer !== layer || edit.encoder !== encoder || edit.direction !== direction,
  )
  return withEdits(state, { ...state.edits, encoders: [...others, { layer, encoder, direction, action }] })
}

/** コンボを足す。足した順の番号を付ける（枠の番号ではない） */
export function addCombo(state: EditState, combo: ComboContent): EditState {
  const added = state.edits.combos.reduce((max, { ref }) => ('added' in ref ? Math.max(max, ref.added + 1) : max), 0)
  return withEdits(state, { ...state.edits, combos: [...state.edits.combos, { ref: { added }, combo }] })
}

/** コンボを変える。combo が null なら消す。足したコンボは、足したことを取り消さない限り、ここで中身だけを変える */
export function editCombo(state: EditState, ref: ComboRef, combo: ComboContent | null): EditState {
  const existing = state.edits.combos.some((edit) => sameComboRef(edit.ref, ref))
  // 足していないコンボを、足した順の番号では指せない
  if ('added' in ref && !existing) return state
  const combos = existing
    ? state.edits.combos.map((edit) => (sameComboRef(edit.ref, ref) ? { ref, combo } : edit))
    : [...state.edits.combos, { ref, combo }]
  return withEdits(state, { ...state.edits, combos })
}

/** その場所の編集を取り消す（出発点の内容に戻る） */
export function revertEdit(state: EditState, place: EditPlace): EditState {
  const { keys, encoders, combos } = state.edits
  switch (place.kind) {
    case 'key':
      return withEdits(state, {
        ...state.edits,
        keys: keys.filter((edit) => edit.layer !== place.layer || edit.key !== place.key),
      })
    case 'encoder':
      return withEdits(state, {
        ...state.edits,
        encoders: encoders.filter(
          (edit) => edit.layer !== place.layer || edit.encoder !== place.encoder || edit.direction !== place.direction,
        ),
      })
    case 'combo':
      return withEdits(state, { ...state.edits, combos: combos.filter((edit) => !sameComboRef(edit.ref, place.ref)) })
  }
}

/**
 * 出発点を入れ替える（.vil やバックアップを読み込んだ時）。編集は、新しい出発点の上に残す。
 * 基準と同じ内容なら、入れ替えていないことにする
 */
export function replaceSource(state: EditState, source: KeyboardSnapshot): EditState {
  const next = sameSnapshot(source, state.baseline) ? state.baseline : source
  return { ...state, source: next, edits: next === state.source ? state.edits : carryOver(next, state.edits) }
}

/** 出発点の入れ替えを取り消す（出発点を基準に戻す） */
export const revertSource = (state: EditState): EditState => replaceSource(state, state.baseline)

/** 書き込みと照合が通った後。読み直した内容を新しい基準にし、編集を捨てる */
export const markWritten = (verified: KeyboardSnapshot): EditState => loadSnapshot(verified)

/**
 * 読み直した内容（fresh）に、編集を当て直す。基準は読み直した内容になる。
 * 出発点は、入れ替えていなければ読み直した内容に、入れ替えていればそのまま（読み込んだ .vil などの内容）にする。
 * 読み直した内容と同じになった編集は、なくなる
 */
export function reapplyEdits(state: EditState, fresh: KeyboardSnapshot): EditState {
  const source = isSourceReplaced(state) && !sameSnapshot(state.source, fresh) ? state.source : fresh
  return { baseline: fresh, source, edits: source === state.source ? prune(source, state.edits) : carryOver(source, state.edits) }
}

/**
 * 編集を本体の表現に直して、目標（出発点の写し）に書き込む関数。
 * キーの動作からキーコードへの変換と Tap Dance の枠の割り当て、エンコーダー、コンボの枠の割り当てを受け持つ。
 * 中身は model/encode.ts にある（キーは作ってある。エンコーダーは #12、コンボは #13 で足す）
 */
export type ApplyEdits = (target: KeyboardSnapshot, edits: Edits) => void

/**
 * 書き込む目標（出発点に、編集を当てはめたスナップショット）を作る。
 * 編集していないキー、エンコーダー、コンボ、Tap Dance の枠は、出発点の値をそのまま使う（キーの動作への変換を通さない）。
 * 編集がなければ、applyEdits は呼ばない。目標を作れない編集（Tap Dance の枠が足りない、など）があれば、失敗する
 */
export function buildTarget(state: EditState, applyEdits: ApplyEdits = encodeEdits): KeyboardSnapshot {
  const target = structuredClone(state.source)
  if (!isEmptyEdits(state.edits)) applyEdits(target, state.edits)
  return target
}

// ---- 画面から使う形（useReducer に渡す） ----

/**
 * つなぎ直して読み直した内容（fresh）を、そのままでは続けられない時の、利用者の選択待ち。
 * changed は、同じ機器で本体の内容が変わっていた。other-device は、別の機器（UID が違う）だった
 */
export interface PendingReload {
  reason: 'changed' | 'other-device'
  fresh: KeyboardSnapshot
}

export interface EditSession {
  /** 編集中の状態。まだ1回も読み出していなければ null。接続が切れても捨てない */
  edit: EditState | null
  pending: PendingReload | null
}

export const EMPTY_SESSION: EditSession = { edit: null, pending: null }

/**
 * 選択待ちへの答え。
 * reapply は、読み直した内容に編集を当て直す（別の機器の時は選べない）。discard は、編集を捨てて読み直した内容にする。
 * cancel は、どちらも選ばない（編集中の状態はそのまま。画面は、機器との接続を切る）
 */
export type ReloadChoice = 'reapply' | 'discard' | 'cancel'

export type SessionAction =
  /** 本体の読み出しが終わった（最初の読み出し、つなぎ直した後の読み直し） */
  | { type: 'read'; snapshot: KeyboardSnapshot }
  | { type: 'resolve'; choice: ReloadChoice }
  /** キーの動作を変える。Tap Dance の枠が足りなくなる編集は、反映しない（tryEditKey） */
  | { type: 'editKey'; layer: number; key: number; behavior: KeyBehavior; overwriteUnused?: boolean }
  | { type: 'editEncoder'; layer: number; encoder: number; direction: 'left' | 'right'; action: Action }
  | { type: 'addCombo'; combo: ComboContent }
  | { type: 'editCombo'; ref: ComboRef; combo: ComboContent | null }
  /** その場所の編集を取り消す。取り消すと Tap Dance の枠が足りなくなる時は、反映しない（tryRevertEdit） */
  | { type: 'revert'; place: EditPlace }
  | { type: 'replaceSource'; source: KeyboardSnapshot }
  | { type: 'revertSource' }
  | { type: 'written'; verified: KeyboardSnapshot }

/**
 * 読み出した内容を受け取る。
 * - まだ何も読んでいない時と、書いていない内容がない時は、読み出した内容から始める
 * - 基準と同じなら、編集を続ける
 * - 別の機器（UID が違う）か、本体の内容が変わっていたら、選択待ちにする。編集中の状態は、答えが出るまで変えない
 */
function receive(session: EditSession, fresh: KeyboardSnapshot): EditSession {
  const { edit } = session
  if (!edit || !hasUnwrittenChanges(edit)) {
    return { edit: edit && sameSnapshot(edit.baseline, fresh) ? edit : loadSnapshot(fresh), pending: null }
  }
  if (fresh.uid !== edit.baseline.uid) return { edit, pending: { reason: 'other-device', fresh } }
  if (sameSnapshot(edit.baseline, fresh)) return session.pending ? { edit, pending: null } : session
  return { edit, pending: { reason: 'changed', fresh } }
}

function resolve(session: EditSession, choice: ReloadChoice): EditSession {
  const { edit, pending } = session
  if (!edit || !pending) return session
  switch (choice) {
    case 'cancel':
      return { edit, pending: null }
    case 'discard':
      return { edit: loadSnapshot(pending.fresh), pending: null }
    case 'reapply':
      // 別の機器には、編集を当て直せない
      return pending.reason === 'changed' ? { edit: reapplyEdits(edit, pending.fresh), pending: null } : session
  }
}

function applyToEdit(edit: EditState, action: Exclude<SessionAction, { type: 'read' | 'resolve' }>): EditState {
  switch (action.type) {
    case 'editKey':
      return tryEditKey(edit, action.layer, action.key, action.behavior, action.overwriteUnused).state
    case 'editEncoder':
      return editEncoder(edit, action.layer, action.encoder, action.direction, action.action)
    case 'addCombo':
      return addCombo(edit, action.combo)
    case 'editCombo':
      return editCombo(edit, action.ref, action.combo)
    case 'revert':
      return tryRevertEdit(edit, action.place).state
    case 'replaceSource':
      return replaceSource(edit, action.source)
    case 'revertSource':
      return revertSource(edit)
    case 'written':
      return markWritten(action.verified)
  }
}

export function sessionReducer(session: EditSession, action: SessionAction): EditSession {
  if (action.type === 'read') return receive(session, action.snapshot)
  if (action.type === 'resolve') return resolve(session, action.choice)
  // 読み出す前と、選択待ちの間は、編集を受け付けない
  if (!session.edit || session.pending) return session
  const edit = applyToEdit(session.edit, action)
  return edit === session.edit ? session : { ...session, edit }
}
