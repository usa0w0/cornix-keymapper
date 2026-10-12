import { decodeKey } from '../model/decode.ts'
import type { KeyBehavior } from '../model/behavior.ts'
import { placeKeys } from '../model/layout.ts'
import type { EditState } from '../session/editState.ts'
import { useEditSession } from './editContext.ts'

/** 偽の機器への操作。main.tsx が、偽の機器につないだ時にだけ渡す */
export interface DebugTools {
  /** 接続を切る（ケーブルを抜く、Bluetooth が切れる、のまね） */
  loseConnection: () => void
  /** 本体の中身を書き換える（Vial など、ほかから設定を変えられた場合のまね） */
  alterDevice: () => void
  /** 別の機器にする（UID を変える） */
  switchDevice: () => void
}

// A。足す編集は「タップ: A ／ 長押し: 左 Ctrl」
const SAMPLE: KeyBehavior = {
  tap: { kind: 'key', code: 0x04, mods: [] },
  hold: { kind: 'key', mods: [{ kind: 'ctrl', side: 'left' }] },
}

/** まだ編集していない、レイヤー 0 のキー。図に出る順に探す */
function nextDebugKey(edit: EditState): number | undefined {
  const edited = new Set(edit.edits.keys.filter(({ layer }) => layer === 0).map(({ key }) => key))
  const isSample = (key: number) =>
    JSON.stringify(decodeKey(edit.source.keymap[0]?.[key] ?? 0, edit.source.tapDances)) === JSON.stringify(SAMPLE)
  for (const placed of placeKeys(edit.source.layout)) {
    if (placed.kind === 'key' && !edited.has(placed.index) && !isSample(placed.index)) return placed.index
  }
  return undefined
}

/**
 * 仮の入口。URL に ?fake&debugEdit を付けた時だけ出す。
 * 編集欄（#10）ができるまで、編集がある時の画面（切断、つなぎ直し、ページを離れる時の確認）を確かめるためのもの。
 * 編集欄ができたら消す
 */
export function DebugEditPanel({ tools }: { tools: DebugTools }) {
  const { session, dispatch } = useEditSession()
  const { edit } = session
  if (!edit) return null
  const key = nextDebugKey(edit)
  return (
    <p className="debug-panel">
      確認用（?debugEdit）:
      <button
        type="button"
        disabled={key === undefined}
        onClick={() => key !== undefined && dispatch({ type: 'editKey', layer: 0, key, behavior: SAMPLE })}
      >
        編集を1件足す
      </button>
      <button
        type="button"
        disabled={edit.edits.keys.length === 0}
        onClick={() => {
          const last = edit.edits.keys.at(-1)
          if (last) dispatch({ type: 'revert', place: { kind: 'key', layer: last.layer, key: last.key } })
        }}
      >
        編集を1件取り消す
      </button>
      <button type="button" onClick={tools.loseConnection}>
        偽の機器の接続を切る
      </button>
      <button type="button" onClick={tools.alterDevice}>
        偽の機器の中身を書き換える
      </button>
      <button type="button" onClick={tools.switchDevice}>
        偽の機器を別の機器にする
      </button>
    </p>
  )
}
