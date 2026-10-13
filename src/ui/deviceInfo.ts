// 本体の情報（対応機能と枠数）を、ヘッダーと「接続中のキーボード」のダイアログに出す形にまとめる
import type { KeyboardSnapshot } from '../device/types.ts'
import { layerModeName, layerModesFor } from '../model/action.ts'
import { tapDanceIndexOf } from '../model/decode.ts'
import { firmwareVersionOf } from '../model/layout.ts'

export interface SlotCount {
  /** 本体の枠数 */
  total: number
  /** 空いている枠の数 */
  free: number
}

/**
 * Tap Dance とコンボの、残り枠数。
 * Tap Dance の空いている枠は、中身が空で、キー・エンコーダー・コンボの出力のどこからも指されていない枠
 * （docs/design.md「枠の割り当て」）。コンボの空いている枠は、キーも出力も入っていない枠
 */
export function slotCounts(snapshot: KeyboardSnapshot): { tapDance: SlotCount; combo: SlotCount } {
  const pointed = new Set<number>()
  const keycodes = [...snapshot.keymap.flat(), ...snapshot.encoders.flat(2), ...snapshot.combos.map((combo) => combo.output)]
  for (const keycode of keycodes) {
    const index = tapDanceIndexOf(keycode)
    if (index !== undefined) pointed.add(index)
  }
  const freeTapDances = snapshot.tapDances.filter(
    (entry, index) => !entry.onTap && !entry.onHold && !entry.onDoubleTap && !entry.onTapHold && !pointed.has(index),
  )
  const freeCombos = snapshot.combos.filter((combo) => !combo.output && combo.keys.every((key) => !key))
  return {
    tapDance: { total: snapshot.tapDances.length, free: freeTapDances.length },
    combo: { total: snapshot.combos.length, free: freeCombos.length },
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
