import fs from 'node:fs'

// Dotenv helpers shared by the starter scripts. Files are always written as
// UTF-8 without BOM with LF endings — some compose dotenv parsers choke on a
// BOM, and CRLF would leak into container env values.

export function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return null
  const content = fs.readFileSync(filePath, 'utf8')
  const pattern = new RegExp(`^${escapeRegExp(key)}=(.*)$`, 'm')
  const match = content.match(pattern)
  if (!match) return null
  return match[1].replace(/\r$/, '')
}

// Fill-missing-only by default: an existing non-empty value is never
// overwritten, so re-running an installer never rotates secrets. With
// `replaceEmpty`, a bare `KEY=` placeholder line is filled in place.
export function addEnvValue(filePath, key, value, { replaceEmpty = false } = {}) {
  const existing = readEnvValue(filePath, key)
  if (existing !== null) {
    if (!(replaceEmpty && existing.trim() === '')) return false
    const content = fs.readFileSync(filePath, 'utf8')
    const pattern = new RegExp(`^${escapeRegExp(key)}=[ \\t]*\r?$`, 'm')
    writeEnvFileText(filePath, content.replace(pattern, `${key}=${value}`))
    return true
  }
  let prefix = ''
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8')
    if (raw.length > 0 && !raw.endsWith('\n')) prefix = '\n'
  }
  fs.appendFileSync(filePath, `${prefix}${key}=${value}\n`)
  return true
}

export function replaceEnvLine(content, key, value) {
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
  if (!pattern.test(content)) return content
  return content.replace(pattern, `${key}=${value}`)
}

export function uncommentEnvLine(content, key, value) {
  const pattern = new RegExp(`^#[ \\t]*${escapeRegExp(key)}=.*$`, 'm')
  if (!pattern.test(content)) return content
  return content.replace(pattern, `${key}=${value}`)
}

export function writeEnvFileText(filePath, content) {
  fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n'))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
