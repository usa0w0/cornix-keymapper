import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createVialConnector } from './device/vial/connect.ts'

// 使う機器の実装は、ここで選ぶ
const connector = createVialConnector()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App connector={connector} />
  </StrictMode>,
)
