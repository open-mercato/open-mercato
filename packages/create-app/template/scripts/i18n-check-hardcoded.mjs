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
  if (!trimmed || trimmed.startsWith('[internal]')) return false
  if (TECHNICAL_TOKENS.has(trimmed) || TECHNICAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return false
  if (/\.[a-z]+\.[a-z]+/.test(trimmed) && !/\s/.test(trimmed)) return false
  return /[A-Za-z]{2,}/.test(trimmed)
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

function collectLexicalFacts(source) {
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
    let interpolated = false
    while (index < source.length) {
      if (source[index] === '\\') {
        value += source.slice(index, index + 2)
        syntaxMask[index] = ' '
        if (index + 1 < syntaxMask.length) syntaxMask[index + 1] = ' '
        index += 2
        continue
      }
      if (source[index] === quote) break
      if (quote === '`' && source.startsWith('${', index)) interpolated = true
      value += source[index]
      if (syntaxMask[index] !== '\n') syntaxMask[index] = ' '
      index += 1
    }
    syntaxMask[start] = ' '
    if (index < source.length) syntaxMask[index] = ' '
    strings.push({ value, start, end: Math.min(index + 1, source.length), offset: start + 1, interpolated })
    index += 1
  }
  return { strings, syntax: syntaxMask.join('') }
}

function collectJsxFacts(syntax) {
  const openingRanges = []
  const textRanges = []

  const readTag = (start) => {
    if (syntax.startsWith('</>', start)) return { name: '#fragment', closing: true, selfClosing: false, start, end: start + 3 }
    if (syntax.startsWith('<>', start)) return { name: '#fragment', closing: false, selfClosing: false, start, end: start + 2 }
    const closing = syntax.startsWith('</', start)
    const nameMatch = new RegExp(closing ? '^</([A-Za-z][\\w.-]*)' : '^<([A-Za-z][\\w.-]*)').exec(syntax.slice(start))
    if (!nameMatch) return null
    let cursor = start + nameMatch[0].length
    let expressionDepth = 0
    while (cursor < syntax.length) {
      if (syntax[cursor] === '{') expressionDepth += 1
      else if (syntax[cursor] === '}') expressionDepth = Math.max(0, expressionDepth - 1)
      else if (syntax[cursor] === '>' && expressionDepth === 0) {
        return {
          name: nameMatch[1],
          closing,
          selfClosing: !closing && /\/\s*$/.test(syntax.slice(start, cursor)),
          start,
          end: cursor + 1,
        }
      }
      cursor += 1
    }
    return null
  }

  const jsxStartAllowed = (start) => {
    const before = syntax.slice(Math.max(0, start - 80), start).trimEnd()
    return before.length === 0 || /(?:\breturn|=>)$/.test(before) || /[=([{,:?>]$/.test(before)
  }

  const skipExpression = (start) => {
    let cursor = start + 1
    let depth = 1
    while (cursor < syntax.length && depth > 0) {
      if (syntax[cursor] === '{') depth += 1
      else if (syntax[cursor] === '}') depth -= 1
      else if (syntax[cursor] === '<' && (/[A-Za-z]/.test(syntax[cursor + 1] ?? '') || syntax[cursor + 1] === '>') && jsxStartAllowed(cursor)) {
        const nestedEnd = parseElement(cursor)
        if (nestedEnd > cursor) {
          cursor = nestedEnd
          continue
        }
      }
      cursor += 1
    }
    return cursor
  }

  const parseElement = (start) => {
    const opening = readTag(start)
    if (!opening || opening.closing) return start
    openingRanges.push({ start: opening.start, end: opening.end })
    if (opening.selfClosing) return opening.end
    let cursor = opening.end
    while (cursor < syntax.length) {
      if (syntax[cursor] === '{') {
        cursor = skipExpression(cursor)
        continue
      }
      if (syntax.startsWith('</', cursor)) {
        const closing = readTag(cursor)
        if (closing?.name === opening.name) return closing.end
      }
      if (syntax[cursor] === '<' && (/[A-Za-z]/.test(syntax[cursor + 1] ?? '') || syntax[cursor + 1] === '>')) {
        const nestedEnd = parseElement(cursor)
        if (nestedEnd > cursor) {
          cursor = nestedEnd
          continue
        }
      }
      const nextMarkup = syntax.indexOf('<', cursor)
      const nextExpression = syntax.indexOf('{', cursor)
      const next = [nextMarkup, nextExpression].filter((offset) => offset >= 0).sort((left, right) => left - right)[0] ?? syntax.length
      if (next > cursor) textRanges.push({ start: cursor, end: next })
      cursor = next > cursor ? next : cursor + 1
    }
    return cursor
  }

  let cursor = 0
  while (cursor < syntax.length) {
    const start = syntax.indexOf('<', cursor)
    if (start < 0) break
    if ((/[A-Za-z]/.test(syntax[start + 1] ?? '') || syntax[start + 1] === '>') && jsxStartAllowed(start)) {
      const end = parseElement(start)
      if (end > start) {
        cursor = end
        continue
      }
    }
    cursor = start + 1
  }
  return { openingRanges, textRanges }
}

function scanSource(source, file) {
  const findings = []
  const lexical = collectLexicalFacts(source)
  const jsx = file.endsWith('.tsx') ? collectJsxFacts(lexical.syntax) : { openingRanges: [], textRanges: [] }
  for (const range of jsx.textRanges) {
    const value = source.slice(range.start, range.end).trim()
    if (looksEnglishPhrase(value)) findings.push({ kind: 'jsx-text', value, file, ...lineAndColumn(source, range.start) })
  }
  for (const literal of lexical.strings) {
    if (literal.interpolated || !looksEnglishPhrase(literal.value)) continue
    const opening = jsx.openingRanges.find((range) => literal.start >= range.start && literal.end <= range.end)
    if (opening) {
      const prefix = source.slice(opening.start, literal.start)
      const attributeMatch = JSX_ATTRIBUTE_PREFIX.exec(prefix)
      if (attributeMatch) {
        findings.push({
          kind: 'jsx-attr',
          attribute: /([\w-]+)\s*=/.exec(attributeMatch[0])?.[1],
          value: literal.value.trim(),
          file,
          ...lineAndColumn(source, literal.offset),
        })
        continue
      }
    }
    const prefix = source.slice(Math.max(0, literal.start - 200), literal.start)
    for (const definition of MESSAGE_PREFIXES) {
      if (!definition.pattern.test(prefix)) continue
      findings.push({ kind: definition.kind, value: literal.value.trim(), file, ...lineAndColumn(source, literal.offset) })
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
