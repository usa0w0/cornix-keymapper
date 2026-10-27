// メモリ上の偽の保存先。localStorage の代わりに渡して、保存の失敗をわざと起こせる。テスト用
import type { KeyValueStore } from './backup.ts'

export interface FakeStore extends KeyValueStore {
  /** 中身。テストから直接、読み書きできる（壊れた内容を入れる、など） */
  readonly items: Map<string, string>
  /** 容量の上限（鍵と値の文字数の合計）。超える setItem は、本物と同じ名前の失敗（QuotaExceededError）になる */
  quota: number
  /** true の間、どの操作も失敗する（ブラウザーの設定で localStorage が使えない時） */
  blocked: boolean
  /** true の間、setItem は何も保存せずに、成功したように振る舞う */
  dropWrites: boolean
}

export function createFakeStore(initial: Record<string, string> = {}): FakeStore {
  const items = new Map(Object.entries(initial))
  const check = () => {
    if (store.blocked) throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  const store: FakeStore = {
    items,
    quota: Infinity,
    blocked: false,
    dropWrites: false,
    getItem(key) {
      check()
      return items.get(key) ?? null
    },
    setItem(key, value) {
      check()
      if (store.dropWrites) return
      let size = key.length + value.length
      for (const [otherKey, other] of items) if (otherKey !== key) size += otherKey.length + other.length
      // 本物と同じく、失敗した時は、前の値が残る
      if (size > store.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      items.set(key, value)
    },
    removeItem(key) {
      check()
      items.delete(key)
    },
  }
  return store
}
