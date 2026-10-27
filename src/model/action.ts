// 動作（キーを押した時に起きること1つ）の型と、分類・日本語の表示名・検索。
// 本体のキーコード（数値）との変換は keycodes.ts が受け持つ

export type ModKind = 'ctrl' | 'shift' | 'alt' | 'gui'

/** 修飾キー1つ。種類と左右の組 */
export interface Mod {
  kind: ModKind
  side: 'left' | 'right'
}

/** レイヤーの切り替え方。押している間だけ（MO）、押すたびにオン・オフ（TG）、移動（TO）、次の1キーだけ（OSL） */
export type LayerMode = 'momentary' | 'toggle' | 'to' | 'oneShot'

export type Action =
  /** 文字・修飾キー・ショートカット・メディアなど。修飾キーだけの動作は code なしで表す */
  | { kind: 'key'; code?: number; mods: Mod[] }
  | { kind: 'layer'; mode: LayerMode; layer: number }
  | { kind: 'transparent' }
  | { kind: 'none' }
  /** マクロなど、このサイトで扱わないキーコード。編集はできず、元の値（raw）を保つ */
  | { kind: 'unsupported'; raw: number; label: string }

/** 修飾キーの種類。キーコードのビットの並び（Ctrl、Shift、Alt、GUI）と同じ順 */
export const MOD_KINDS: readonly ModKind[] = ['ctrl', 'shift', 'alt', 'gui']

export const LAYER_MODES: readonly LayerMode[] = ['momentary', 'toggle', 'to', 'oneShot']

/** キーコードを、画面に出す 16 進の表記にする（例: 0x7E00） */
export const formatKeycode = (code: number) => `0x${code.toString(16).toUpperCase().padStart(4, '0')}`

// ---- キーの表 ----

/** 動作を選ぶ部品の分類 */
export type ActionCategory = 'keyboard' | 'layer' | 'other'

export const ACTION_CATEGORIES: readonly { id: ActionCategory; name: string }[] = [
  { id: 'keyboard', name: 'キーボード' },
  { id: 'layer', name: 'レイヤー切り替え' },
  { id: 'other', name: 'メディア・その他' },
]

interface KeyInfo {
  /** キーの上に出す短い表示（US 配列の刻印） */
  short: string
  /** 編集欄に出す名前 */
  full: string
  /** キーの上で、short の下に添える小さな説明 */
  note?: string
  /** Shift を押しながら打った時に出る字（US 配列） */
  shifted?: string
  category: 'keyboard' | 'other'
  /** 動作を選ぶ部品に出さない（本体に設定されていれば表示はする） */
  hidden?: boolean
  /** 検索で当てる別名 */
  aliases?: string[]
}

type KeyRow = [code: number, short: string, extra?: Partial<Omit<KeyInfo, 'short' | 'category'>>]

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

// 標準的なキーボードの図にあるキー。番号は USB HID のキーの番号で、QMK 版 Vial の基本キーと同じ
const KEYBOARD_ROWS: KeyRow[] = [
  ...range(0x04, 0x1d).map((code): KeyRow => [code, String.fromCharCode(0x41 + code - 0x04)]),
  ...range(0x1e, 0x27).map((code, i): KeyRow => [code, '1234567890'[i], { shifted: '!@#$%^&*()'[i] }]),
  [0x28, 'Enter', { aliases: ['return', 'エンター', '改行'] }],
  [0x29, 'Esc', { full: 'Escape', aliases: ['エスケープ'] }],
  [0x2a, 'BS', { full: 'Backspace', aliases: ['バックスペース'] }],
  [0x2b, 'Tab', { aliases: ['タブ'] }],
  [0x2c, 'Space', { aliases: ['スペース', '空白'] }],
  [0x2d, '-', { shifted: '_', aliases: ['マイナス', 'ハイフン'] }],
  [0x2e, '=', { shifted: '+', aliases: ['イコール'] }],
  [0x2f, '[', { shifted: '{' }],
  [0x30, ']', { shifted: '}' }],
  [0x31, '\\', { shifted: '|', aliases: ['バックスラッシュ'] }],
  [0x33, ';', { shifted: ':', aliases: ['セミコロン'] }],
  [0x34, "'", { shifted: '"', aliases: ['クォート'] }],
  [0x35, '`', { shifted: '~', aliases: ['バッククォート'] }],
  [0x36, ',', { shifted: '<', aliases: ['カンマ'] }],
  [0x37, '.', { shifted: '>', aliases: ['ピリオド'] }],
  [0x38, '/', { shifted: '?', aliases: ['スラッシュ'] }],
  [0x39, 'Caps', { full: 'Caps Lock' }],
  ...range(0x3a, 0x45).map((code): KeyRow => [code, `F${code - 0x39}`]),
  [0x49, 'Ins', { full: 'Insert' }],
  [0x4a, 'Home'],
  [0x4b, 'PgUp', { full: 'Page Up' }],
  [0x4c, 'Del', { full: 'Delete', aliases: ['削除'] }],
  [0x4d, 'End'],
  [0x4e, 'PgDn', { full: 'Page Down' }],
  [0x4f, '→', { aliases: ['right', '右', '矢印'] }],
  [0x50, '←', { aliases: ['left', '左', '矢印'] }],
  [0x51, '↓', { aliases: ['down', '下', '矢印'] }],
  [0x52, '↑', { aliases: ['up', '上', '矢印'] }],
  [0x90, 'かな', { full: 'かな（LANG1）', aliases: ['kana'] }],
  [0x91, '英数', { full: '英数（LANG2）', aliases: ['eisu'] }],
]

const KEYPAD = 'テンキー'
const keypad = (code: number, short: string, extra: KeyRow[2] = {}): KeyRow => [
  code,
  short,
  { full: `${KEYPAD} ${short}`, note: KEYPAD, ...extra },
]

// 図にないキーと、メディア・マウスのキー
const OTHER_ROWS: KeyRow[] = [
  [0x46, 'PrtSc', { full: 'Print Screen' }],
  [0x47, 'ScrLk', { full: 'Scroll Lock' }],
  [0x48, 'Pause'],
  [0x65, 'Menu', { full: 'メニュー（Application）' }],
  ...range(0x68, 0x73).map((code): KeyRow => [code, `F${code - 0x5b}`]),
  [0x53, 'NumLk', { full: 'Num Lock' }],
  keypad(0x54, '/'),
  keypad(0x55, '*'),
  keypad(0x56, '-'),
  keypad(0x57, '+'),
  keypad(0x58, 'Enter'),
  ...range(0x59, 0x62).map((code, i) => keypad(code, '1234567890'[i])),
  keypad(0x63, '.'),
  keypad(0x67, '=', { hidden: true }),
  keypad(0x85, ',', { hidden: true }),
  // US 配列のキーボードにないキー
  [0x32, '#', { full: '#（Non-US）', shifted: '~', hidden: true }],
  [0x64, '\\', { full: '\\（Non-US）', shifted: '|', hidden: true }],
  [0x87, '\\', { full: '\\（JIS の「ろ」）', shifted: '_', aliases: ['ろ', 'int1'] }],
  [0x88, 'カナ', { full: 'カタカナ ひらがな', aliases: ['int2'] }],
  [0x89, '¥', { full: '¥（JIS）', shifted: '|', aliases: ['円', 'yen', 'int3'] }],
  [0x8a, '変換', { aliases: ['int4', 'henkan'] }],
  [0x8b, '無変換', { aliases: ['int5', 'muhenkan'] }],
  [0xa5, '電源', { full: '電源を切る', hidden: true }],
  [0xa6, 'スリープ', { hidden: true }],
  [0xa7, '復帰', { full: 'スリープから復帰', hidden: true }],
  [0xa8, '消音', { aliases: ['mute', 'ミュート'] }],
  [0xaa, '音量−', { full: '音量を下げる', aliases: ['volume', 'ボリューム'] }],
  [0xa9, '音量＋', { full: '音量を上げる', aliases: ['volume', 'ボリューム'] }],
  [0xae, '再生', { full: '再生 / 一時停止', aliases: ['play', 'pause'] }],
  [0xad, '停止', { full: '再生を停止', aliases: ['stop'] }],
  [0xac, '前の曲', { aliases: ['previous'] }],
  [0xab, '次の曲', { aliases: ['next'] }],
  [0xbc, '巻き戻し', { aliases: ['rewind'] }],
  [0xbb, '早送り', { aliases: ['forward'] }],
  [0xbe, '明るさ−', { full: '画面を暗くする', aliases: ['brightness'] }],
  [0xbd, '明るさ＋', { full: '画面を明るくする', aliases: ['brightness'] }],
  [0xaf, 'メディア', { full: 'メディアプレーヤーを開く', hidden: true }],
  [0xb0, '取り出し', { full: 'ディスクを取り出す', hidden: true }],
  [0xb1, 'メール', { full: 'メールを開く', hidden: true }],
  [0xb2, '電卓', { full: '電卓を開く', hidden: true }],
  [0xb3, 'PC', { full: 'マイ コンピューターを開く', hidden: true }],
  [0xb4, '検索', { full: 'ブラウザー: 検索', hidden: true }],
  [0xb5, 'ホーム', { full: 'ブラウザー: ホーム', hidden: true }],
  [0xb6, '戻る', { full: 'ブラウザー: 戻る', hidden: true }],
  [0xb7, '進む', { full: 'ブラウザー: 進む', hidden: true }],
  [0xb8, '中止', { full: 'ブラウザー: 読み込みを中止', hidden: true }],
  [0xb9, '更新', { full: 'ブラウザー: 再読み込み', hidden: true }],
  [0xba, 'お気に入り', { full: 'ブラウザー: お気に入り', hidden: true }],
  [0xd1, '左クリック', { full: 'マウスの左ボタン', aliases: ['mouse', 'クリック'] }],
  [0xd2, '右クリック', { full: 'マウスの右ボタン', aliases: ['mouse', 'クリック'] }],
  [0xd3, '中クリック', { full: 'マウスの中ボタン', aliases: ['mouse', 'クリック'] }],
  [0xd4, 'ボタン4', { full: 'マウスのボタン 4', aliases: ['mouse'] }],
  [0xd5, 'ボタン5', { full: 'マウスのボタン 5', aliases: ['mouse'] }],
  [0xd9, 'ホイール↑', { full: 'マウスのホイールを上へ', aliases: ['mouse', 'wheel', 'スクロール'] }],
  [0xda, 'ホイール↓', { full: 'マウスのホイールを下へ', aliases: ['mouse', 'wheel', 'スクロール'] }],
  [0xdb, 'ホイール←', { full: 'マウスのホイールを左へ', aliases: ['mouse', 'wheel', 'スクロール'] }],
  [0xdc, 'ホイール→', { full: 'マウスのホイールを右へ', aliases: ['mouse', 'wheel', 'スクロール'] }],
  [0xcd, 'マウス↑', { full: 'マウスカーソルを上へ', aliases: ['mouse'] }],
  [0xce, 'マウス↓', { full: 'マウスカーソルを下へ', aliases: ['mouse'] }],
  [0xcf, 'マウス←', { full: 'マウスカーソルを左へ', aliases: ['mouse'] }],
  [0xd0, 'マウス→', { full: 'マウスカーソルを右へ', aliases: ['mouse'] }],
  [0xdd, '加速0', { full: 'マウスの速さ 0', hidden: true }],
  [0xde, '加速1', { full: 'マウスの速さ 1', hidden: true }],
  [0xdf, '加速2', { full: 'マウスの速さ 2', hidden: true }],
]

const toInfo = (rows: KeyRow[], category: KeyInfo['category']) =>
  rows.map(([code, short, extra]): [number, KeyInfo] => [code, { short, full: short, category, ...extra }])

const KEYS = new Map<number, KeyInfo>([...toInfo(KEYBOARD_ROWS, 'keyboard'), ...toInfo(OTHER_ROWS, 'other')])

/** Action の code に入れられるキーの番号（修飾キーを含まない）。表にない番号は、変換の時に unsupported になる */
export const KEY_CODES: readonly number[] = [...KEYS.keys()]

export const isKeyCode = (code: number) => KEYS.has(code)

// パソコン側が JIS 配列の設定の時に、同じキーで出る字。[そのまま, Shift を押しながら, 編集欄に出す名前]
const JIS_LEGENDS: Record<number, [string, string?, string?]> = {
  0x1f: ['2', '"'],
  0x23: ['6', '&'],
  0x24: ['7', "'"],
  0x25: ['8', '('],
  0x26: ['9', ')'],
  0x27: ['0'],
  0x2d: ['-', '='],
  0x2e: ['^', '~'],
  0x2f: ['@', '`'],
  0x30: ['[', '{'],
  0x31: [']', '}'],
  0x32: [']', '}'],
  0x33: [';', '+'],
  0x34: [':', '*'],
  0x35: ['半/全', undefined, '半角 / 全角'],
}

// ---- 表示名 ----

/** キーの刻印を、どの配列で表すか。本体に書く内容は変わらず、見え方だけが変わる */
export type Legend = 'us' | 'jis'

export interface ActionLabel {
  /** キーの上に出す短い表示 */
  short: string
  /** キーの上で、short の下に添える小さな説明（レイヤー切り替えの方式など） */
  note?: string
  /** 編集欄、検索、変更点の一覧に出す名前 */
  full: string
  /** Shift を押しながら打った時に出る字。数字と記号のキーを、修飾キーなしで割り当てた時だけ */
  shifted?: string
}

const MOD_NAMES: Record<ModKind, string> = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', gui: 'GUI' }
const SIDE_NAMES: Record<Mod['side'], string> = { left: '左', right: '右' }

const LAYER_MODE_LABELS: Record<LayerMode, { name: string; note: string; full: (layer: number) => string }> = {
  momentary: { name: '押している間だけ', note: '押している間', full: (n) => `押している間だけレイヤー ${n}` },
  toggle: { name: '押すたびにオン・オフ', note: 'オン / オフ', full: (n) => `押すたびにレイヤー ${n} をオン・オフ` },
  to: { name: 'そのレイヤーに移動', note: '移動', full: (n) => `レイヤー ${n} に移動` },
  oneShot: { name: '次の1キーだけ', note: '次の1キー', full: (n) => `次の1キーだけレイヤー ${n}` },
}

/** 切り替え方の名前（動作を選ぶ部品で、切り替え方を選ぶ所に出す） */
export const layerModeName = (mode: LayerMode) => LAYER_MODE_LABELS[mode].name

function keyLabel(code: number, legend: Legend): ActionLabel {
  const info = KEYS.get(code)
  if (!info) return { short: formatKeycode(code), full: `キーコード ${formatKeycode(code)}` }
  const jis = legend === 'jis' ? JIS_LEGENDS[code] : undefined
  if (jis) return { short: jis[0], full: jis[2] ?? jis[0], shifted: jis[1] }
  return { short: info.short, full: info.full, note: info.note, shifted: info.shifted }
}

/** 修飾キーの名前の並び。左だけの組は左右を付けない（ショートカットの「Ctrl + C」など） */
function modNames(mods: Mod[], withSide: boolean): string[] {
  return mods.map((mod) => (withSide ? `${SIDE_NAMES[mod.side]} ${MOD_NAMES[mod.kind]}` : MOD_NAMES[mod.kind]))
}

function modsOnlyLabel(mods: Mod[]): ActionLabel {
  const short = modNames(mods, false).join('+')
  if (mods.length === 1) {
    const name = modNames(mods, true)[0]
    return { short, full: mods[0].kind === 'gui' ? `${name}（Cmd / Win）` : name }
  }
  return { short, full: modNames(mods, mods.some((mod) => mod.side === 'right')).join(' + ') }
}

/** 動作1つの表示。legend は刻印の配列で、数字と記号のキーの見え方だけが変わる */
export function labelOf(action: Action, legend: Legend = 'us'): ActionLabel {
  switch (action.kind) {
    case 'none':
      return { short: '', full: '何もしない' }
    case 'transparent':
      return { short: '透過', full: '透過' }
    case 'unsupported':
      return { short: action.label, full: action.label }
    case 'layer': {
      const label = LAYER_MODE_LABELS[action.mode]
      return { short: `レイヤー ${action.layer}`, note: label.note, full: label.full(action.layer) }
    }
    case 'key': {
      const { code, mods } = action
      if (code === undefined) return modsOnlyLabel(mods)
      const key = keyLabel(code, legend)
      if (mods.length === 0) return key
      const full = modNames(mods, mods.some((mod) => mod.side === 'right'))
      // Shift だけを付けた数字と記号は、出る字で表す（例: Shift + ; は「:」）
      if (mods.length === 1 && mods[0].kind === 'shift' && key.shifted) {
        return { short: key.shifted, full: `${key.shifted}（${full[0]} + ${key.short}）` }
      }
      return { short: [...modNames(mods, false), key.short].join('+'), full: [...full, key.full].join(' + ') }
    }
  }
}

// ---- 欄ごとの決まりと、対応するレイヤー切り替えの方式 ----

/** 動作を入れる先。キーの4欄、エンコーダーの1方向、コンボの出力 */
export type ActionSlot = 'tap' | 'hold' | 'doubleTap' | 'tapHold' | 'encoder' | 'combo'

/**
 * 利用者が、その欄にその動作を入れられるか。
 * 「透過」と「何もしない」はタップ欄だけ、「押している間だけレイヤー N」は長押し欄とタップ後長押し欄だけ、
 * ほかのレイヤー切り替えはそれ以外の欄。unsupported は選べない（本体から読んだ時にだけ現れる）
 */
export function canPlace(action: Action, slot: ActionSlot): boolean {
  const held = slot === 'hold' || slot === 'tapHold'
  switch (action.kind) {
    case 'none':
    case 'transparent':
      return slot === 'tap'
    case 'layer':
      return (action.mode === 'momentary') === held
    case 'key':
      return true
    case 'unsupported':
      return false
  }
}

// 実機で動くと確かめた方式。本体から取得する手段がないので、Vial の版ごとに持つ（docs/design.md「実機で確かめること」の 8）
const VERIFIED_LAYER_MODES: Record<number, readonly LayerMode[]> = {
  6: ['momentary', 'toggle', 'to', 'oneShot'],
}

/** その Vial の版で選べるレイヤー切り替えの方式。確かめていない版では、すべて選べるようにして verified を false にする */
export function layerModesFor(vialProtocol: number): { modes: readonly LayerMode[]; verified: boolean } {
  const modes = VERIFIED_LAYER_MODES[vialProtocol]
  return modes ? { modes, verified: true } : { modes: LAYER_MODES, verified: false }
}

// ---- 候補と検索 ----

export interface PickerContext {
  /** 動作を入れる先。入れられない動作は候補に出さない */
  slot: ActionSlot
  /** 本体のレイヤー数。存在しないレイヤーへの切り替えは候補に出さない */
  layerCount: number
  /** 選べるレイヤー切り替えの方式（layerModesFor の結果） */
  layerModes: readonly LayerMode[]
}

export interface Candidate {
  action: Action
  category: ActionCategory
}

const MOD_ALIASES: Record<ModKind, string[]> = {
  ctrl: ['control', 'コントロール'],
  shift: ['シフト'],
  alt: ['option', 'オルト', 'オプション'],
  gui: ['command', 'windows', 'コマンド'],
}

const plainKey = (code: number): Action => ({ kind: 'key', code, mods: [] })

function keyCandidates(): Candidate[] {
  const listed = [...KEYS].filter(([, info]) => !info.hidden)
  const of = (category: KeyInfo['category']) =>
    listed.filter(([, info]) => info.category === category).map(([code]): Candidate => ({ action: plainKey(code), category }))
  const sides = ['left', 'right'] as const
  const modifiers = sides.flatMap((side) =>
    MOD_KINDS.map((kind): Candidate => ({ action: { kind: 'key', mods: [{ kind, side }] }, category: 'keyboard' })),
  )
  // Shift で出る記号（! や + など）。図では「一緒に押す修飾キー」で作るが、検索では直接探せるようにする
  const symbols = listed
    .filter(([, info]) => info.category === 'keyboard' && info.shifted)
    .map(([code]): Candidate => ({
      action: { kind: 'key', code, mods: [{ kind: 'shift', side: 'left' }] },
      category: 'keyboard',
    }))
  return [...of('keyboard'), ...modifiers, ...symbols, ...of('other')]
}

/** 動作を選ぶ部品に出す候補。その欄に入れられるものだけを、分類を付けて返す */
export function candidates(context: PickerContext): Candidate[] {
  const layers = LAYER_MODES.filter((mode) => context.layerModes.includes(mode)).flatMap((mode) =>
    range(0, context.layerCount - 1).map((layer): Candidate => ({ action: { kind: 'layer', mode, layer }, category: 'layer' })),
  )
  return [...keyCandidates(), ...layers].filter(({ action }) => canPlace(action, context.slot))
}

// 全角と半角、大文字と小文字、空白の有無を区別しない
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '')

function searchTexts(action: Action, legend: Legend): string[] {
  const label = labelOf(action, legend)
  const texts = [label.short, label.full]
  if (action.kind === 'key') {
    if (action.code === undefined) texts.push(...action.mods.flatMap((mod) => MOD_ALIASES[mod.kind]))
    else if (action.mods.length === 0) texts.push(...(KEYS.get(action.code)?.aliases ?? []))
  }
  return texts.map(normalize)
}

/**
 * 名前で候補を探す。全部の分類から、その欄に入れられる動作だけを返す。
 * 名前がちょうど合うもの、名前の先頭が合うもの、途中が合うものの順に並べる
 */
export function searchActions(query: string, context: PickerContext, legend: Legend = 'us'): Candidate[] {
  const needle = normalize(query)
  if (needle === '') return []
  const rank = (texts: string[]) => {
    if (texts.includes(needle)) return 0
    if (texts.some((text) => text.startsWith(needle))) return 1
    return texts.some((text) => text.includes(needle)) ? 2 : undefined
  }
  return candidates(context)
    .map((candidate) => ({ candidate, rank: rank(searchTexts(candidate.action, legend)) }))
    .filter((found): found is { candidate: Candidate; rank: number } => found.rank !== undefined)
    .sort((a, b) => a.rank - b.rank)
    .map(({ candidate }) => candidate)
}
