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

const JSX_ATTRIBUTE_PREFIX = new RegExp(`(?:${JSX_ATTRIBUTE_NAMES.join('|')})\\s*=\\s*(?:\\{\\s*)?$`)
const MESSAGE_PREFIXES = Object.freeze([
  { kind: 'throw-error', pattern: /throw\s+new\s+Error\(\s*$/ },
  { kind: 'crud-form-error', pattern: /createCrudFormError\(\s*$/ },
  { kind: 'raise-crud-error', pattern: /raiseCrudError\(\s*$/ },
  { kind: 'toast-call', pattern: /(?<![a-zA-Z_$])toast\.(?:error|success|warning|warn|info|message|loading)\(\s*$/ },
  { kind: 'flash-call', pattern: /(?<![a-zA-Z_$])flash(?:\.(?:error|success|warning|warn|info))?\(\s*$/ },
])

const TECHNICAL_TOKENS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRUE', 'FALSE', 'NULL', 'NaN', 'UTC'])
const TECHNICAL_PREFIXES = ['application/', 'text/', 'image/', 'multipart/', 'http://', 'https://', 'data:', 'mailto:', 'tel:', 'urn:', '/api/', './', '../']

function looksEnglishPhrase(value) {
  const trimmed = value.trim()
  if (trimmed.length < 4 || trimmed.startsWith('[internal]')) return false
  if (TECHNICAL_TOKENS.has(trimmed) || TECHNICAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return false
  if (/^[A-Z0-9_]+$/.test(trimmed)) return false
  if (/\.[a-z]+\.[a-z]+/.test(trimmed) && !/\s/.test(trimmed)) return false
  return (trimmed.match(/[A-Za-z]{2,}/g) ?? []).length >= 1 && /[a-z]/.test(trimmed)
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

function lineAndColumn(source, offset) {
  const lines = source.slice(0, offset).split('\n')
  return { line: lines.length, column: lines.at(-1).length + 1 }
}

function collectSyntaxFacts(source) {
  const strings = []
  const syntaxMask = [...source]
  let index = 0
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2)
      const stop = end === -1 ? source.length : end
      for (let cursor = index; cursor < stop; cursor += 1) syntaxMask[cursor] = ' '
      index = stop
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      for (let cursor = index; cursor < stop; cursor += 1) {
        if (syntaxMask[cursor] !== '\n') syntaxMask[cursor] = ' '
      }
      index = stop
      continue
    }
    const quote = source[index]
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      index += 1
      continue
    }
    const start = index
    index += 1
    let value = ''
    while (index < source.length) {
      if (source[index] === '\\') {
        value += source.slice(index, index + 2)
        syntaxMask[index] = ' '
        if (index + 1 < syntaxMask.length) syntaxMask[index + 1] = ' '
        index += 2
        continue
      }
      if (source[index] === quote) break
      value += source[index]
      if (syntaxMask[index] !== '\n') syntaxMask[index] = ' '
      index += 1
    }
    syntaxMask[start] = ' '
    if (index < source.length) syntaxMask[index] = ' '
    strings.push({ value, offset: start + 1, prefix: source.slice(Math.max(0, start - 200), start) })
    index += 1
  }
  return { strings, syntax: syntaxMask.join('') }
}

function scanSource(source, file) {
  const findings = []
  const facts = collectSyntaxFacts(source)
  for (const match of facts.syntax.matchAll(/>([^<>{}]+)</g)) {
    const value = match[1].trim()
    if (looksEnglishPhrase(value)) {
      findings.push({ kind: 'jsx-text', value, file, ...lineAndColumn(source, match.index + 1) })
    }
  }
  for (const literal of facts.strings) {
    if (!looksEnglishPhrase(literal.value)) continue
    const attributeMatch = JSX_ATTRIBUTE_PREFIX.exec(literal.prefix)
    if (attributeMatch) {
      findings.push({
        kind: 'jsx-attr',
        attribute: /([\w-]+)\s*=/.exec(attributeMatch[0])?.[1],
        value: literal.value,
        file,
        ...lineAndColumn(source, literal.offset),
      })
      continue
    }
    for (const definition of MESSAGE_PREFIXES) {
      if (!definition.pattern.test(literal.prefix)) continue
      findings.push({ kind: definition.kind, value: literal.value, file, ...lineAndColumn(source, literal.offset) })
      break
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
    const source = fs.readFileSync(absolutePath, 'utf8')
    for (const finding of scanSource(source, relativePath)) {
      if (isAllowlisted(finding, entries)) allowlisted += 1
      else findings.push(finding)
    }
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
