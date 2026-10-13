import { useState } from 'react'
import type { KeyboardDevice } from '../device/types.ts'
import { describeReadError, hex16, type ReadFailure, type ReadReport } from './readReport.ts'
import { readReportFrom } from './useDeviceRead.ts'

interface Props {
  device: KeyboardDevice
  /** いま画面に出している読み出しの記録 */
  report: ReadReport
  /** 読み直した記録に入れ替える */
  onReport: (report: ReadReport) => void
}

/**
 * 実機での確認用の診断。もう一度読み出して前回と比べる、読み出しの記録（通信の記録を含む）を保存・コピーする、
 * 本体から読んだ生の値を見る。ふだんは使わないので、本体の情報のダイアログの中に、畳んで置く
 */
export function Diagnostics({ device, report, onReport }: Props) {
  const [rereading, setRereading] = useState(false)
  const [failure, setFailure] = useState<ReadFailure | null>(null)
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null)

  const reread = async () => {
    setCopied(null)
    setFailure(null)
    setRereading(true)
    try {
      onReport(await readReportFrom(device, report.snapshot))
    } catch (error) {
      // 読みかけの内容は出さず、前の読み出しの結果を残す
      setFailure(describeReadError(error))
    } finally {
      setRereading(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report))
      setCopied('done')
    } catch {
      // ブラウザーの設定や、ページにフォーカスがない時は、コピーできない
      setCopied('failed')
    }
  }

  const save = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `cornix-read-${report.readAt.replace(/[:.]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <details className="diagnostics">
      <summary>診断（実機での確認用）</summary>
      <div className="diagnostics-actions">
        <button type="button" onClick={reread} disabled={rereading}>
          {rereading ? '読み出し中…' : 'もう一度読み出して比べる'}
        </button>
        <button type="button" onClick={save}>
          結果をファイルに保存
        </button>
        <button type="button" onClick={copy}>
          結果をコピー
        </button>
        {copied && (
          <span role="status">
            {copied === 'done' ? 'コピーしました' : 'コピーできませんでした。「結果をファイルに保存」を使ってください'}
          </span>
        )}
      </div>
      {failure && (
        <p className="ng" role="alert">
          読み出しに失敗しました。{failure.cause}
          {failure.advice}
        </p>
      )}
      <ReadResult report={report} />
    </details>
  )
}

/** 本体から読んだ生の値の表 */
export function ReadResult({ report }: { report: ReadReport }) {
  const { snapshot, stats, differencesFromPrevious } = report
  const { layout, capabilities } = snapshot
  return (
    <>
      {differencesFromPrevious !== null && (
        <p className={differencesFromPrevious === 0 ? 'ok' : 'ng'} role="status">
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
            value={`${stats.count} 回、合計 ${(stats.totalMs / 1000).toFixed(1)} 秒、平均 ${stats.averageMs} ミリ秒、最長 ${stats.maxMs} ミリ秒、タイムアウト ${stats.timeouts} 回、捨てた応答 ${stats.strays} 回`}
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
