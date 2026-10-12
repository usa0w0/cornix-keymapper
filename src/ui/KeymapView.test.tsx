import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { KeyboardSnapshot } from '../device/types.ts'
import recorded from '../device/fixtures/cornix/usb.json'
import { loadSnapshot } from '../session/editState.ts'
import { KeyFace } from './KeyboardFigure.tsx'
import { KeymapView } from './KeymapView.tsx'

// 実機（Cornix LP）から読んだ設定
const cornix = recorded.snapshot as unknown as KeyboardSnapshot

const count = (html: string, needle: string) => html.split(needle).length - 1

test('レイヤーの行と、レイアウト定義どおりの数のキーとエンコーダーを出す', () => {
  const html = renderToStaticMarkup(<KeymapView state={loadSnapshot(cornix)} onAction={() => {}} />)
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
  expect(html).toContain('aria-label="行 0・列 1 のキー: Q"')
  // キーは押して選べる。エンコーダーは、まだ選べない。最初は、どのキーも選ばれていない
  expect(count(html, '<button type="button" class="key state-')).toBe(50)
  expect(html).not.toMatch(/class="key [^"]*"[^>]*aria-pressed="true"/)
  expect(html).toContain('キーをクリックすると、ここで動作を変えられます。')
})

test('実機の設定: Tap Dance とレイヤー切り替えのキーを、タップを大きく、長押しを印つきで小さく出す', () => {
  const html = renderToStaticMarkup(<KeymapView state={loadSnapshot(cornix)} onAction={() => {}} />)
  const figure = html.slice(html.indexOf('class="figure"'), html.indexOf('class="legend"'))
  // Tap Dance の2つ。番号は出さない
  expect(figure).toContain('aria-label="行 3・列 5 のキー: タップ: Space ／ 長押し: 左 GUI（Cmd / Win）"')
  expect(figure).toContain(
    '<span class="face-main"><b class="">Space</b></span><span class="face-extra"><i>長押し</i>GUI</span>',
  )
  expect(figure).toContain('aria-label="行 7・列 5 のキー: タップ: B ／ 長押し: 右 GUI（Cmd / Win）"')
  expect(figure).toContain('<span class="face-main"><b class="">B</b></span><span class="face-extra"><i>長押し</i>GUI</span>')
  expect(figure).not.toContain('Tap Dance')
  // MO(2) は長押しだけのキーとして、印を付けて大きく出す。OSL(1) はタップ
  expect(figure).toContain('aria-label="行 3・列 3 のキー: 長押し: 押している間だけレイヤー 2"')
  expect(figure).toContain('<span class="face-main"><i>長押し</i><b class="long">レイヤー 2</b><small>押している間</small></span>')
  expect(figure).toContain('aria-label="行 7・列 4 のキー: 次の1キーだけレイヤー 1"')
  expect(figure).toContain('<span class="face-main"><b class="long">レイヤー 1</b><small>次の1キー</small></span>')
  // 編集不可のキーは、このレイヤーにはない
  expect(figure).not.toContain('state-locked')
})

test('4欄とも入ったキーは、長押し・2回タップ・タップ後長押しを、印つきで小さく出す', () => {
  const html = renderToStaticMarkup(
    <KeyFace
      view={{
        state: 'normal',
        slots: {
          tap: { short: 'A', full: 'A' },
          hold: { short: 'Ctrl', full: '左 Ctrl' },
          doubleTap: { short: 'Esc', full: 'Esc' },
          tapHold: { short: 'Shift', full: '左 Shift' },
        },
      }}
    />,
  )
  expect(html).toBe(
    '<span class="face-main"><b class="">A</b></span>' +
      '<span class="face-extra"><i>長押し</i>Ctrl</span>' +
      '<span class="face-extra"><i>2回</i>Esc</span>' +
      '<span class="face-extra"><i>2回長</i>Shift</span>',
  )
})

test('タップのないキーは、最初の欄を印つきで大きく出し、Shift で出る字は添えない', () => {
  const html = renderToStaticMarkup(
    <KeyFace
      view={{
        state: 'normal',
        slots: { doubleTap: { short: '2', full: '2', shifted: '@' }, tapHold: { short: 'Esc', full: 'Esc' } },
      }}
    />,
  )
  expect(html).toBe(
    '<span class="face-main"><i>2回</i><b class="">2</b></span><span class="face-extra"><i>2回長</i>Esc</span>',
  )
})

test('キーの位置を読み取れない時は、図の代わりにその旨を出す', () => {
  const html = renderToStaticMarkup(<KeymapView state={loadSnapshot({ ...cornix, layout: { ...cornix.layout, raw: {} } })} onAction={() => {}} />)
  expect(html).toContain('キーの位置を読み取れませんでした')
  expect(html).not.toContain('class="figure"')
})

test('透過キーは、下のレイヤーで効く動作と「透過」の印を出す', () => {
  const html = renderToStaticMarkup(
    <KeyFace
      view={{
        state: 'transparent',
        slots: { tap: { short: '透過', full: '透過' } },
        inherited: { layer: 0, state: 'normal', slots: { tap: { short: '2', full: '2', shifted: '@' } } },
      }}
    />,
  )
  expect(html).toContain('<span class="mark-transparent">透過</span>')
  expect(html).toContain('<b class="">2</b>')
  expect(html).toContain('@')
})

test('下のレイヤーに効く動作がない透過キーは、「透過」の印だけを出す', () => {
  const html = renderToStaticMarkup(<KeyFace view={{ state: 'transparent', slots: { tap: { short: '透過', full: '透過' } } }} />)
  expect(html).toBe('<span class="mark-transparent">透過</span>')
})

test('編集不可のキーは、鍵の印と名前を出し、長い名前は小さな字にする', () => {
  const html = renderToStaticMarkup(<KeyFace view={{ state: 'locked', slots: { tap: { short: 'Tap Dance 0', full: 'Tap Dance 0' } } }} />)
  expect(html).toContain('mark-locked')
  expect(html).toContain('<b class="long">Tap Dance 0</b>')
})
