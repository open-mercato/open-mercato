const ENTRY_START = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?(?: [A-Z+\-0-9]+)?) \[(\d+)\]\s?(.*)$/
const MAX_TEXT = 8000

export function splitLogEntries(text) {
  const entries = []
  let current = null
  for (const line of String(text).split(/\r?\n/)) {
    const match = ENTRY_START.exec(line)
    if (match) {
      if (current) entries.push(current)
      current = { at: match[1], pid: Number(match[2]), lines: [match[3]] }
    } else if (current && line.length) {
      current.lines.push(line)
    }
  }
  if (current) entries.push(current)
  return entries
}

function messageOf(entry) {
  const head = entry.lines[0]
  const levelMatch = /(LOG|ERROR|WARNING|FATAL|DETAIL|STATEMENT|HINT|CONTEXT):\s+(.*)$/.exec(head)
  return levelMatch ? { level: levelMatch[1], text: levelMatch[2] } : { level: '', text: head }
}

function bodyOf(entry) {
  return entry.lines.slice(1).filter((line) => !/^\s*(DETAIL|Query Parameters):/i.test(line.replace(/^.*?(DETAIL:|Query Parameters:)/, '$1'))).join('\n')
}

function truncate(text) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(truncated)` : text
}

export function parsePostgresLog(text) {
  const result = { autoExplain: [], slowStatements: [], lockWaits: [], tempFiles: [], deadlocks: 0, errors: 0 }
  for (const entry of splitLogEntries(text)) {
    const { level, text: message } = messageOf(entry)
    const duration = /duration: ([\d.]+) ms\s+(plan|statement|execute[^:]*):\s*(.*)$/.exec(message)
    if (duration && duration[2] === 'plan') {
      result.autoExplain.push({ at: entry.at, durationMs: Number(duration[1]), plan: truncate(entry.lines.slice(1).filter((line) => !/Query Parameters:/.test(line)).join('\n')) })
    } else if (duration) {
      result.slowStatements.push({ at: entry.at, durationMs: Number(duration[1]), statement: truncate(`${duration[3]}${entry.lines.length > 1 ? `\n${bodyOf(entry)}` : ''}`.trim()) })
    } else if (/still waiting for|acquired .* after/.test(message)) {
      const waited = /after ([\d.]+) ms/.exec(message)
      result.lockWaits.push({ at: entry.at, waitedMs: waited ? Number(waited[1]) : null, message: truncate(message) })
    } else if (/^temporary file:/.test(message)) {
      const size = /size (\d+)/.exec(message)
      result.tempFiles.push({ at: entry.at, bytes: size ? Number(size[1]) : null })
    } else if (/deadlock detected/.test(message)) {
      result.deadlocks += 1
    } else if (level === 'ERROR' || level === 'FATAL') {
      result.errors += 1
    }
  }
  result.autoExplain.sort((left, right) => right.durationMs - left.durationMs)
  result.slowStatements.sort((left, right) => right.durationMs - left.durationMs)
  return result
}

export function groupSlowStatements(slowStatements, limit = 10) {
  const groups = new Map()
  for (const entry of slowStatements) {
    const key = entry.statement.split('\n')[0].replace(/\$\d+/g, '?').replace(/\s+/g, ' ').slice(0, 300)
    const group = groups.get(key) ?? { statement: key, count: 0, maxMs: 0, totalMs: 0 }
    group.count += 1
    group.totalMs += entry.durationMs
    group.maxMs = Math.max(group.maxMs, entry.durationMs)
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => right.totalMs - left.totalMs).slice(0, limit)
}

export function isExplainableSelect(query) {
  const text = String(query).trim().replace(/^\/\*[\s\S]*?\*\/\s*/, '')
  if (!/^(select|with)\b/i.test(text)) return false
  if (/\b(insert|update|delete|merge|truncate|copy|lock|for\s+update|for\s+share)\b/i.test(text)) return false
  if (/;\s*\S/.test(text)) return false
  return true
}
