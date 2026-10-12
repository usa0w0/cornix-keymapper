import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { DeviceConnector } from './device/types.ts'
import { createVialConnector } from './device/vial/connect.ts'

// 使う機器の実装は、ここで選ぶ。URL に ?fake を付けると、実機の代わりに偽の機器を使う
async function chooseConnector(): Promise<DeviceConnector> {
  if (!new URLSearchParams(location.search).has('fake')) return createVialConnector()
  // 偽の機器は、使う時だけ読み込む
  const { createFakeCornix } = await import('./device/fake/cornix.ts')
  return createFakeCornix({ stepDelayMs: 150 })
}

// URL に ?design を付けると、画面デザインの試作（#22）を表示する。デザインが決まったら消す
async function chooseScreen() {
  // URL に ?picker を付けると、動作を選ぶ部品だけの見本を表示する。編集欄（#10）につないだら消す
  if (new URLSearchParams(location.search).has('picker')) {
    const { PickerPreview } = await import('./ui/PickerPreview.tsx')
    return <PickerPreview />
  }
  if (new URLSearchParams(location.search).has('design')) {
    const [{ Prototype }, { cornixSnapshot }] = await Promise.all([
      import('./prototype/Prototype.tsx'),
      import('./device/fake/cornix.ts'),
    ])
    return <Prototype snapshot={cornixSnapshot()} />
  }
  return <App connector={await chooseConnector()} />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{await chooseScreen()}</StrictMode>)
