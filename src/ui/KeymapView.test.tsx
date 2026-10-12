import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import { KeyFace } from './KeyboardFigure.tsx'
import { KeymapView } from './KeymapView.tsx'

// 実機（Cornix LP）から読んだ設定
const cornix = recorded.snapshot as unknown as KeyboardSnapshot

const count = (html: string, needle: string) => html.split(needle).length - 1

test('レイヤーの行と、レイアウト定義どおりの数のキーとエンコーダーを出す', () => {
  const html = renderToStaticMarkup(<KeymapView snapshot={cornix} />)
  // レイヤー 10 枚ぶんのボタン。最初はレイヤー 0 と、刻印の US が選ばれている
  for (let layer = 0; layer < 10; layer++) expect(html).toMatch(new RegExp(`<button[^>]*>${layer}</button>`))
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>0<\/button>/)
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>US<\/button>/)
  // 図の中のキー 50 個と、エンコーダー 2 個の左回し・右回し（凡例の見本は style を持たない）
  expect(count(html, 'class="key state-') - count(html, '<span class="key state-')).toBe(54)
  expect(count(html, 'encoder-left')).toBe(2)
  expect(count(html, 'encoder-right')).toBe(2)
  // キー1つぶんは 64px で、すき間が 4px
  expect(html).toContain('left:192px;top:0;width:60px;height:60px')
  // 場所と動作は、マウスを載せなくても読み上げられる名前として持つ
  expect(html).toContain('role="img" aria-label="エンコーダー 1 の左回し: マウスのホイールを上へ"')
  expect(html).toContain('role="img" aria-label="行 0・列 1 のキー: Q"')
})

test('キーの位置を読み取れない時は、図の代わりにその旨を出す', () => {
  const html = renderToStaticMarkup(<KeymapView snapshot={{ ...cornix, layout: { ...cornix.layout, raw: {} } }} />)
  expect(html).toContain('キーの位置を読み取れませんでした')
  expect(html).not.toContain('class="figure"')
})

test('透過キーは、下のレイヤーで効く動作と「透過」の印を出す', () => {
  const html = renderToStaticMarkup(
    <KeyFace
      view={{
        state: 'transparent',
        label: { short: '透過', full: '透過' },
        inherited: { layer: 0, state: 'normal', label: { short: '2', full: '2', shifted: '@' } },
      }}
    />,
  )
  expect(html).toContain('<span class="mark-transparent">透過</span>')
  expect(html).toContain('<b class="">2</b>')
  expect(html).toContain('@')
})

test('下のレイヤーに効く動作がない透過キーは、「透過」の印だけを出す', () => {
  const html = renderToStaticMarkup(<KeyFace view={{ state: 'transparent', label: { short: '透過', full: '透過' } }} />)
  expect(html).toBe('<span class="mark-transparent">透過</span>')
})

test('編集不可のキーは、鍵の印と名前を出し、長い名前は小さな字にする', () => {
  const html = renderToStaticMarkup(<KeyFace view={{ state: 'locked', label: { short: 'Tap Dance 0', full: 'Tap Dance 0' } }} />)
  expect(html).toContain('mark-locked')
  expect(html).toContain('<b class="long">Tap Dance 0</b>')
})
