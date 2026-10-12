// 画面デザインの試作（#22）。偽の機器のデータを表示するだけで、編集や書き込みはまだ動かない
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { KeyboardSnapshot } from '../device/types.ts'
import { bounds, placeKeys, type PlacedKey } from './kle.ts'
import { SLOT_NAMES, viewKey, viewKeyAt, type KeyView, type Legend, type Slot } from './labels.ts'
import './prototype.css'

const UNIT = 64
const GAP = 4
const SLOTS: Slot[] = ['tap', 'hold', 'doubleTap', 'tapHold']
/** キーの上で、タップ以外の欄に付ける短い印 */
const SLOT_TAGS: Record<Slot, string> = { tap: '', hold: '長押し', doubleTap: '2回', tapHold: '2回長' }

type Selection = { kind: 'key'; index: number } | { kind: 'encoder'; encoder: number; direction: number }

export function Prototype({ snapshot }: { snapshot: KeyboardSnapshot }) {
  const [tab, setTab] = useState<'keymap' | 'combo'>('keymap')
  // ?layer=1 のように、最初に開くレイヤーを URL で選べる（見比べやすくするため）
  const [layer, setLayer] = useState(() => {
    const requested = Number(new URLSearchParams(location.search).get('layer'))
    return Number.isInteger(requested) && requested >= 0 && requested < snapshot.keymap.length ? requested : 0
  })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [legend, setLegend] = useState<Legend>(() =>
    new URLSearchParams(location.search).get('legend') === 'jis' ? 'jis' : 'us',
  )
  const { cols } = snapshot.layout
  const usedTapDances = snapshot.tapDances.filter((t) => t.onTap || t.onHold || t.onDoubleTap || t.onTapHold).length
  const usedCombos = snapshot.combos.filter((c) => c.output !== 0).length

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
        <button type="button" className="primary" disabled>
          書き込み（変更 0 件）
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

          <KeyboardFigure snapshot={snapshot} layer={layer} legend={legend} selection={selection} onSelect={setSelection} />

          <p className="figure-hint">キーをクリックすると、動作を変えるダイアログが開きます。</p>
          <EditDialog open={selection !== null} onClose={() => setSelection(null)}>
            <EditPanel snapshot={snapshot} layer={layer} legend={legend} selection={selection} cols={cols} />
          </EditDialog>
          <Legend />
        </>
      )}
    </div>
  )
}

function KeyboardFigure(props: {
  snapshot: KeyboardSnapshot
  layer: number
  legend: Legend
  selection: Selection | null
  onSelect: (selection: Selection) => void
}) {
  const { snapshot, layer, legend, selection, onSelect } = props
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
          if (key.kind === 'encoder') {
            const code = snapshot.encoders[layer][key.encoder]?.[key.direction] ?? 0
            const selected =
              selection?.kind === 'encoder' && selection.encoder === key.encoder && selection.direction === key.direction
            return (
              <button
                type="button"
                key={`e${key.encoder}-${key.direction}`}
                className={`key encoder ${key.direction === 0 ? 'encoder-left' : 'encoder-right'}`}
                aria-pressed={selected}
                style={place(key)}
                onClick={() => onSelect({ kind: 'encoder', encoder: key.encoder, direction: key.direction })}
              >
                <span className="encoder-turn">{key.direction === 0 ? '↺ 左回し' : '右回し ↻'}</span>
                <KeyFace view={viewKey(code, snapshot, legend)} />
              </button>
            )
          }
          const index = key.row * snapshot.layout.cols + key.col
          const view = viewKeyAt(snapshot, layer, index, legend)
          return (
            <button
              type="button"
              key={index}
              className={`key state-${view.state}`}
              aria-pressed={selection?.kind === 'key' && selection.index === index}
              style={place(key)}
              onClick={() => onSelect({ kind: 'key', index })}
            >
              <KeyFace view={view} />
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

/** 選んだキーの編集欄を、ダイアログで出す。外側のクリック、Esc、「閉じる」で閉じる */
function EditDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="edit-dialog"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current.close()
      }}
    >
      {children}
      <div className="edit-actions">
        <button type="button" onClick={() => ref.current?.close()}>
          閉じる
        </button>
      </div>
    </dialog>
  )
}

function EditPanel(props: {
  snapshot: KeyboardSnapshot
  layer: number
  legend: Legend
  selection: Selection | null
  cols: number
}) {
  const { snapshot, layer, legend, selection, cols } = props
  if (!selection) return null
  if (selection.kind === 'encoder') {
    const code = snapshot.encoders[layer][selection.encoder][selection.direction]
    const view = viewKey(code, snapshot, legend)
    return (
      <section className="edit" aria-label="選んだキー">
        <h2>
          レイヤー {layer} ・ エンコーダー {selection.encoder + 1} の{selection.direction === 0 ? '左回し' : '右回し'}
        </h2>
        <div className="fields fields-one">
          <Field name="回した時" value={view.slots.tap?.full ?? view.slots.hold?.full} />
        </div>
      </section>
    )
  }
  const view = viewKeyAt(snapshot, layer, selection.index, legend)
  return (
    <section className="edit" aria-label="選んだキー">
      <div className="edit-head">
        <span className={`key state-${view.state}`}>
          <KeyFace view={view} />
        </span>
        <h2>
          レイヤー {layer} ・ 行 {Math.floor(selection.index / cols)} 列 {selection.index % cols} のキー
        </h2>
      </div>
      {view.state === 'locked' && (
        <p className="edit-note">
          🔒 このキーの動作は、このサイトでは編集できません。内容はそのまま残ります。別の動作で上書きすることはできます。
        </p>
      )}
      {view.state === 'transparent' && (
        <p className="edit-note">
          透過のキーです。下のレイヤーの動作（{view.inherited?.slots.tap?.full ?? '何もしない'}）がそのまま効きます。
        </p>
      )}
      <div className="fields">
        {SLOTS.map((slot) => (
          <Field
            key={slot}
            name={SLOT_NAMES[slot]}
            value={view.slots[slot]?.full}
            placeholder={slot === 'tap' && view.state !== 'normal' ? (view.state === 'transparent' ? '透過' : '何もしない') : undefined}
          />
        ))}
      </div>
    </section>
  )
}

function Field({ name, value, placeholder }: { name: string; value?: string; placeholder?: string }) {
  return (
    <div className="field">
      <span className="field-name">{name}</span>
      <button type="button" className={`field-value ${value ? '' : 'unset'}`}>
        {value ?? placeholder ?? '（なし）'}
      </button>
      {value && (
        <button type="button" className="quiet" aria-label={`${name}を消す`}>
          ×
        </button>
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
    { name: '何もしない', view: sample({}, 'none') },
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
