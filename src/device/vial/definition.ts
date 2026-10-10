// レイアウト定義（XZ 圧縮の JSON）の展開と解釈
import { XzReadableStream } from 'xz-decompress'
import type { LayoutDefinition } from '../types.ts'

export async function decompressDefinition(compressed: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const stream = new XzReadableStream(new Blob([compressed]).stream())
  return JSON.parse(await new Response(stream).text())
}

const isByteCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 0xff

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 定義から、行列の大きさとエンコーダーの数を取り出す。
 * キー配置（layouts.keymap）は KLE 形式で、行ごとに、キーの見た目の指定（オブジェクト）と
 * キーのラベル（文字列）が並ぶ。エンコーダーは、ラベルの 10 番目が "e" で、先頭が「番号,向き」
 */
export function parseDefinition(raw: unknown): LayoutDefinition {
  if (!isRecord(raw) || !isRecord(raw.matrix)) throw new Error('定義に matrix がない')
  const { rows, cols } = raw.matrix
  // 行と列、エンコーダーの番号は、コマンドの中で 1 バイトで送る。本体から来た値なので、範囲を確かめる
  if (!isByteCount(rows) || !isByteCount(cols)) {
    throw new Error('定義の matrix の rows と cols が、1〜255 の整数でない')
  }

  let encoderCount = 0
  const keymap = isRecord(raw.layouts) ? raw.layouts.keymap : undefined
  for (const row of Array.isArray(keymap) ? keymap : []) {
    for (const item of Array.isArray(row) ? row : []) {
      if (typeof item !== 'string') continue
      const labels = item.split('\n')
      if (labels[9] !== 'e') continue
      const index = Number(labels[0].split(',')[0])
      if (!Number.isInteger(index) || index < 0 || index > 0xff) {
        throw new Error(`定義のエンコーダーの番号が、0〜255 の整数でない（${labels[0]}）`)
      }
      encoderCount = Math.max(encoderCount, index + 1)
    }
  }
  return { rows, cols, encoderCount, raw }
}
