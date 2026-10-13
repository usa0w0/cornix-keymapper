import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { DeviceConnector } from './device/types.ts'
import { createVialConnector } from './device/vial/connect.ts'

// 使う機器の実装は、ここで選ぶ。URL に ?fake を付けると、実機の代わりに偽の機器を使う
async function chooseConnector(): Promise<DeviceConnector> {
  const query = new URLSearchParams(location.search)
  if (!query.has('fake')) return createVialConnector()
  // 偽の機器は、使う時だけ読み込む
  const [{ createFakeCornix }, { failuresFromQuery }] = await Promise.all([
    import('./device/fake/cornix.ts'),
    import('./device/fake/fakeDevice.ts'),
  ])
  // ?fake&failRead=1 で、1回目の読み出しを失敗させる（読み出しの失敗の画面を確かめるため）
  const keyboard = createFakeCornix({ stepDelayMs: 150, failures: failuresFromQuery(query) })
  // 偽の機器は、開発者ツールのコンソールから操作できるようにする（画面には入口を出さない）。
  // 接続を切る: fakeKeyboard.loseConnection()、中身を書き換える・別の機器にする: fakeKeyboard.snapshot を書き換える
  Object.assign(window, { fakeKeyboard: keyboard })
  return keyboard
}

// URL に ?design を付けると、画面デザインの試作（#22）を表示する。デザインが決まったら消す
async function chooseScreen() {
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
