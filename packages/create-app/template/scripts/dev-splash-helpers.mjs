import fs from 'node:fs'

export function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

export function formatMemory(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'pending'
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

export function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function shortenPackageName(name) {
  if (name.startsWith('@open-mercato/')) {
    return name.slice('@open-mercato/'.length)
  }
  return name
}

export function wrapListLines(label, items, maxWidth = 58) {
  if (!Array.isArray(items) || items.length === 0) {
    return [` ${label}: pending`]
  }

  const lines = []
  let current = ` ${label}:`

  for (const item of items) {
    const token = current.endsWith(':') ? ` ${item}` : `, ${item}`
    if ((current + token).length > maxWidth && !current.endsWith(':')) {
      lines.push(current)
      current = `   ${item}`
      continue
    }
    current += token
  }

  lines.push(current)
  return lines
}

export function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function resolveProgressPercent(current, total, explicitPercent) {
  if (Number.isFinite(explicitPercent)) {
    return clampPercent(explicitPercent)
  }

  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return 0
  }

  return clampPercent((current / total) * 100)
}

export function formatProgressBar(percent, width = 18) {
  const filled = Math.max(0, Math.min(width, Math.round((clampPercent(percent) / 100) * width)))
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
}

export function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function hasEmojiPrefix(value) {
  return /^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(String(value ?? '').trim())
}

export function decorateActivityMessage(message) {
  const plain = String(message ?? '').trim()
  if (!plain) return plain
  if (hasEmojiPrefix(plain)) return plain

  if (/splash page/i.test(plain)) return `🪟 ${plain}`
  if (/package/i.test(plain)) return `📦 ${plain}`
  if (/build/i.test(plain)) return `🧱 ${plain}`
  if (/generate|artifact/i.test(plain)) return `♻️ ${plain}`
  if (/watch/i.test(plain)) return `👀 ${plain}`
  if (/ready|login/i.test(plain)) return `🌐 ${plain}`
  if (/queue|scheduler|background/i.test(plain)) return `⚙️ ${plain}`
  if (/memory/i.test(plain)) return `🧠 ${plain}`
  if (/encrypt/i.test(plain)) return `🔐 ${plain}`
  if (/compile/i.test(plain)) return `🛠️ ${plain}`
  if (/warn|port/i.test(plain)) return `⚠️ ${plain}`
  return `✨ ${plain}`
}

function appendLines(target, chunk, onLine) {
  target.value += chunk

  while (true) {
    const newlineIndex = target.value.indexOf('\n')
    if (newlineIndex === -1) break

    const rawLine = target.value.slice(0, newlineIndex).replace(/\r$/, '')
    target.value = target.value.slice(newlineIndex + 1)
    onLine(rawLine)
  }
}

export function connectLineStream(stream, onLine) {
  if (!stream) return

  const state = { value: '' }
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => appendLines(state, chunk, onLine))
  stream.on('end', () => {
    const trailing = state.value.replace(/\r$/, '')
    if (trailing.length > 0) {
      onLine(trailing)
    }
  })
}
