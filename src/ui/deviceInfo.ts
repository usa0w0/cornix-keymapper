// 本体の情報（対応機能と枠数）を、ヘッダーと「接続中のキーボード」のダイアログに出す形にまとめる
import type { KeyboardSnapshot } from '../device/types.ts'
import { layerModeName, layerModesFor } from '../model/action.ts'
import { countFreeCombos, countFreeTapDances } from '../model/encode.ts'
import { firmwareVersionOf } from '../model/layout.ts'
import { planKeys, type EditState } from '../session/editState.ts'

export interface SlotCount {
  /** 本体の枠数 */
  total: number
  /** 空いている枠の数 */
  free: number
}

/**
 * Tap Dance とコンボの、残り枠数。
 * Tap Dance の空いている枠は、中身が空で、キー・エンコーダー・コンボ（同時に押すキーと出力）のどこからも指されていない枠
 * （docs/design.md「枠の割り当て」）。コンボの空いている枠は、キーも出力も入っていない枠
 */
export function slotCounts(snapshot: KeyboardSnapshot): { tapDance: SlotCount; combo: SlotCount } {
  return {
    tapDance: { total: snapshot.tapDances.length, free: countFreeTapDances(snapshot) },
    combo: { total: snapshot.combos.length, free: countFreeCombos(snapshot.combos) },
  }
}

/** ヘッダーに出す残り枠数。編集を当てはめた後の、枠の割り当ての計算から出す（編集に合わせて増減する） */
export function editSlotCounts(state: EditState): { tapDance: SlotCount; combo: SlotCount } {
  const plan = planKeys(state)
  return {
    tapDance: { total: state.source.tapDances.length, free: plan.free },
    combo: { total: state.source.combos.length, free: plan.freeCombos },
  }
}

export interface InfoRow {
  label: string
  value: string
}

/** 「接続中のキーボード」のダイアログに出す行。対応機能は、本体から読んだ枠数とレイアウト定義で判定する */
export function deviceInfoRows(device: { name: string; protocol: string }, snapshot: KeyboardSnapshot): InfoRow[] {
  const { capabilities, layout } = snapshot
  const slots = slotCounts(snapshot)
  const firmware = firmwareVersionOf(layout)
  const layerModes = layerModesFor(capabilities.vialProtocol)
  return [
    { label: '機器', value: firmware ? `${device.name}（ファームウェア ${firmware}）` : `${device.name}（ファームウェアの版は不明）` },
    { label: '通信', value: `${device.protocol} ・ Vial の版 ${capabilities.vialProtocol}` },
    { label: 'レイヤー', value: String(capabilities.layerCount) },
    {
      label: '長押し・2回タップの組み合わせ',
      value:
        slots.tapDance.total > 0
          ? `使える（Tap Dance の枠 ${slots.tapDance.total} 個、残り ${slots.tapDance.free}）`
          : '使えない（本体に Tap Dance の枠がありません）',
    },
    {
      label: 'コンボ',
      value:
        slots.combo.total > 0
          ? `使える（枠 ${slots.combo.total} 個、残り ${slots.combo.free}）`
          : '使えない（本体にコンボの枠がありません）',
    },
    { label: 'ロータリーエンコーダー', value: layout.encoderCount > 0 ? `${layout.encoderCount} つ` : 'なし' },
    {
      label: 'レイヤー切り替え',
      value: `${layerModes.modes.map(layerModeName).join(' ・ ')}（${
        layerModes.verified ? '実機で確認済み' : 'この Vial の版では、動くかを確かめていません'
      }）`,
    },
  ]
}
