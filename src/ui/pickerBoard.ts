// 動作を選ぶ部品の中身。標準的なキーボードの図の並びと、図のキー・レイヤー切り替えから動作を作る計算
import {
  candidates,
  labelOf,
  LAYER_MODES,
  MOD_KINDS,
  type Action,
  type ActionCategory,
  type ActionSlot,
  type LayerMode,
  type Legend,
  type Mod,
  type ModKind,
  type PickerContext,
} from '../model/action.ts'

/** 図のキー1つぶんの大きさ（px）。すき間を含む */
export const BOARD_UNIT = 44

/** 図のキーどうしのすき間（px） */
export const BOARD_GAP = 4

/** 図の1ます。width は、キー1つぶんを 1 とした幅 */
export type BoardCell =
  | { kind: 'key'; code: number; width: number }
  /** 修飾キーそのもの。単体で入れる */
  | { kind: 'mod'; mod: Mod; width: number }
  | { kind: 'gap'; width: number }

const key = (code: number, width = 1): BoardCell => ({ kind: 'key', code, width })
const mod = (kind: ModKind, side: Mod['side'], width: number): BoardCell => ({ kind: 'mod', mod: { kind, side }, width })
const gap = (width: number): BoardCell => ({ kind: 'gap', width })
const keys = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => key(from + i))
// 英字のキーの番号は、A（0x04）から順に並ぶ
const letters = (text: string) => [...text].map((char) => key(0x04 + char.charCodeAt(0) - 0x41))

/** 標準的なキーボード（US 配列、行ごとに少しずつずれた並び）。番号は model/action.ts の表と同じ */
export const BOARD_MAIN: readonly (readonly BoardCell[])[] = [
  [key(0x29), gap(1), ...keys(0x3a, 0x3d), gap(0.5), ...keys(0x3e, 0x41), gap(0.5), ...keys(0x42, 0x45)],
  [key(0x35), ...keys(0x1e, 0x27), key(0x2d), key(0x2e), key(0x2a, 2)],
  [key(0x2b, 1.5), ...letters('QWERTYUIOP'), key(0x2f), key(0x30), key(0x31, 1.5)],
  [key(0x39, 1.75), ...letters('ASDFGHJKL'), key(0x33), key(0x34), key(0x28, 2.25)],
  [mod('shift', 'left', 2.25), ...letters('ZXCVBNM'), key(0x36), key(0x37), key(0x38), mod('shift', 'right', 2.75)],
  [
    mod('ctrl', 'left', 1.25),
    mod('gui', 'left', 1.25),
    mod('alt', 'left', 1.25),
    key(0x91, 1.25),
    key(0x2c, 5),
    key(0x90, 1.25),
    mod('alt', 'right', 1.25),
    mod('gui', 'right', 1.25),
    mod('ctrl', 'right', 1.25),
  ],
]

/** キーボードの右に置く、Ins / Del などと矢印のかたまり。行は BOARD_MAIN と同じ高さに並べる */
export const BOARD_NAVIGATION: readonly (readonly BoardCell[])[] = [
  [],
  [key(0x49), key(0x4a), key(0x4b)],
  [key(0x4c), key(0x4d), key(0x4e)],
  [],
  [gap(1), key(0x52)],
  [key(0x50), key(0x51), key(0x4f)],
]

/** 図に並べるかたまり。左から順 */
export const BOARD_BLOCKS = [BOARD_MAIN, BOARD_NAVIGATION] as const

/** ますの幅（px）。キーは、右のすき間のぶんだけ狭くする */
export const cellWidth = (cell: BoardCell) => cell.width * BOARD_UNIT - (cell.kind === 'gap' ? 0 : BOARD_GAP)

/**
 * 図のキーを押した時に入る動作。「一緒に押す修飾キー」を選んでいれば、左側の修飾キーを付ける。
 * 修飾キーそのものは、組み合わせずに単体で入れる
 */
export function boardAction(cell: Exclude<BoardCell, { kind: 'gap' }>, together: readonly ModKind[]): Action {
  if (cell.kind === 'mod') return { kind: 'key', mods: [cell.mod] }
  const mods = MOD_KINDS.filter((kind) => together.includes(kind)).map((kind): Mod => ({ kind, side: 'left' }))
  return { kind: 'key', code: cell.code, mods }
}

/**
 * 図のキーの上に出す字。Shift だけを選んでいる時は、Shift で出る字にする。
 * 何も選んでいない時は、Shift で出る字を左上に小さく添える（shifted）
 */
export function boardFace(
  cell: Exclude<BoardCell, { kind: 'gap' }>,
  together: readonly ModKind[],
  legend: Legend,
): { text: string; shifted?: string } {
  const plain = labelOf(boardAction(cell, []), legend)
  if (cell.kind === 'mod') return { text: plain.short }
  if (together.length === 0) return { text: plain.short, shifted: plain.shifted }
  const shiftOnly = together.length === 1 && together[0] === 'shift'
  return { text: shiftOnly && plain.shifted ? plain.shifted : plain.short }
}

/** 動作を表す文字列。同じ動作かを比べるのと、React の key に使う。修飾キーの並び順は区別しない */
export function actionId(action: Action): string {
  switch (action.kind) {
    case 'key': {
      const mods = action.mods.map((item) => `${item.side}-${item.kind}`).sort()
      return `key:${action.code ?? ''}:${mods.join('+')}`
    }
    case 'layer':
      return `layer:${action.mode}:${action.layer}`
    case 'unsupported':
      return `unsupported:${action.raw}`
    default:
      return action.kind
  }
}

/** いま入っている動作と同じか。何も入っていない欄は、どれとも同じでない */
export const isCurrent = (current: Action | undefined, action: Action) =>
  current !== undefined && actionId(current) === actionId(action)

/** その欄で選べるレイヤー切り替え。切り替え方と、切り替え先のレイヤー。使えない方式と、存在しないレイヤーは含めない */
export function layerChoices(context: PickerContext): { modes: LayerMode[]; layers: number[] } {
  const placeable = candidates(context).flatMap(({ action }) => (action.kind === 'layer' ? [action] : []))
  return {
    modes: LAYER_MODES.filter((mode) => placeable.some((action) => action.mode === mode)),
    layers: [...new Set(placeable.map((action) => action.layer))],
  }
}

// ---- 開いた時の見せ方。いま入っている動作が、そのまま見えるようにする ----

/**
 * 分類や修飾キーの選択を、どこから始めるかを表す文字列。欄と、いま入っている動作で決まる。
 * これが変わったら、利用者が自分で切り替えた分類・修飾キー・切り替え方を捨てて、いま入っている動作に合わせ直す
 */
export const pickerStartId = (slot: ActionSlot, current: Action | undefined) => `${slot}:${current ? actionId(current) : ''}`

/** 最初に開く分類。いま入っている動作の分類にする。空の欄と、候補にない動作は「キーボード」 */
export function startCategory(current: Action | undefined, context: PickerContext): ActionCategory {
  if (current?.kind === 'layer') return 'layer'
  if (current?.kind !== 'key') return 'keyboard'
  // ショートカットは、修飾キーを外したキーの分類にする
  const plain = actionId({ ...current, mods: current.code === undefined ? current.mods : [] })
  return candidates(context).find(({ action }) => actionId(action) === plain)?.category ?? 'keyboard'
}

/**
 * 最初に選んでおく「一緒に押す修飾キー」。ショートカットや Shift で出る記号が入っている欄では、その修飾キーにする。
 * 図から作れるのは左側の修飾キーだけなので、右側を含む組と、修飾キーだけの動作では、何も選ばない
 */
export function startTogether(current: Action | undefined): ModKind[] {
  if (current?.kind !== 'key' || current.code === undefined) return []
  if (current.mods.some((item) => item.side === 'right')) return []
  return MOD_KINDS.filter((kind) => current.mods.some((item) => item.kind === kind))
}

/** 最初に選んでおく切り替え方。いま入っている切り替え方にし、この欄で選べない時は、選べるものの最初にする */
export function startLayerMode(current: Action | undefined, modes: readonly LayerMode[]): LayerMode | undefined {
  return current?.kind === 'layer' && modes.includes(current.mode) ? current.mode : modes[0]
}
