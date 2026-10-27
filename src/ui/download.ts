/** 文字列をファイルとして保存させる（ブラウザーのダウンロード） */
export function downloadText(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/** 値を JSON のファイルとして保存させる（ブラウザーのダウンロード） */
export const downloadJson = (name: string, value: unknown): void => downloadText(name, JSON.stringify(value, null, 1))
