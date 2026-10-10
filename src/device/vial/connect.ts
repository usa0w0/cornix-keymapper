// WebHID での機器選択と接続。USB と Bluetooth で同じ指定を使う
import { Transport } from './transport.ts'

// VIA / Vial の Raw HID インターフェース
const RAW_HID_USAGE_PAGE = 0xff60
const RAW_HID_USAGE = 0x61

const VIA_GET_PROTOCOL_VERSION = 0x01

export interface Connection {
  device: HIDDevice
  transport: Transport
  /** 接続の確認として読んだ VIA プロトコルの版 */
  viaProtocolVersion: number
}

/** ブラウザーの機器選択を開く。利用者が選ばずに閉じたら null。クリックなどの操作の中から呼ぶ */
export async function requestDevice(): Promise<HIDDevice | null> {
  const devices = await navigator.hid.requestDevice({
    filters: [{ usagePage: RAW_HID_USAGE_PAGE, usage: RAW_HID_USAGE }],
  })
  return devices.find(hasRawHidCollection) ?? null
}

function hasRawHidCollection(device: Pick<HIDDevice, 'collections'>): boolean {
  return findRawHidCollection(device) !== undefined
}

function findRawHidCollection(device: Pick<HIDDevice, 'collections'>) {
  return device.collections.find(
    (c) => c.usagePage === RAW_HID_USAGE_PAGE && c.usage === RAW_HID_USAGE,
  )
}

/** Raw HID の出力レポートの ID。レポート ID を使わない機器は 0 */
export function findReportId(device: Pick<HIDDevice, 'collections'>): number {
  return findRawHidCollection(device)?.outputReports?.[0]?.reportId ?? 0
}

/** 機器を開き、応答が返ることを確かめる */
export async function connect(device: HIDDevice): Promise<Connection> {
  if (!device.opened) await device.open()
  const transport = new Transport(device, { reportId: findReportId(device) })
  try {
    const response = await transport.request([VIA_GET_PROTOCOL_VERSION])
    return { device, transport, viaProtocolVersion: (response[1] << 8) | response[2] }
  } catch (error) {
    transport.close()
    await device.close().catch(() => {})
    throw error
  }
}

export async function disconnect(connection: Connection): Promise<void> {
  connection.transport.close()
  await connection.device.close()
}
