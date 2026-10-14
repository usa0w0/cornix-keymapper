// .vil の保存と読み込みの、画面の側の状態と文言。変換そのものは storage/vil.ts が受け持つ
import type { Change } from '../model/diff.ts'
import { placeName } from '../model/layout.ts'
import { countExtras, type VilExtras, type VilFailure, type VilPlace } from '../storage/vil.ts'

/** 読み込むファイルの大きさの上限。.vil は 10 kB ほど。大きすぎるファイル（選び間違い）は、読まずに止める */
export const VIL_SIZE_LIMIT = 1024 * 1024

/** 画面の側で分かる、読み込めない理由も含めたもの */
export type VilLoadFailure = VilFailure | { reason: 'unreadable' } | { reason: 'too-large' }

/** .vil のダイアログの場面 */
export type VilScene =
  /** 保存の前の確認。at は、開いた時（ファイル名に入れる） */
  | { scene: 'save'; at: Date }
  /** 読み込んだ。editsBefore は、読み込む前の編集の数（読み込んだ設定の行は数えない） */
  | { scene: 'loaded'; name: string; extras: VilExtras; editsBefore: number }
  | { scene: 'failed'; name: string; failure: VilLoadFailure }

const two = (value: number) => String(value).padStart(2, '0')

/**
 * 保存するファイルの名前。利用者の時刻で「cornix-20261013-1432.vil」の形。
 * バックアップを書き出す時は、バックアップを保存した時刻で「cornix-backup-…」にする
 */
export function vilFileName(at: Date, kind: 'save' | 'backup' = 'save'): string {
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`
  return `cornix-${kind === 'backup' ? 'backup-' : ''}${day}-${two(at.getHours())}${two(at.getMinutes())}.vil`
}

/** 保存する時に出す知らせ */
export const NOT_INCLUDED = 'マクロなどは、このファイルに含まれません'

/** 「マクロなど」が指すもの */
export const NOT_INCLUDED_ITEMS = 'マクロ、Key Override、Alt Repeat Key、QMK Settings'

/**
 * 読み込んだファイルに、このサイトが扱わないものが入っていた時の知らせ。なければ null。
 * 数え方: 中身のあるマクロ、Key Override、Alt Repeat Key は 1 つを 1 件、QMK Settings は 1 項目を 1 件
 */
export function extrasText(extras: VilExtras): string | null {
  const total = countExtras(extras)
  if (total === 0) return null
  const parts = [
    ['マクロ', extras.macros],
    ['Key Override', extras.keyOverrides],
    ['Alt Repeat Key', extras.altRepeatKeys],
    ['QMK Settings', extras.settings],
  ] as const
  const detail = parts.filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count} 件`)
  return `このファイルのマクロなど ${total} 件は、本体に書き込まれません（${detail.join('、')}）。`
}

function vilPlaceName(place: VilPlace): string {
  switch (place.kind) {
    case 'key':
      return placeName(place.layer, place)
    case 'encoder':
      return `レイヤー ${place.layer} ・ エンコーダー ${place.encoder + 1}`
    case 'tapDance':
      return `Tap Dance の ${place.index + 1} 番目の枠`
    case 'combo':
      return `コンボの ${place.index + 1} 番目の枠`
  }
}

/** 解釈できない名前を、いくつまで並べるか。これより多い時は、残りを数で出す */
const NAMES_SHOWN = 5

const COUNT_NAMES = {
  layers: 'レイヤーの数',
  rows: 'キーの数（行列の行の数）',
  cols: 'キーの数（行列の列の数）',
  encoders: 'エンコーダーの数',
  'tap-dance': 'Tap Dance の枠の数',
  combo: 'コンボの枠の数',
} as const

/** 読み込めない理由。cause は何が合わなかったか、advice は次に何をするか */
export function vilFailureText(failure: VilLoadFailure): { cause: string; advice: string } {
  const own = 'このキーボードを Vial で開いて保存した .vil か、このサイトで保存した .vil を選んでください。'
  switch (failure.reason) {
    case 'unreadable':
      return { cause: 'ファイルを開けませんでした。', advice: 'ファイルがあるかを確かめて、もう一度選んでください。' }
    case 'too-large':
      return { cause: 'ファイルが大きすぎます（.vil は、ふつう 10 kB ほどです）。', advice: own }
    case 'not-json':
      return { cause: 'ファイルの中身を読めませんでした（JSON の形になっていません）。', advice: own }
    case 'not-vil':
      return { cause: `ファイルが、.vil の形をしていません（${failure.what} の形が違います）。`, advice: own }
    case 'uid':
      return {
        cause: 'ファイルが、この画面に読み込んであるキーボードのものではありません（機器の識別が違います）。',
        advice: own,
      }
    case 'missing-key':
      return {
        cause: `このキーボードにあるキー（${vilPlaceName(failure.place)}）が、ファイルでは「キーなし」になっています。`,
        advice: own,
      }
    case 'keycode': {
      const shown = failure.names.slice(0, NAMES_SHOWN).map(({ name, place }) => `${name}（${vilPlaceName(place)}）`)
      const more = failure.names.length - shown.length
      return {
        cause: `このサイトが解釈できないキーコードの名前があります: ${shown.join('、')}${more > 0 ? `、ほか ${more} 種類` : ''}。`,
        advice:
          'このサイトが対応していない機能のキーが、ファイルに入っています。そのキーを Vial で別のキーに変えてから保存し直すと、読み込めます。',
      }
    }
    default:
      return {
        cause: `${COUNT_NAMES[failure.reason]}が、このキーボードと合いません（ファイルは ${failure.actual}、このキーボードは ${failure.expected}）。`,
        advice: own,
      }
  }
}

/** 読み込んだ後の、変更点の一覧から分かること */
export interface LoadSummary {
  /** いまの本体と、動作が違う場所の数。読み込んだ内容が本体と同じなら null */
  places: number | null
  /** 動作の言葉では違いが出ない変更（本体の中での持ち方、使われていない枠の中身など）があるか */
  hidden: boolean
  /** いま残っている編集の数（読み込んだ設定の行は数えない） */
  edits: number
}

/** 変更点の一覧（読み込んだ後のもの）から、読み込んだ設定の行を探して、まとめる */
export function summarizeLoad(changes: readonly Change[]): LoadSummary {
  const source = changes.find((change) => change.undo.kind === 'source')
  return {
    places: source ? source.lines.length : null,
    hidden: source !== undefined && source.notes.length > 0,
    edits: changes.length - (source ? 1 : 0),
  }
}
