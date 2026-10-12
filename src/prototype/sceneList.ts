// 画面デザインの試作（#22）で、見本として表示できる場面の一覧
export type SceneId =
  | 'normal'
  | 'disconnected'
  | 'reading'
  | 'read-failed'
  | 'lost'
  | 'unsupported'
  | 'no-slots'
  | 'shared'
  | 'device-changed'
  | 'unfinished'
  | 'backups'
  | 'vil-save'
  | 'vil-load'
  | 'vil-mismatch'
  | 'device-info'

export const SCENES: { id: SceneId; name: string }[] = [
  { id: 'normal', name: 'ふだんの画面' },
  { id: 'disconnected', name: '接続前' },
  { id: 'reading', name: '読み込み中' },
  { id: 'read-failed', name: '読み出しの失敗' },
  { id: 'lost', name: '接続が切れた' },
  { id: 'unsupported', name: '非対応ブラウザー' },
  { id: 'no-slots', name: '枠が足りない' },
  { id: 'shared', name: '共有中のキーの変更' },
  { id: 'device-changed', name: '本体の設定が変わっていた' },
  { id: 'unfinished', name: '前回の書き込みが未完了' },
  { id: 'backups', name: 'バックアップの一覧' },
  { id: 'vil-save', name: '.vil に保存' },
  { id: 'vil-load', name: '.vil を読み込んだ' },
  { id: 'vil-mismatch', name: '.vil を読み込めない' },
  { id: 'device-info', name: '本体の情報（対応機能）' },
]

export const isScene = (value: string | null): value is SceneId => SCENES.some((scene) => scene.id === value)
