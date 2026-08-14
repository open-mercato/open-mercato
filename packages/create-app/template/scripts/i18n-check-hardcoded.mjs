import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const JSX_ATTRIBUTE_NAMES = [
  'label',
  'title',
  'placeholder',
  'description',
  'tooltip',
  'aria-label',
  'alt',
  'message',
  'subtitle',
  'helperText',
  'emptyMessage',
]

const JSX_TEXT_PATTERN = />\s*([A-Z][a-z]+(?:\s+[A-Za-z][a-zA-Z]*){1,}[.?!]?)\s*</g
const JSX_ATTRIBUTE_PATTERN = new RegExp(
  `(?:^|[\\s{(])(${JSX_ATTRIBUTE_NAMES.join('|')})\\s*=\\s*("([^"\\n]+)"|'([^'\\n]+)'|\\{\\s*("([^"\\n]+)"|'([^'\\n]+)')\\s*\\})`,
  'g',
)
const MESSAGE_PATTERNS = Object.freeze([
  { kind: 'throw-error', pattern: /throw\s+new\s+Error\(\s*(["'`])([^"'`\n]{2,})\1/g },
  { kind: 'crud-form-error', pattern: /createCrudFormError\(\s*(["'`])([^"'`\n]{2,})\1/g },
  { kind: 'raise-crud-error', pattern: /raiseCrudError\(\s*(["'`])([^"'`\n]{2,})\1/g },
  { kind: 'toast-call', pattern: /(?<![a-zA-Z_$])toast\.(?:error|success|warning|warn|info|message|loading)\(\s*(["'`])([^"'`\n]{2,})\1/g },
  { kind: 'flash-call', pattern: /(?<![a-zA-Z_$])flash(?:\.(?:error|success|warning|warn|info))?\(\s*(["'`])([^"'`\n]{2,})\1/g },
])

const TECHNICAL_TOKENS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRUE', 'FALSE', 'NULL', 'NaN', 'UTC'])
const TECHNICAL_PREFIXES = ['application/', 'text/', 'image/', 'multipart/', 'http://', 'https://', 'data:', 'mailto:', 'tel:', 'urn:', '/api/', './', '../']

function looksEnglishPhrase(value) {
  const trimmed = value.trim()
  if (trimmed.length < 4 || trimmed.startsWith('[internal]')) return false
  if (TECHNICAL_TOKENS.has(trimmed) || TECHNICAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return false
  if (/^[A-Z0-9_]+$/.test(trimmed) || /^[a-zA-Z][\w-]*$/.test(trimmed)) return false
  if (/\.[a-z]+\.[a-z]+/.test(trimmed) && !/\s/.test(trimmed)) return false
  return (trimmed.match(/[A-Za-z]{2,}/g) ?? []).length >= 2 && /[a-z]/.test(trimmed)
}

function collectSourceFiles(root) {
  const sourceRoot = path.join(root, 'src')
  if (!fs.existsSync(sourceRoot)) return []
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.mercato' || entry.name === 'i18n') continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolutePath)
      else if (
        entry.isFile()
        && /\.(?:ts|tsx)$/.test(entry.name)
        && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
        && !absolutePath.split(path.sep).some((segment) => segment === '__tests__' || segment === '__integration__')
      ) files.push(absolutePath)
    }
  }
  visit(sourceRoot)
  return files.sort()
}

function scanLine(line, file, lineNumber) {
  const findings = []
  for (const match of line.matchAll(JSX_TEXT_PATTERN)) {
    const value = match[1].trim()
    if (looksEnglishPhrase(value)) findings.push({ kind: 'jsx-text', value, file, line: lineNumber, column: match.index + 1 })
  }
  for (const match of line.matchAll(JSX_ATTRIBUTE_PATTERN)) {
    const value = match[3] ?? match[4] ?? match[6] ?? match[7]
    if (value && looksEnglishPhrase(value)) {
      findings.push({ kind: 'jsx-attr', attribute: match[1], value, file, line: lineNumber, column: match.index + 1 })
    }
  }
  for (const definition of MESSAGE_PATTERNS) {
    for (const match of line.matchAll(definition.pattern)) {
      const value = match[2]
      if (looksEnglishPhrase(value)) findings.push({ kind: definition.kind, value, file, line: lineNumber, column: match.index + 1 })
    }
  }
  return findings
}

function findAllowlist(root, relativePath) {
  const match = relativePath.match(/^src\/modules\/([^/]+)\//)
  if (!match) return null
  const candidate = path.join(root, 'src', 'modules', match[1], 'i18n', '.hardcoded-allowlist.json')
  return fs.existsSync(candidate) ? candidate : null
}

function loadAllowlist(allowlistPath) {
  if (!allowlistPath) return []
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  return Array.isArray(parsed.entries) ? parsed.entries : []
}

function isAllowlisted(finding, entries) {
  return entries.some((entry) => {
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim().length === 0) return false
    if (entry.file && !finding.file.endsWith(entry.file)) return false
    if (entry.line && finding.line !== entry.line) return false
    if (entry.kind && finding.kind !== entry.kind) return false
    if (entry.match && !finding.value.includes(entry.match)) return false
    return Boolean(entry.file || entry.line || entry.kind || entry.match)
  })
}

export function scanHardcodedI18n(root = process.cwd()) {
  const normalizedRoot = path.resolve(root)
  const files = collectSourceFiles(normalizedRoot)
  const findings = []
  const allowlistCache = new Map()
  const errors = []
  let allowlisted = 0
  for (const absolutePath of files) {
    const relativePath = path.relative(normalizedRoot, absolutePath).split(path.sep).join('/')
    const allowlistPath = findAllowlist(normalizedRoot, relativePath)
    if (!allowlistCache.has(allowlistPath)) {
      try {
        allowlistCache.set(allowlistPath, loadAllowlist(allowlistPath))
      } catch (error) {
        errors.push(`${path.relative(normalizedRoot, allowlistPath)}: ${error.message}`)
        allowlistCache.set(allowlistPath, [])
      }
    }
    const entries = allowlistCache.get(allowlistPath)
    const lines = fs.readFileSync(absolutePath, 'utf8').split('\n')
    lines.forEach((line, index) => {
      for (const finding of scanLine(line, relativePath, index + 1)) {
        if (isAllowlisted(finding, entries)) allowlisted += 1
        else findings.push(finding)
      }
    })
  }
  return { advisory: true, filesScanned: files.length, findings, allowlisted, errors }
}

function runCli() {
  const json = process.argv.slice(2).includes('--json')
  const result = scanHardcodedI18n()
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.findings.length > 0) {
    process.stderr.write(`[i18n:check-hardcoded] advisory: ${result.findings.length} findings in ${result.filesScanned} files.\n`)
    if (!json) {
      for (const finding of result.findings) {
        process.stderr.write(`${finding.file}:${finding.line}:${finding.column} [${finding.kind}] ${JSON.stringify(finding.value)}\n`)
      }
    }
  } else if (!json) {
    process.stdout.write(`[i18n:check-hardcoded] ${result.filesScanned} files passed.\n`)
  }
  for (const error of result.errors) process.stderr.write(`[i18n:check-hardcoded] ${error}\n`)
  process.exitCode = result.errors.length > 0 ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
