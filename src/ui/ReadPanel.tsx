import { useState } from 'react'
import {
  type KeyboardDevice,
  type KeyboardSnapshot,
  type ReadProgress,
} from '../device/types.ts'
import {
  buildReadReport,
  countDifferences,
  describeReadError,
  hex16,
  type ReadReport,
} from './readReport.ts'

type ReadState =
  | { status: 'idle' }
  | { status: 'reading'; progress: ReadProgress | null }
  | { status: 'failed'; message: string }
  | { status: 'done'; report: ReadReport }

/** 本体の設定を読み出し、生の値のまま表示する（読み出しだけの最小版） */
export function ReadPanel({ device }: { device: KeyboardDevice }) {
  const [state, setState] = useState<ReadState>({ status: 'idle' })
  const [previous, setPrevious] = useState<KeyboardSnapshot | null>(null)
  const [copied, setCopied] = useState(false)

  const read = async () => {
    setCopied(false)
    setState({ status: 'reading', progress: null })
    const before = device.exchanges().length
    try {
      const snapshot = await device.read((progress) => setState({ status: 'reading', progress }))
      const report = buildReadReport({
        readAt: new Date(),
        userAgent: navigator.userAgent,
        device: { name: device.name, protocol: device.protocol },
        snapshot,
        differencesFromPrevious: previous && countDifferences(previous, snapshot),
        exchanges: device.exchanges().slice(before),
      })
      setPrevious(snapshot)
      setState({ status: 'done', report })
    } catch (error) {
      // 読みかけの内容は出さない
      setState({ status: 'failed', message: describeReadError(error) })
    }
  }

  const copy = async (report: ReadReport) => {
    await navigator.clipboard.writeText(JSON.stringify(report))
    setCopied(true)
  }

  const save = (report: ReadReport) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `cornix-read-${report.readAt.replace(/[:.]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="read" aria-label="読み出し">
      <div className="read-actions">
        <button type="button" onClick={read} disabled={state.status === 'reading'}>
          {state.status === 'done' ? 'もう一度読み出して比べる' : state.status === 'failed' ? 'もう一度読み出す' : '読み出す'}
        </button>
        {state.status === 'done' && (
          <>
            <button type="button" onClick={() => save(state.report)}>
              結果をファイルに保存
            </button>
            <button type="button" onClick={() => copy(state.report)}>
              結果をコピー
            </button>
            {copied && <span>コピーしました</span>}
          </>
        )}
      </div>
      {state.status === 'reading' && (
        <p aria-live="polite">
          読み出し中…{' '}
          {state.progress && `${state.progress.step}（${state.progress.done} / ${state.progress.total}）`}
        </p>
      )}
      {state.status === 'failed' && (
        <p className="notice" role="alert">
          読み出しに失敗しました。{state.message}
        </p>
      )}
      {state.status === 'done' && <ReadResult report={state.report} />}
    </section>
  )
}

export function ReadResult({ report }: { report: ReadReport }) {
  const { snapshot, stats, differencesFromPrevious } = report
  const { layout, capabilities } = snapshot
  return (
    <>
      {differencesFromPrevious !== null && (
        <p className={differencesFromPrevious === 0 ? 'ok' : 'notice'} role="status">
          {differencesFromPrevious === 0
            ? '前回の読み出しと一致しました。'
            : `前回の読み出しと ${differencesFromPrevious} か所が違います。本体の設定を変えていないのに違う場合は、読み出しがずれています。`}
        </p>
      )}
      <table className="summary">
        <tbody>
          <Row label="UID" value={snapshot.uid} />
          <Row label="VIA の版 / Vial の版" value={`${capabilities.viaProtocol} / ${capabilities.vialProtocol}`} />
          <Row label="レイヤー数" value={capabilities.layerCount} />
          <Row label="行列の大きさ" value={`${layout.rows} 行 × ${layout.cols} 列`} />
          <Row label="エンコーダーの数" value={layout.encoderCount} />
          <Row label="Tap Dance の枠数" value={capabilities.tapDanceCount} />
          <Row label="Combo の枠数" value={capabilities.comboCount} />
          <Row
            label="通信"
            value={`${stats.count} 回、合計 ${(stats.totalMs / 1000).toFixed(1)} 秒、平均 ${stats.averageMs} ミリ秒、最長 ${stats.maxMs} ミリ秒、タイムアウト ${stats.timeouts} 回`}
          />
        </tbody>
      </table>

      {snapshot.keymap.map((keys, layer) => (
        <details key={layer} open={layer === 0}>
          <summary>キーマップ: レイヤー {layer}</summary>
          <table className="raw">
            <tbody>
              {Array.from({ length: layout.rows }, (_, row) => (
                <tr key={row}>
                  <th scope="row">行 {row}</th>
                  {keys.slice(row * layout.cols, (row + 1) * layout.cols).map((code, col) => (
                    <td key={col}>{hex16(code)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}

      <details>
        <summary>エンコーダー（{layout.encoderCount} 個）</summary>
        <table className="raw">
          <tbody>
            {snapshot.encoders.map((row, layer) => (
              <tr key={layer}>
                <th scope="row">レイヤー {layer}</th>
                {row.map(([left, right], index) => (
                  <td key={index}>
                    左回し {hex16(left)} / 右回し {hex16(right)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details>
        <summary>Tap Dance（{snapshot.tapDances.length} 枠）</summary>
        <table className="raw">
          <thead>
            <tr>
              <th>枠</th>
              <th>タップ</th>
              <th>長押し</th>
              <th>2回タップ</th>
              <th>タップ後長押し</th>
              <th>時間（ミリ秒）</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.tapDances.map((entry, index) => (
              <tr key={index}>
                <th scope="row">{index}</th>
                <td>{hex16(entry.onTap)}</td>
                <td>{hex16(entry.onHold)}</td>
                <td>{hex16(entry.onDoubleTap)}</td>
                <td>{hex16(entry.onTapHold)}</td>
                <td>{entry.tappingTerm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details>
        <summary>Combo（{snapshot.combos.length} 枠）</summary>
        <table className="raw">
          <thead>
            <tr>
              <th>枠</th>
              <th colSpan={4}>同時に押すキー</th>
              <th>出力</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.combos.map((entry, index) => (
              <tr key={index}>
                <th scope="row">{index}</th>
                {entry.keys.map((code, i) => (
                  <td key={i}>{hex16(code)}</td>
                ))}
                <td>{hex16(entry.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details>
        <summary>レイアウト定義</summary>
        <pre>{JSON.stringify(layout.raw, null, 1)}</pre>
      </details>
    </>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{value}</td>
    </tr>
  )
}
