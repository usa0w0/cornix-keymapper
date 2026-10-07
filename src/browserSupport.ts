// 本体との通信には WebHID が要る。対応しているのはデスクトップ版の Chrome と Edge だけ
export function isWebHidSupported(nav: object = navigator): boolean {
  return 'hid' in nav
}
