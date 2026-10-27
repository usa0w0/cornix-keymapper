import type { Ref } from 'react'
import type { KeyboardDevice } from '../device/types.ts'
import { deviceInfoRows } from './deviceInfo.ts'
import { Diagnostics } from './Diagnostics.tsx'
import type { ReadReport } from './readReport.ts'

interface Props {
  /** 開く時は、この ref の showModal を呼ぶ */
  ref: Ref<HTMLDialogElement>
  device: KeyboardDevice
  report: ReadReport
  onReport: (report: ReadReport) => void
}

/** 本体の情報（対応機能と枠数）のダイアログ。ヘッダーの「接続済み: Cornix ▾」から開く */
export function DeviceInfoDialog({ ref, device, report, onReport }: Props) {
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="device-info-title">
      <h2 id="device-info-title">接続中のキーボード</h2>
      <table className="info">
        <tbody>
          {deviceInfoRows(device, report.snapshot).map(({ label, value }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Diagnostics device={device} report={report} onReport={onReport} />
      <form method="dialog" className="dialog-actions">
        <button type="submit" className="primary">
          閉じる
        </button>
      </form>
    </dialog>
  )
}
