// 試作用。レイアウト定義の KLE 形式から、キーとエンコーダーの位置を取り出す
export interface PlacedKey {
  /** 単位はキー1つぶん（1u） */
  x: number
  y: number
  w: number
  h: number
  /** 回転（度）と、その中心 */
  r: number
  rx: number
  ry: number
  kind: 'key' | 'encoder'
  /** key: 行列上の位置 */
  row: number
  col: number
  /** encoder: 番号と向き（0 = 左回し、1 = 右回し） */
  encoder: number
  direction: number
}

export function placeKeys(keymap: unknown): PlacedKey[] {
  const keys: PlacedKey[] = []
  const cursor = { x: 0, y: 0, r: 0, rx: 0, ry: 0 }
  for (const row of Array.isArray(keymap) ? keymap : []) {
    let size = { w: 1, h: 1 }
    for (const item of Array.isArray(row) ? row : []) {
      if (typeof item === 'string') {
        const labels = item.split('\n')
        const [a, b] = labels[0].split(',').map(Number)
        const isEncoder = labels[9] === 'e'
        keys.push({
          ...cursor,
          ...size,
          kind: isEncoder ? 'encoder' : 'key',
          row: isEncoder ? -1 : a,
          col: isEncoder ? -1 : b,
          encoder: isEncoder ? a : -1,
          direction: isEncoder ? b : -1,
        })
        cursor.x += size.w
        size = { w: 1, h: 1 }
        continue
      }
      const props = item as Partial<Record<'x' | 'y' | 'w' | 'h' | 'r' | 'rx' | 'ry', number>>
      if (props.r !== undefined) cursor.r = props.r
      if (props.rx !== undefined) {
        cursor.rx = props.rx
        cursor.x = cursor.rx
        cursor.y = cursor.ry
      }
      if (props.ry !== undefined) {
        cursor.ry = props.ry
        cursor.x = cursor.rx
        cursor.y = cursor.ry
      }
      cursor.x += props.x ?? 0
      cursor.y += props.y ?? 0
      size = { w: props.w ?? size.w, h: props.h ?? size.h }
    }
    cursor.y += 1
    cursor.x = cursor.rx
  }
  return keys
}

/** 回転を含めた、図全体の大きさ（1u 単位） */
export function bounds(keys: PlacedKey[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const key of keys) {
    const angle = (key.r * Math.PI) / 180
    for (const [cx, cy] of [
      [key.x, key.y],
      [key.x + key.w, key.y],
      [key.x, key.y + key.h],
      [key.x + key.w, key.y + key.h],
    ]) {
      const dx = cx - key.rx
      const dy = cy - key.ry
      xs.push(key.rx + dx * Math.cos(angle) - dy * Math.sin(angle))
      ys.push(key.ry + dx * Math.sin(angle) + dy * Math.cos(angle))
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}
