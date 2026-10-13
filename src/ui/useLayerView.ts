import { useState } from 'react'
import type { Legend } from '../model/action.ts'

/** 開いているレイヤーと刻印。キーマップのタブとコンボのタブで、同じものを使う */
export interface LayerView {
  layer: number
  legend: Legend
  setLayer: (layer: number) => void
  setLegend: (legend: Legend) => void
}

export function useLayerView(): LayerView {
  const [layer, setLayer] = useState(0)
  const [legend, setLegend] = useState<Legend>('us')
  return { layer, legend, setLayer, setLegend }
}
