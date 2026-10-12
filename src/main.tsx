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

const connector = await chooseConnector()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App connector={connector} />
  </StrictMode>,
)
