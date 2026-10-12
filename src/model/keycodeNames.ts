// Vial のキーコードの、数値と名前（.vil に書かれる文字列）の対応。
// 名前は Vial の画面のプログラム（vial-gui）が .vil に書く形（QMK の古い名前。例: KC_BSPACE、MO(2)、LSFT(KC_COMMA)）。
// 番号の体系は Vial の版 6（keycodes.ts と同じ）。
//
// 数値 → 名前（keycodeToName）は、どの数値にも文字列を返し、その文字列は nameToKeycode で必ず元の数値に戻る。
// 名前のない数値は、Vial と同じく 16 進の文字列（0x7c00 の形）にする。
// 名前 → 数値（nameToKeycode）は、書く形のほかに、QMK の新しい名前などの別名も受け付ける。分からない名前は undefined

/** 修飾を含まない基本キー（0x00〜0xFF）の名前。[数値, 書く時の名前, 読む時だけ受け付ける別名...] */
const BASIC: [number, string, ...string[]][] = [
  [0x00, 'KC_NO', 'XXXXXXX'],
  [0x01, 'KC_TRNS', 'KC_TRANSPARENT', '_______'],
  ...Array.from({ length: 26 }, (_, i): [number, string] => [0x04 + i, `KC_${String.fromCharCode(0x41 + i)}`]),
  ...Array.from({ length: 10 }, (_, i): [number, string] => [0x1e + i, `KC_${(i + 1) % 10}`]),
  [0x28, 'KC_ENTER', 'KC_ENT'],
  [0x29, 'KC_ESCAPE', 'KC_ESC'],
  [0x2a, 'KC_BSPACE', 'KC_BSPC', 'KC_BACKSPACE'],
  [0x2b, 'KC_TAB'],
  [0x2c, 'KC_SPACE', 'KC_SPC'],
  [0x2d, 'KC_MINUS', 'KC_MINS'],
  [0x2e, 'KC_EQUAL', 'KC_EQL'],
  [0x2f, 'KC_LBRACKET', 'KC_LBRC', 'KC_LEFT_BRACKET'],
  [0x30, 'KC_RBRACKET', 'KC_RBRC', 'KC_RIGHT_BRACKET'],
  [0x31, 'KC_BSLASH', 'KC_BSLS', 'KC_BACKSLASH'],
  [0x32, 'KC_NONUS_HASH', 'KC_NUHS'],
  [0x33, 'KC_SCOLON', 'KC_SCLN', 'KC_SEMICOLON'],
  [0x34, 'KC_QUOTE', 'KC_QUOT'],
  [0x35, 'KC_GRAVE', 'KC_GRV', 'KC_ZKHK'],
  [0x36, 'KC_COMMA', 'KC_COMM'],
  [0x37, 'KC_DOT'],
  [0x38, 'KC_SLASH', 'KC_SLSH'],
  [0x39, 'KC_CAPSLOCK', 'KC_CAPS', 'KC_CLCK', 'KC_CAPS_LOCK'],
  ...Array.from({ length: 12 }, (_, i): [number, string] => [0x3a + i, `KC_F${i + 1}`]),
  [0x46, 'KC_PSCREEN', 'KC_PSCR', 'KC_PRINT_SCREEN'],
  [0x47, 'KC_SCROLLLOCK', 'KC_SLCK', 'KC_SCRL', 'KC_SCROLL_LOCK'],
  [0x48, 'KC_PAUSE', 'KC_PAUS', 'KC_BRK'],
  [0x49, 'KC_INSERT', 'KC_INS'],
  [0x4a, 'KC_HOME'],
  [0x4b, 'KC_PGUP', 'KC_PAGE_UP'],
  [0x4c, 'KC_DELETE', 'KC_DEL'],
  [0x4d, 'KC_END'],
  [0x4e, 'KC_PGDOWN', 'KC_PGDN', 'KC_PAGE_DOWN'],
  [0x4f, 'KC_RIGHT', 'KC_RGHT'],
  [0x50, 'KC_LEFT'],
  [0x51, 'KC_DOWN'],
  [0x52, 'KC_UP'],
  [0x53, 'KC_NUMLOCK', 'KC_NLCK', 'KC_NUM', 'KC_NUM_LOCK'],
  [0x54, 'KC_KP_SLASH', 'KC_PSLS'],
  [0x55, 'KC_KP_ASTERISK', 'KC_PAST'],
  [0x56, 'KC_KP_MINUS', 'KC_PMNS'],
  [0x57, 'KC_KP_PLUS', 'KC_PPLS'],
  [0x58, 'KC_KP_ENTER', 'KC_PENT'],
  ...Array.from({ length: 10 }, (_, i): [number, string, string] => [0x59 + i, `KC_KP_${(i + 1) % 10}`, `KC_P${(i + 1) % 10}`]),
  [0x63, 'KC_KP_DOT', 'KC_PDOT'],
  [0x64, 'KC_NONUS_BSLASH', 'KC_NUBS', 'KC_NONUS_BACKSLASH'],
  [0x65, 'KC_APPLICATION', 'KC_APP'],
  [0x67, 'KC_KP_EQUAL', 'KC_PEQL'],
  ...Array.from({ length: 12 }, (_, i): [number, string] => [0x68 + i, `KC_F${i + 13}`]),
  [0x85, 'KC_KP_COMMA', 'KC_PCMM'],
  [0x87, 'KC_RO', 'KC_INT1', 'KC_INTERNATIONAL_1'],
  [0x88, 'KC_KANA', 'KC_INT2', 'KC_INTERNATIONAL_2'],
  [0x89, 'KC_JYEN', 'KC_INT3', 'KC_INTERNATIONAL_3'],
  [0x8a, 'KC_HENK', 'KC_INT4', 'KC_INTERNATIONAL_4'],
  [0x8b, 'KC_MHEN', 'KC_INT5', 'KC_INTERNATIONAL_5'],
  [0x90, 'KC_LANG1', 'KC_LNG1', 'KC_HAEN', 'KC_LANGUAGE_1'],
  [0x91, 'KC_LANG2', 'KC_LNG2', 'KC_HANJ', 'KC_LANGUAGE_2'],
  [0xa5, 'KC_PWR', 'KC_SYSTEM_POWER'],
  [0xa6, 'KC_SLEP', 'KC_SYSTEM_SLEEP'],
  [0xa7, 'KC_WAKE', 'KC_SYSTEM_WAKE'],
  [0xa8, 'KC_MUTE', 'KC_AUDIO_MUTE'],
  [0xa9, 'KC_VOLU', 'KC_AUDIO_VOL_UP'],
  [0xaa, 'KC_VOLD', 'KC_AUDIO_VOL_DOWN'],
  [0xab, 'KC_MNXT', 'KC_MEDIA_NEXT_TRACK'],
  [0xac, 'KC_MPRV', 'KC_MEDIA_PREV_TRACK'],
  [0xad, 'KC_MSTP', 'KC_MEDIA_STOP'],
  [0xae, 'KC_MPLY', 'KC_MEDIA_PLAY_PAUSE'],
  [0xaf, 'KC_MSEL', 'KC_MEDIA_SELECT'],
  [0xb0, 'KC_EJCT', 'KC_MEDIA_EJECT'],
  [0xb1, 'KC_MAIL'],
  [0xb2, 'KC_CALC', 'KC_CALCULATOR'],
  [0xb3, 'KC_MYCM', 'KC_MY_COMPUTER'],
  [0xb4, 'KC_WSCH', 'KC_WWW_SEARCH'],
  [0xb5, 'KC_WHOM', 'KC_WWW_HOME'],
  [0xb6, 'KC_WBAK', 'KC_WWW_BACK'],
  [0xb7, 'KC_WFWD', 'KC_WWW_FORWARD'],
  [0xb8, 'KC_WSTP', 'KC_WWW_STOP'],
  [0xb9, 'KC_WREF', 'KC_WWW_REFRESH'],
  [0xba, 'KC_WFAV', 'KC_WWW_FAVORITES'],
  [0xbb, 'KC_MFFD', 'KC_MEDIA_FAST_FORWARD'],
  [0xbc, 'KC_MRWD', 'KC_MEDIA_REWIND'],
  [0xbd, 'KC_BRIU', 'KC_BRIGHTNESS_UP'],
  [0xbe, 'KC_BRID', 'KC_BRIGHTNESS_DOWN'],
  [0xcd, 'KC_MS_U', 'KC_MS_UP'],
  [0xce, 'KC_MS_D', 'KC_MS_DOWN'],
  [0xcf, 'KC_MS_L', 'KC_MS_LEFT'],
  [0xd0, 'KC_MS_R', 'KC_MS_RIGHT'],
  ...Array.from({ length: 5 }, (_, i): [number, string, string] => [0xd1 + i, `KC_BTN${i + 1}`, `KC_MS_BTN${i + 1}`]),
  [0xd9, 'KC_WH_U', 'KC_MS_WH_UP'],
  [0xda, 'KC_WH_D', 'KC_MS_WH_DOWN'],
  [0xdb, 'KC_WH_L', 'KC_MS_WH_LEFT'],
  [0xdc, 'KC_WH_R', 'KC_MS_WH_RIGHT'],
  [0xdd, 'KC_ACL0', 'KC_MS_ACCEL0'],
  [0xde, 'KC_ACL1', 'KC_MS_ACCEL1'],
  [0xdf, 'KC_ACL2', 'KC_MS_ACCEL2'],
  [0xe0, 'KC_LCTRL', 'KC_LCTL', 'KC_LEFT_CTRL'],
  [0xe1, 'KC_LSHIFT', 'KC_LSFT', 'KC_LEFT_SHIFT'],
  [0xe2, 'KC_LALT', 'KC_LOPT', 'KC_LEFT_ALT'],
  [0xe3, 'KC_LGUI', 'KC_LCMD', 'KC_LWIN', 'KC_LEFT_GUI'],
  [0xe4, 'KC_RCTRL', 'KC_RCTL', 'KC_RIGHT_CTRL'],
  [0xe5, 'KC_RSHIFT', 'KC_RSFT', 'KC_RIGHT_SHIFT'],
  [0xe6, 'KC_RALT', 'KC_ROPT', 'KC_ALGR', 'KC_RIGHT_ALT'],
  [0xe7, 'KC_RGUI', 'KC_RCMD', 'KC_RWIN', 'KC_RIGHT_GUI'],
]

/**
 * 下位 8 ビットに基本キーを入れる形のキーコード。名前は「前の部分(基本キーの名前)」。[先頭の数値, 書く時の名前, 別名...]
 * 修飾キー付きのキー（0x0100〜）と、タップと長押しで別の動作になる MT（0x2000〜）。
 * Vial は、ここにない修飾の組（右 Ctrl + 右 Shift など）を、名前ではなく 16 進で書く
 */
const WRAPPERS: [number, string, ...string[]][] = [
  [0x0100, 'LCTL', 'C'],
  [0x0200, 'LSFT', 'S'],
  [0x0300, 'C_S', 'LCS'],
  [0x0400, 'LALT', 'A', 'LOPT'],
  [0x0500, 'LCA'],
  [0x0600, 'LSA'],
  [0x0700, 'MEH'],
  [0x0800, 'LGUI', 'G', 'LCMD', 'LWIN'],
  [0x0900, 'LCG'],
  [0x0a00, 'SGUI', 'LSG', 'SCMD', 'SWIN'],
  [0x0c00, 'LAG'],
  [0x0d00, 'LCAG'],
  [0x0f00, 'HYPR'],
  [0x1100, 'RCTL'],
  [0x1200, 'RSFT'],
  [0x1400, 'RALT', 'ROPT', 'ALGR'],
  [0x1800, 'RGUI', 'RCMD', 'RWIN'],
  [0x1900, 'RCG'],
  [0x2100, 'LCTL_T', 'CTL_T'],
  [0x2200, 'LSFT_T', 'SFT_T'],
  [0x2300, 'C_S_T', 'LCS_T'],
  [0x2400, 'LALT_T', 'ALT_T', 'LOPT_T', 'OPT_T'],
  [0x2500, 'LCA_T'],
  [0x2600, 'LSA_T'],
  [0x2700, 'MEH_T'],
  [0x2800, 'LGUI_T', 'GUI_T', 'LCMD_T', 'CMD_T', 'LWIN_T', 'WIN_T'],
  [0x2900, 'LCG_T'],
  [0x2a00, 'SGUI_T', 'LSG_T', 'SCMD_T', 'SWIN_T'],
  [0x2c00, 'LAG_T'],
  [0x2d00, 'LCAG_T'],
  [0x2f00, 'ALL_T', 'HYPR_T'],
  [0x3100, 'RCTL_T'],
  [0x3200, 'RSFT_T'],
  [0x3400, 'RALT_T', 'ROPT_T', 'ALGR_T'],
  [0x3800, 'RGUI_T', 'RCMD_T', 'RWIN_T'],
  [0x3900, 'RCG_T'],
  [0x3d00, 'RCAG_T'],
]

/** 番号を1つ取る形のキーコード。名前は「前の部分(番号)」。[先頭の数値, 個数, 名前] */
const INDEXED: [number, number, string][] = [
  [0x5200, 32, 'TO'],
  [0x5220, 32, 'MO'],
  [0x5240, 32, 'DF'],
  [0x5260, 32, 'TG'],
  [0x5280, 32, 'OSL'],
  [0x52c0, 32, 'TT'],
  [0x5700, 256, 'TD'],
]

/** タップでキー、長押しでレイヤーの LT。名前は LT2(KC_A) の形で、レイヤーは 0〜15 */
const LAYER_TAP = { from: 0x4000, layers: 16 }

/** 次の1キーだけ効く修飾キーの OSM。名前を書くのは、修飾キー1つのものだけ。ほかの組は 16 進で書く */
const ONE_SHOT_MOD = 0x52a0
const MOD_NAMES: [number, string][] = [
  [0x01, 'MOD_LCTL'],
  [0x02, 'MOD_LSFT'],
  [0x04, 'MOD_LALT'],
  [0x08, 'MOD_LGUI'],
  [0x11, 'MOD_RCTL'],
  [0x12, 'MOD_RSFT'],
  [0x14, 'MOD_RALT'],
  [0x18, 'MOD_RGUI'],
  [0x07, 'MOD_MEH'],
  [0x0f, 'MOD_HYPR'],
]

/** マクロを呼ぶキー（M0〜）と、本体の独自のキー（USER00〜） */
const MACROS = { from: 0x7700, count: 256 }
const USER_KEYS = { from: 0x7e00, count: 64 }

const KEYCODE_LIMIT = 0x10000

const basicNames = new Map(BASIC.map(([code, name]) => [code, name]))
const basicCodes = new Map(BASIC.flatMap(([code, ...names]) => names.map((name): [string, number] => [name, code])))
const wrapperNames = new Map(WRAPPERS.map(([base, name]) => [base, name]))
const wrapperBases = new Map(WRAPPERS.flatMap(([base, ...names]) => names.map((name): [string, number] => [name, base])))
const indexedBases = new Map(INDEXED.map(([base, count, name]) => [name, { base, count }]))
const modBits = new Map(MOD_NAMES.map(([bits, name]) => [name, bits]))

/** Python の hex() と同じ形（0x7c00）。Vial が、名前のない数値を書く時の形 */
const hexName = (keycode: number) => `0x${keycode.toString(16)}`

/**
 * キーコードを、.vil に書く名前にする。名前のない数値は 16 進の文字列にする。
 * 返した文字列は、nameToKeycode で必ず元の数値に戻る
 */
export function keycodeToName(keycode: number): string {
  const basic = basicNames.get(keycode)
  if (basic) return basic
  const inner = basicNames.get(keycode & 0xff)
  if (inner) {
    const wrapper = wrapperNames.get(keycode & 0xff00)
    if (wrapper) return `${wrapper}(${inner})`
    const layer = (keycode - LAYER_TAP.from) >> 8
    if (keycode >= LAYER_TAP.from && layer < LAYER_TAP.layers) return `LT${layer}(${inner})`
  }
  for (const [base, count, name] of INDEXED) {
    if (keycode >= base && keycode < base + count) return `${name}(${keycode - base})`
  }
  const mod = MOD_NAMES.find(([bits]) => bits === keycode - ONE_SHOT_MOD)
  // 組を表す名前（MOD_MEH など）は、読む時だけ受け付ける
  if (mod && !['MOD_MEH', 'MOD_HYPR'].includes(mod[1])) return `OSM(${mod[1]})`
  if (keycode >= MACROS.from && keycode < MACROS.from + MACROS.count) return `M${keycode - MACROS.from}`
  if (keycode >= USER_KEYS.from && keycode < USER_KEYS.from + USER_KEYS.count) {
    return `USER${String(keycode - USER_KEYS.from).padStart(2, '0')}`
  }
  return hexName(keycode)
}

/** 0 以上で上限より小さい、10 進の整数。形が違えば undefined */
function indexOf(text: string, limit: number): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined
  const value = Number(text)
  return value < limit ? value : undefined
}

/** 基本キーの名前を数値にする。基本キーでなければ undefined */
const basicOf = (text: string): number | undefined => basicCodes.get(text.trim())

/** 「MOD_LCTL|MOD_LSFT」の形を、修飾の 5 ビットにする。左右が混ざった組は表せないので undefined */
function modsOf(text: string): number | undefined {
  let bits: number | undefined
  for (const part of text.split('|')) {
    const mod = modBits.get(part.trim())
    if (mod === undefined) return undefined
    if (bits !== undefined && (bits & 0x10) !== (mod & 0x10)) return undefined
    bits = (bits ?? 0) | mod
  }
  return bits
}

/**
 * .vil に書かれた名前を、キーコードにする。解釈できない名前は undefined（呼ぶ側は、黙って 0 にせず、読み込みを止める）。
 * 受け付けるのは、keycodeToName が書く形、QMK の新しい名前などの別名、16 進（0x…）と 10 進の数の文字列、LT(2, KC_A) の形
 */
export function nameToKeycode(name: string): number | undefined {
  const text = name.trim()
  const basic = basicCodes.get(text)
  if (basic !== undefined) return basic
  if (/^(0x[0-9a-f]{1,4}|\d{1,5})$/i.test(text)) {
    const value = Number(text)
    return value < KEYCODE_LIMIT ? value : undefined
  }
  const numbered = /^(M|USER)(\d{1,3})$/.exec(text)
  if (numbered) {
    const range = numbered[1] === 'M' ? MACROS : USER_KEYS
    const index = indexOf(numbered[2], range.count)
    return index === undefined ? undefined : range.from + index
  }
  const call = /^([A-Z_]+?)(\d*)\((.*)\)$/.exec(text)
  if (!call) return undefined
  const [, head, digits, argument] = call
  if (head === 'LT') {
    // LT2(KC_A) が Vial の書く形。LT(2, KC_A) は QMK の書き方
    const [first, second, ...rest] = digits ? [digits, argument] : argument.split(',')
    const layer = indexOf((first ?? '').trim(), LAYER_TAP.layers)
    const key = basicOf(second ?? '')
    if (layer === undefined || key === undefined || rest.length > 0) return undefined
    return LAYER_TAP.from + (layer << 8) + key
  }
  if (digits) return undefined
  const wrapper = wrapperBases.get(head)
  if (wrapper !== undefined) {
    const key = basicOf(argument)
    return key === undefined ? undefined : wrapper + key
  }
  const indexed = indexedBases.get(head)
  if (indexed) {
    const index = indexOf(argument.trim(), indexed.count)
    return index === undefined ? undefined : indexed.base + index
  }
  if (head === 'OSM') {
    const bits = modsOf(argument)
    return bits === undefined ? undefined : ONE_SHOT_MOD + bits
  }
  return undefined
}
