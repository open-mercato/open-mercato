// Folded setup output hides `mercato init`; this pulls back the part the
// operator must see — the credentials panel (or the legacy ╔ box) on a first
// run, or the "already initialized" notice on a re-run. Mirrors
// extractInitSummaryLines in scripts/dev-orchestration-log-policy.mjs; the
// starter is published build-free, so it cannot import repo scripts.

const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g
const BOX_CHARS = /[╔║╠╚]/

const stripAnsi = (value) => String(value ?? '').replace(ANSI_PATTERN, '')

function sliceVisibleColumns(line, column) {
  let offset = 0
  let visible = 0
  while (visible < column && offset < line.length) {
    const escape = line.slice(offset).match(/^\u001b\[[0-9;]*m/)
    if (escape) offset += escape[0].length
    else {
      offset += 1
      visible += 1
    }
  }
  return line.slice(offset).replace(/^(?:\u001b\[0m)+/, '')
}

function extractPanel(lines) {
  const plain = lines.map(stripAnsi)
  for (let heading = plain.length - 1; heading > 1; heading -= 1) {
    if (!plain[heading].includes('  🔑 ')) continue
    const start = heading - 2
    const column = plain[start].indexOf('━')
    if (column < 0 || !/^━+\s*$/.test(plain[start].slice(column))) continue
    const rule = plain[start].slice(column).trim()
    const end = plain.findIndex((line, index) => index > heading && line.slice(column).trim() === rule)
    if (end === -1) return []
    return lines.slice(start, end + 1).map((line) => sliceVisibleColumns(line, column))
  }
  return []
}

function extractBox(lines) {
  const plain = lines.map((line) => stripAnsi(line).replace(/\s+$/, ''))
  const start = plain.findLastIndex((line) => line.includes('╔'))
  if (start === -1) return []
  const box = []
  for (const line of plain.slice(start)) {
    const column = line.search(BOX_CHARS)
    if (column === -1) return []
    box.push(line.slice(column))
    if (line.includes('╚')) return box
  }
  return []
}

export function extractInitSummaryLines(lines) {
  if (!Array.isArray(lines)) return []
  const panel = extractPanel(lines)
  if (panel.length > 0) return panel
  const box = extractBox(lines)
  if (box.length > 0) return box
  const kept = lines.map((line) => stripAnsi(line).trim()).find((line) => line.includes('Database already initialized'))
  return kept ? [kept] : []
}
