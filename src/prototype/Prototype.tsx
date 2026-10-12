// 画面デザインの試作（#22）。偽の機器のデータを表示し、編集は画面の中だけで行う（書き込みはしない）
import { useMemo, useState } from 'react'
import type { KeyboardSnapshot } from '../device/types.ts'
import { bounds, placeKeys, type PlacedKey } from './kle.ts'
import {
  behaviorOf,
  CATEGORIES,
  inheritedView,
  isModifier,
  labelOf,
  LAYER_MODE_CHOICES,
  PICKER_KEYBOARD,
  PICKER_NAVIGATION,
  SLOT_NAMES,
  viewBehavior,
  type Behavior,
  type KeyView,
  type Legend,
  type Slot,
} from './labels.ts'
import './prototype.css'

const UNIT = 64
const GAP = 4
/** 動作を選ぶ部品のキーボードの、キー1つぶんの幅 */
const BOARD_UNIT = 44
const SLOTS: Slot[] = ['tap', 'hold', 'doubleTap', 'tapHold']
/** キーの上で、タップ以外の欄に付ける短い印 */
const SLOT_TAGS: Record<Slot, string> = { tap: '', hold: '長押し', doubleTap: '2回', tapHold: '2回長' }

type Selection = { kind: 'key'; index: number } | { kind: 'encoder'; encoder: number; direction: number }

const editKey = (layer: number, target: Selection) =>
  target.kind === 'key' ? `${layer}:k${target.index}` : `${layer}:e${target.encoder}-${target.direction}`

export function Prototype({ snapshot }: { snapshot: KeyboardSnapshot }) {
  const [tab, setTab] = useState<'keymap' | 'combo'>('keymap')
  // ?layer=1 のように、最初に開くレイヤーを URL で選べる（見比べやすくするため）
  const [layer, setLayer] = useState(() => {
    const requested = Number(new URLSearchParams(location.search).get('layer'))
    return Number.isInteger(requested) && requested >= 0 && requested < snapshot.keymap.length ? requested : 0
  })
  // ?key=26 のように、最初に選んでおくキーも URL で選べる
  const [selection, setSelection] = useState<Selection | null>(() => {
    const requested = new URLSearchParams(location.search).get('key')
    const index = Number(requested)
    return requested !== null && Number.isInteger(index) && index >= 0 && index < snapshot.keymap[0].length
      ? { kind: 'key', index }
      : null
  })
  const [legend, setLegend] = useState<Legend>(() =>
    new URLSearchParams(location.search).get('legend') === 'jis' ? 'jis' : 'us',
  )
  // 画面の中だけの編集。キーごとに、編集後の動作を持つ
  const [edits, setEdits] = useState<Record<string, Behavior>>({})
  const usedTapDances = snapshot.tapDances.filter((t) => t.onTap || t.onHold || t.onDoubleTap || t.onTapHold).length
  const usedCombos = snapshot.combos.filter((c) => c.output !== 0).length
  const changes = Object.keys(edits).length

  const behaviorAt = (at: number, target: Selection): Behavior =>
    edits[editKey(at, target)] ??
    behaviorOf(
      target.kind === 'key' ? snapshot.keymap[at][target.index] : snapshot.encoders[at][target.encoder][target.direction],
      snapshot,
    )
  const viewAt = (at: number, target: Selection): KeyView => {
    const view = viewBehavior(behaviorAt(at, target), snapshot, legend)
    if (view.state !== 'transparent' || target.kind !== 'key') return view
    return { ...view, inherited: inheritedView((below) => behaviorAt(below, target), at, snapshot, legend) }
  }
  const setBehavior = (target: Selection, behavior: Behavior | null) =>
    setEdits((current) => {
      const next = { ...current }
      if (behavior) next[editKey(layer, target)] = behavior
      else delete next[editKey(layer, target)]
      return next
    })

  return (
    <div className="proto">
      <header className="proto-header">
        <h1>Cornix キーマッパー</h1>
        <span className="chip chip-ok">接続済み: Cornix</span>
        <button type="button" className="quiet">切断</button>
        <span className="spacer" />
        <span className="slots" title="長押しや2回タップを組み合わせたキーが使う枠">
          Tap Dance 残り <b>{snapshot.capabilities.tapDanceCount - usedTapDances}</b> / {snapshot.capabilities.tapDanceCount}
        </span>
        <span className="slots">
          コンボ 残り <b>{snapshot.capabilities.comboCount - usedCombos}</b> / {snapshot.capabilities.comboCount}
        </span>
        <button type="button">.vil に保存</button>
        <button type="button">.vil を読み込む</button>
        <button type="button" className="primary" disabled={changes === 0}>
          書き込み（変更 {changes} 件）
        </button>
      </header>

      <nav className="proto-tabs" aria-label="画面の切り替え">
        <button type="button" aria-pressed={tab === 'keymap'} onClick={() => setTab('keymap')}>
          キーマップ
        </button>
        <button type="button" aria-pressed={tab === 'combo'} onClick={() => setTab('combo')}>
          コンボ
        </button>
      </nav>

      {tab === 'combo' ? (
        <p className="placeholder">コンボのタブは、次の試作で作ります。</p>
      ) : (
        <>
          <div className="layers" role="group" aria-label="レイヤー">
            <span className="layers-title">レイヤー</span>
            {snapshot.keymap.map((keys, index) => (
              <button
                type="button"
                key={index}
                aria-pressed={layer === index}
                className={keys.every((code) => code === 0 || code === 1) ? 'empty' : ''}
                onClick={() => {
                  setLayer(index)
                  setSelection(null)
                }}
              >
                {index}
              </button>
            ))}
            <button type="button" className="help" popoverTarget="proto-legend" aria-label="キーの見え方">
              ?
            </button>
            <span className="spacer" />
            <span className="layers-title" title="パソコン側の配列の設定に合わせて、キーの字の見え方を切り替える。本体に書く内容は変わらない">
              刻印
            </span>
            {(['us', 'jis'] as const).map((kind) => (
              <button type="button" key={kind} aria-pressed={legend === kind} onClick={() => setLegend(kind)}>
                {kind.toUpperCase()}
              </button>
            ))}
          </div>

          <KeyboardFigure
            snapshot={snapshot}
            selection={selection}
            onSelect={setSelection}
            viewOf={(target) => viewAt(layer, target)}
            isChanged={(target) => editKey(layer, target) in edits}
          />

          {selection ? (
            <EditPanel
              key={editKey(layer, selection)}
              snapshot={snapshot}
              layer={layer}
              legend={legend}
              selection={selection}
              behavior={behaviorAt(layer, selection)}
              view={viewAt(layer, selection)}
              changed={editKey(layer, selection) in edits}
              onChange={(behavior) => setBehavior(selection, behavior)}
            />
          ) : (
            <section className="edit" aria-label="選んだキー">
              <p className="edit-empty">キーをクリックすると、ここで動作を変えられます。</p>
            </section>
          )}
          <Legend />
        </>
      )}
    </div>
  )
}

function KeyboardFigure(props: {
  snapshot: KeyboardSnapshot
  selection: Selection | null
  onSelect: (selection: Selection) => void
  viewOf: (target: Selection) => KeyView
  isChanged: (target: Selection) => boolean
}) {
  const { snapshot, selection, onSelect, viewOf, isChanged } = props
  const keys = useMemo(
    () => placeKeys((snapshot.layout.raw as { layouts?: { keymap?: unknown } }).layouts?.keymap),
    [snapshot],
  )
  const box = useMemo(() => bounds(keys), [keys])
  const place = (key: PlacedKey) => ({
    left: (key.x - box.minX) * UNIT,
    top: (key.y - box.minY) * UNIT,
    width: key.w * UNIT - GAP,
    height: key.h * UNIT - GAP,
    transform: key.r ? `rotate(${key.r}deg)` : undefined,
    transformOrigin: `${(key.rx - key.x) * UNIT}px ${(key.ry - key.y) * UNIT}px`,
  })

  return (
    <div className="figure-scroll">
      <div className="figure" style={{ width: (box.maxX - box.minX) * UNIT, height: (box.maxY - box.minY) * UNIT }}>
        {keys.map((key) => {
          const target: Selection =
            key.kind === 'encoder'
              ? { kind: 'encoder', encoder: key.encoder, direction: key.direction }
              : { kind: 'key', index: key.row * snapshot.layout.cols + key.col }
          const view = viewOf(target)
          const changed = isChanged(target)
          const selected = selection !== null && editKey(0, selection) === editKey(0, target)
          const shape =
            key.kind === 'encoder' ? `encoder ${key.direction === 0 ? 'encoder-left' : 'encoder-right'}` : ''
          return (
            <button
              type="button"
              key={editKey(0, target)}
              className={`key state-${view.state} ${shape} ${changed ? 'changed' : ''}`}
              aria-pressed={selected}
              style={place(key)}
              onClick={() => onSelect(target)}
            >
              {key.kind === 'encoder' && (
                <span className="encoder-turn">{key.direction === 0 ? '↺ 左回し' : '右回し ↻'}</span>
              )}
              <KeyFace view={view} changed={changed} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** キーの幅に大きな字で収まらない表示か。全角の字は2つぶんに数える */
function isLong(text: string): boolean {
  let width = 0
  for (const char of text) width += char.charCodeAt(0) > 0xff ? 2 : 1
  return width > 5
}

/** キーの上の表示。タップを大きく、ほかの欄を小さく */
function KeyFace({ view, changed }: { view: KeyView; changed?: boolean }) {
  const shown = view.state === 'transparent' && view.inherited ? view.inherited : view
  const main: Slot | undefined = SLOTS.find((slot) => shown.slots[slot])
  return (
    <>
      {changed && <span className="mark-changed" title="変更あり" />}
      {view.state === 'locked' && <span className="mark-locked" title="このサイトでは編集不可">🔒</span>}
      {view.state === 'transparent' && <span className="mark-transparent">透過</span>}
      {main === 'tap' && shown.slots.tap?.shifted && (
        <span className="face-shifted" title="Shift を押しながら打った時に出る字">
          {shown.slots.tap.shifted}
        </span>
      )}
      {main && (
        <span className="face-main">
          {main !== 'tap' && <i>{SLOT_TAGS[main]}</i>}
          <b className={isLong(shown.slots[main]!.short) ? 'long' : ''}>{shown.slots[main]!.short}</b>
          {shown.slots[main]!.note && <small>{shown.slots[main]!.note}</small>}
        </span>
      )}
      {SLOTS.filter((slot) => slot !== main && shown.slots[slot]).map((slot) => (
        <span className="face-extra" key={slot}>
          <i>{SLOT_TAGS[slot]}</i>
          {shown.slots[slot]!.short}
        </span>
      ))}
    </>
  )
}

function EditPanel(props: {
  snapshot: KeyboardSnapshot
  layer: number
  legend: Legend
  selection: Selection
  behavior: Behavior
  view: KeyView
  changed: boolean
  onChange: (behavior: Behavior | null) => void
}) {
  const { snapshot, layer, legend, selection, behavior, view, changed, onChange } = props
  const isEncoder = selection.kind === 'encoder'
  const [active, setActive] = useState<Slot>('tap')
  const { cols } = snapshot.layout

  const pick = (code: number) =>
    onChange({ state: 'normal', slots: { ...(behavior.state === 'normal' ? behavior.slots : {}), [active]: code } })
  const clear = (slot: Slot) => {
    const rest = { ...behavior.slots }
    delete rest[slot]
    onChange(Object.keys(rest).length > 0 ? { state: 'normal', slots: rest } : { state: 'none', slots: {} })
  }
  return (
    <section className="edit" aria-label="選んだキー">
      <div className="edit-head">
        <span className={`key state-${view.state} ${changed ? 'changed' : ''}`}>
          <KeyFace view={view} changed={changed} />
        </span>
        <h2>
          レイヤー {layer} ・{' '}
          {selection.kind === 'encoder'
            ? `エンコーダー ${selection.encoder + 1} の${selection.direction === 0 ? '左回し' : '右回し'}`
            : `行 ${Math.floor(selection.index / cols)} 列 ${selection.index % cols} のキー`}
        </h2>
        {changed && (
          <button type="button" onClick={() => onChange(null)}>
            変更を取り消す
          </button>
        )}
      </div>
      {view.state === 'locked' && (
        <p className="edit-note">
          🔒 このキーの動作は、このサイトでは編集できません。内容はそのまま残ります。別の動作で上書きすることはできます。
        </p>
      )}
      {view.state === 'transparent' && (
        <p className="edit-note">
          透過のキーです。下のレイヤーの動作（{view.inherited?.slots.tap?.full ?? '何もしない'}
          ）がそのまま効きます。
          <button type="button" onClick={() => onChange({ state: 'none', slots: {} })}>
            透過をやめる
          </button>
        </p>
      )}
      {view.state === 'none' && (
        <p className="edit-note">
          欄がすべて空なので、このキーは押しても何も起きません。
          <button
            type="button"
            title="下のレイヤーの動作が、そのまま効くようにする"
            onClick={() => onChange({ state: 'transparent', slots: {} })}
          >
            透過にする
          </button>
        </p>
      )}
      <div className={`fields ${isEncoder ? 'fields-one' : ''}`}>
        {(isEncoder ? (['tap'] as Slot[]) : SLOTS).map((slot) => {
          const label = view.slots[slot]
          return (
            <div className="field" key={slot}>
              <span className="field-name">{isEncoder ? '回した時' : SLOT_NAMES[slot]}</span>
              <div className={`field-box ${label ? '' : 'unset'} ${active === slot ? 'active' : ''}`}>
                <button type="button" className="field-value" aria-pressed={active === slot} onClick={() => setActive(slot)}>
                  {label?.full ?? '（なし）'}
                </button>
                {label && (
                  <button type="button" className="field-clear" aria-label={`${SLOT_NAMES[slot]}を消す`} title="この欄を消す" onClick={() => clear(slot)}>
                    ×
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ActionPicker
        snapshot={snapshot}
        legend={legend}
        slot={active}
        slotName={isEncoder ? '回した時' : SLOT_NAMES[active]}
        layerCount={snapshot.keymap.length}
        current={behavior.slots[active]}
        onPick={pick}
      />
    </section>
  )
}

/** 動作を選ぶ部品。分類のタブと、名前での検索 */
function ActionPicker(props: {
  snapshot: KeyboardSnapshot
  legend: Legend
  slot: Slot
  slotName: string
  layerCount: number
  current?: number
  onPick: (code: number) => void
}) {
  const { snapshot, legend, slot, slotName, layerCount, current, onPick } = props
  const [category, setCategory] = useState('keyboard')
  const [query, setQuery] = useState('')
  const [mods, setMods] = useState(0)
  const [mode, setMode] = useState(0x5260)
  const tabs = [
    { id: 'keyboard', name: 'キーボード' },
    { id: 'layer', name: 'レイヤー切り替え' },
    { id: 'media', name: 'メディア・その他' },
  ]
  const shown = tabs.some((t) => t.id === category) ? category : 'keyboard'
  // 「押している間だけ」は、長押しの欄とタップ後長押しの欄にだけ入れられる
  const modes = LAYER_MODE_CHOICES.filter((choice) => choice.momentary === (slot === 'hold' || slot === 'tapHold'))
  const shownMode = modes.some((choice) => choice.base === mode) ? mode : modes[0].base

  const chip = (code: number, useFull = false) => {
    const label = labelOf(code, snapshot, legend)
    return (
      <button type="button" key={code} className="chip-key" aria-pressed={current === code} title={label.full} onClick={() => onPick(code)}>
        {useFull ? label.full : label.short}
      </button>
    )
  }
  const needle = query.trim().toLowerCase()
  const found = needle
    ? [...new Set(CATEGORIES.flatMap((c) => c.codes))].filter((code) => {
        const label = labelOf(code, snapshot, legend)
        return label.short.toLowerCase().includes(needle) || label.full.toLowerCase().includes(needle)
      })
    : []

  return (
    <div className="picker">
      <div className="picker-bar">
        <span className="picker-title">「{slotName}」に入れる動作</span>
        <input
          type="search"
          placeholder="名前で検索（例: enter、音量）"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {needle ? (
        <div className="chips">
          {found.length > 0 ? found.map((code) => chip(code, true)) : <span className="picker-empty">見つかりません。</span>}
        </div>
      ) : (
        <>
          <div className="picker-tabs">
            {tabs.map((t) => (
              <button type="button" key={t.id} aria-pressed={shown === t.id} onClick={() => setCategory(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
          {shown === 'keyboard' ? (
            <>
              <div className="picker-row">
                <span>一緒に押す修飾キー</span>
                {['Ctrl', 'Shift', 'Alt', 'GUI'].map((name, bit) => (
                  <button type="button" key={name} aria-pressed={(mods & (1 << bit)) !== 0} onClick={() => setMods(mods ^ (1 << bit))}>
                    {name}
                  </button>
                ))}
                <span className="picker-empty">
                  選ぶと、ショートカット（例: Ctrl + C）や、Shift で出る記号（例: !）になります。
                </span>
              </div>
              <div className="board">
                {[PICKER_KEYBOARD, PICKER_NAVIGATION].map((rows, block) => (
                  <div className="board-block" key={block}>
                    {rows.map((row, index) => (
                      <div className="board-row" key={index}>
                        {row.map(([code, width], position) => {
                          if (code === 0) return <span key={position} style={{ width: width * BOARD_UNIT }} />
                          // 修飾キーそのものは、組み合わせずに単体で入れる
                          const picked = mods !== 0 && !isModifier(code) ? (mods << 8) | code : code
                          const plain = labelOf(code, snapshot, legend)
                          const face = mods === 2 && plain.shifted ? plain.shifted : plain.short
                          return (
                            <button
                              type="button"
                              key={position}
                              className="board-key"
                              style={{ width: width * BOARD_UNIT - 4 }}
                              aria-pressed={current === picked}
                              title={labelOf(picked, snapshot, legend).full}
                              onClick={() => onPick(picked)}
                            >
                              {mods === 0 && plain.shifted && <small>{plain.shifted}</small>}
                              {face}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : shown === 'layer' ? (
            <>
              <div className="picker-row">
                <span>切り替え方</span>
                {modes.map((choice) => (
                  <button type="button" key={choice.base} aria-pressed={shownMode === choice.base} onClick={() => setMode(choice.base)}>
                    {choice.name}
                  </button>
                ))}
              </div>
              <div className="picker-row">
                <span>切り替え先</span>
                {Array.from({ length: layerCount }, (_, n) => (
                  <button
                    type="button"
                    key={n}
                    className="chip-key"
                    aria-pressed={current === shownMode + n}
                    onClick={() => onPick(shownMode + n)}
                  >
                    レイヤー {n}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="chips">{CATEGORIES.find((c) => c.id === 'media')!.codes.map((code) => chip(code, true))}</div>
          )}
        </>
      )}
    </div>
  )
}

const sample = (slots: KeyView['slots'], state: KeyView['state'] = 'normal'): KeyView => ({ state, slots })

/** キーの見え方の見本。実物のデータにない状態（透過、変更あり）も、ここで見られる */
function Legend() {
  const a = { short: 'A', full: 'A' }
  const samples: { name: string; view: KeyView; changed?: boolean; selected?: boolean }[] = [
    { name: 'タップだけ', view: sample({ tap: a }) },
    { name: 'タップと長押し', view: sample({ tap: a, hold: { short: 'Ctrl', full: '左 Ctrl' } }) },
    {
      name: '4つとも',
      view: sample({
        tap: a,
        hold: { short: 'Ctrl', full: '' },
        doubleTap: { short: 'Esc', full: '' },
        tapHold: { short: 'Shift', full: '' },
      }),
    },
    { name: '長押しだけ', view: sample({ hold: { short: 'レイヤー 2', note: '押している間', full: '' } }) },
    { name: '空（何もしない）', view: sample({}, 'none') },
    { name: '透過', view: { state: 'transparent', slots: {}, inherited: sample({ tap: a }) } },
    { name: '編集不可', view: sample({ tap: { short: 'BT0', full: '' } }, 'locked') },
    { name: '変更あり', view: sample({ tap: a }), changed: true },
    { name: '選択中', view: sample({ tap: a }), selected: true },
  ]
  return (
    <section className="legend" id="proto-legend" popover="auto" aria-label="キーの見え方">
      <div className="legend-head">
        <h2>キーの見え方</h2>
        <button type="button" className="quiet" popoverTarget="proto-legend" popoverTargetAction="hide" aria-label="閉じる">
          ×
        </button>
      </div>
      <ul>
        {samples.map(({ name, view, changed, selected }) => (
          <li key={name}>
            <span className={`key state-${view.state} ${changed ? 'changed' : ''}`} aria-pressed={selected}>
              <KeyFace view={view} changed={changed} />
            </span>
            {name}
          </li>
        ))}
      </ul>
      <p className="legend-note">レイヤーの番号が薄いものは、キーが1つも割り当てられていないレイヤーです。</p>
    </section>
  )
}
