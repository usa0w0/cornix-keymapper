import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { DeviceConnector } from './device/types.ts'
import type { DebugTools } from './ui/DebugEditPanel.tsx'
import { createVialConnector } from './device/vial/connect.ts'

// 使う機器の実装は、ここで選ぶ。URL に ?fake を付けると、実機の代わりに偽の機器を使う
async function chooseConnector(): Promise<{ connector: DeviceConnector; debug?: DebugTools }> {
  const query = new URLSearchParams(location.search)
  if (!query.has('fake')) return { connector: createVialConnector() }
  // 偽の機器は、使う時だけ読み込む
  const [{ createFakeCornix }, { failuresFromQuery }] = await Promise.all([
    import('./device/fake/cornix.ts'),
    import('./device/fake/fakeDevice.ts'),
  ])
  // ?fake&failRead=1 で、1回目の読み出しを失敗させる（読み出しの失敗の画面を確かめるため）
  const keyboard = createFakeCornix({ stepDelayMs: 150, failures: failuresFromQuery(query) })
  // ?fake&debugEdit で、編集がある時の画面を確かめる仮の入口を出す。編集欄（#10）ができたら消す
  if (!query.has('debugEdit')) return { connector: keyboard }
  let changes = 0
  const debug: DebugTools = {
    loseConnection: () => keyboard.loseConnection(),
    // レイヤー 1 の最初のキーを、押すたびに違うキー（A、B、…）にする
    alterDevice: () => (keyboard.snapshot.keymap[1][0] = 0x04 + (changes++ % 26)),
    switchDevice: () => (keyboard.snapshot.uid = `${keyboard.snapshot.uid}-${++changes}`),
  }
  return { connector: keyboard, debug }
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
  return <App {...await chooseConnector()} />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{await chooseScreen()}</StrictMode>)
