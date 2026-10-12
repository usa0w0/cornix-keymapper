import { useState } from 'react'
import {
  ACTION_CATEGORIES,
  candidates,
  labelOf,
  layerModeName,
  MOD_KINDS,
  searchActions,
  type Action,
  type ActionCategory,
  type ActionSlot,
  type LayerMode,
  type Legend,
  type ModKind,
  type PickerContext,
} from '../model/action.ts'
import { actionId, BOARD_BLOCKS, boardAction, boardFace, cellWidth, isCurrent, layerChoices } from './pickerBoard.ts'

export interface ActionPickerProps {
  /** 動作を入れる先。入れられない動作は出さない */
  slot: ActionSlot
  /** 入れる先の名前（「タップ」「回した時」など）。見出しに出す */
  slotName: string
  /** いま入っている動作。同じ選択肢を、選択中として見せる */
  current?: Action
  /** 本体のレイヤー数 */
  layerCount: number
  /** 選べるレイヤー切り替えの方式（layerModesFor の結果） */
  layerModes: readonly LayerMode[]
  legend: Legend
  onPick: (action: Action) => void
}

interface ChoiceProps {
  context: PickerContext
  legend: Legend
  current?: Action
  onPick: (action: Action) => void
}

const MOD_BUTTON_NAMES: Record<ModKind, string> = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', gui: 'GUI' }

/** 動作を選ぶ部品。分類のボタンと、名前での検索を持つ。4欄・エンコーダー・コンボの出力で共用する */
export function ActionPicker({ slot, slotName, current, layerCount, layerModes, legend, onPick }: ActionPickerProps) {
  const [category, setCategory] = useState<ActionCategory>('keyboard')
  const [query, setQuery] = useState('')
  const context: PickerContext = { slot, layerCount, layerModes }
  const choice = { context, legend, current, onPick }

  return (
    <div className="picker">
      <div className="picker-bar">
        <span className="picker-title">「{slotName}」に入れる動作</span>
        <input
          type="search"
          placeholder="名前で検索（例: enter、音量）"
          aria-label="動作を名前で検索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {query.trim() !== '' ? (
        <SearchResults query={query} {...choice} />
      ) : (
        <>
          <div className="picker-tabs" role="group" aria-label="分類">
            {ACTION_CATEGORIES.map(({ id, name }) => (
              <button type="button" key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>
                {name}
              </button>
            ))}
          </div>
          {category === 'keyboard' && <KeyboardChoices {...choice} />}
          {category === 'layer' && <LayerChoices {...choice} />}
          {category === 'other' && <OtherChoices {...choice} />}
        </>
      )}
    </div>
  )
}

/** 名前の付いた選択肢1つ。編集欄に出すのと同じ名前で出す */
function Chip({ action, legend, current, onPick }: { action: Action } & Omit<ChoiceProps, 'context'>) {
  return (
    <button type="button" className="chip-key" aria-pressed={isCurrent(current, action)} onClick={() => onPick(action)}>
      {labelOf(action, legend).full}
    </button>
  )
}

/** 名前での検索の結果。全部の分類から、その欄に入れられる動作だけを出す */
export function SearchResults({ query, context, ...rest }: ChoiceProps & { query: string }) {
  const found = searchActions(query, context, rest.legend)
  return (
    <div className="chips">
      {found.length === 0 && <span className="picker-empty">見つかりません。</span>}
      {found.map(({ action }) => (
        <Chip key={actionId(action)} action={action} {...rest} />
      ))}
    </div>
  )
}

/** 「キーボード」の分類。標準的なキーボードの図と、図の上の「一緒に押す修飾キー」 */
export function KeyboardChoices({ legend, current, onPick, initialTogether = [] }: ChoiceProps & { initialTogether?: readonly ModKind[] }) {
  const [together, setTogether] = useState<readonly ModKind[]>(initialTogether)
  const toggle = (kind: ModKind) =>
    setTogether(together.includes(kind) ? together.filter((other) => other !== kind) : [...together, kind])

  return (
    <>
      <div className="picker-row">
        <span>一緒に押す修飾キー</span>
        {MOD_KINDS.map((kind) => (
          <button type="button" key={kind} aria-pressed={together.includes(kind)} onClick={() => toggle(kind)}>
            {MOD_BUTTON_NAMES[kind]}
          </button>
        ))}
        <span className="picker-empty">選ぶと、ショートカット（例: Ctrl + C）や、Shift で出る記号（例: !）になります。</span>
      </div>
      <div className="board">
        {BOARD_BLOCKS.map((rows, block) => (
          <div className="board-block" key={block}>
            {rows.map((row, index) => (
              <div className="board-row" key={index}>
                {row.map((cell, position) => {
                  if (cell.kind === 'gap') return <span key={position} style={{ width: cellWidth(cell) }} />
                  const action = boardAction(cell, together)
                  const name = labelOf(action, legend).full
                  const face = boardFace(cell, together, legend)
                  return (
                    <button
                      type="button"
                      key={position}
                      className="board-key"
                      style={{ width: cellWidth(cell) }}
                      aria-pressed={isCurrent(current, action)}
                      aria-label={name}
                      title={name}
                      onClick={() => onPick(action)}
                    >
                      {face.shifted && <small>{face.shifted}</small>}
                      {face.text}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

/** 「レイヤー切り替え」の分類。切り替え方と、切り替え先のレイヤーを選ぶ */
export function LayerChoices({ context, legend, current, onPick }: ChoiceProps) {
  const { modes, layers } = layerChoices(context)
  // いま入っているのがレイヤー切り替えなら、その切り替え方から始める
  const [selected, setSelected] = useState(current?.kind === 'layer' ? current.mode : undefined)
  if (modes.length === 0 || layers.length === 0) {
    return <p className="picker-empty">この欄に入れられるレイヤー切り替えは、ありません。</p>
  }
  // 欄が変わって、選んでいた切り替え方が使えなくなった時は、最初のものにする
  const mode = selected !== undefined && modes.includes(selected) ? selected : modes[0]

  return (
    <>
      <div className="picker-row">
        <span>切り替え方</span>
        {modes.map((item) => (
          <button type="button" key={item} aria-pressed={mode === item} onClick={() => setSelected(item)}>
            {layerModeName(item)}
          </button>
        ))}
      </div>
      <div className="picker-row">
        <span>切り替え先</span>
        {layers.map((layer) => {
          const action: Action = { kind: 'layer', mode, layer }
          return (
            <button
              type="button"
              key={layer}
              className="chip-key"
              aria-pressed={isCurrent(current, action)}
              aria-label={labelOf(action, legend).full}
              onClick={() => onPick(action)}
            >
              レイヤー {layer}
            </button>
          )
        })}
      </div>
    </>
  )
}

/** 「メディア・その他」の分類。図にないキーと、メディア・マウスのキー */
export function OtherChoices({ context, ...rest }: ChoiceProps) {
  return (
    <div className="chips">
      {candidates(context)
        .filter(({ category }) => category === 'other')
        .map(({ action }) => (
          <Chip key={actionId(action)} action={action} {...rest} />
        ))}
    </div>
  )
}
