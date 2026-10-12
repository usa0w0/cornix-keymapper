// WebHID での機器選択と接続。USB と Bluetooth で同じ指定を使う
import { DeviceError, type DeviceConnector } from '../types.ts'
import { Transport, type HidDeviceLike } from './transport.ts'
import { VialDevice, type HidEvents, type RawHidDevice } from './vialDevice.ts'

// VIA / Vial の Raw HID インターフェース
const RAW_HID_USAGE_PAGE = 0xff60
const RAW_HID_USAGE = 0x61

const VIA_GET_PROTOCOL_VERSION = 0x01

type Collections = Pick<RawHidDevice, 'collections'>

function findRawHidCollection(device: Collections) {
  return device.collections.find(
    (c) => c.usagePage === RAW_HID_USAGE_PAGE && c.usage === RAW_HID_USAGE,
  )
}

/** Raw HID の出力レポートの ID。レポート ID を使わない機器は 0 */
export function findReportId(device: Collections): number {
  return findRawHidCollection(device)?.outputReports?.[0]?.reportId ?? 0
}

/** 機器を開き、VIA の応答が返ることを確かめる */
export async function openVialDevice(
  device: RawHidDevice & HidDeviceLike,
  hid: HidEvents,
): Promise<VialDevice> {
  if (!device.opened) await device.open()
  const transport = new Transport(device, { reportId: findReportId(device) })
  try {
    const response = await transport.request([VIA_GET_PROTOCOL_VERSION])
    // 応答の先頭は要求と同じコマンド番号。違えば、別の要求への応答か、VIA でない機器
    if (response[0] !== VIA_GET_PROTOCOL_VERSION) throw new DeviceError('unexpected-response')
    return new VialDevice(device, hid, transport, (response[1] << 8) | response[2])
  } catch (error) {
    transport.close()
    await device.close().catch(() => {})
    throw error
  }
}

/** WebHID で Vial の機器に接続する入口。getHid は、非対応ブラウザーでも作れるよう接続時に呼ぶ */
export function createVialConnector(getHid: () => HID = () => navigator.hid): DeviceConnector {
  return {
    async connect() {
      const hid = getHid()
      const devices = await hid.requestDevice({
        filters: [{ usagePage: RAW_HID_USAGE_PAGE, usage: RAW_HID_USAGE }],
      })
      const device = devices.find((d) => findRawHidCollection(d) !== undefined)
      if (!device) return null
      return openVialDevice(device, hid)
    },
  }
}
