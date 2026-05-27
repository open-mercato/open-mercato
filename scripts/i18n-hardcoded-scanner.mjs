/**
 * Pure helpers for the i18n hardcoded-string scanner.
 *
 * Detects user-facing English literals that bypass the i18n pipeline:
 *  - JSX text nodes (>Two Words<)
 *  - JSX attribute literals on user-visible props (label/title/placeholder/...)
 *  - throw new Error('...') / createCrudFormError('...') / toast.*('...') /
 *    raiseCrudError('...') with a plain English first argument
 *
 * Internal assertions are opted out with the `[internal]` prefix convention
 * documented in `.ai/specs/2026-05-26-missing-translations-audit-and-remediation.md`.
 *
 * Shared with `i18n-check-hardcoded.ts` and `__tests__/i18n-hardcoded.test.mjs`
 * so detection logic stays unit-tested and filesystem-free.
 */

export const HARDCODED_KINDS = Object.freeze({
  jsxText: 'jsx-text',
  jsxAttr: 'jsx-attr',
  throwError: 'throw-error',
  crudFormError: 'crud-form-error',
  raiseCrudError: 'raise-crud-error',
  toastCall: 'toast-call',
})

const JSX_TEXT_PATTERN = />\s*([A-Z][a-z]+(?:\s+[A-Za-z][a-zA-Z]*){1,}[.?!]?)\s*</g

const JSX_ATTR_NAMES = [
  'label',
  'title',
  'placeholder',
  'description',
  'tooltip',
  'aria-label',
  'message',
  'subtitle',
  'helperText',
  'emptyMessage',
]

const JSX_ATTR_PATTERN = new RegExp(
  `(?:^|[\\s{(])(${JSX_ATTR_NAMES.join('|')})\\s*=\\s*("([^"\\n]+)"|'([^'\\n]+)'|\\{\\s*("([^"\\n]+)"|'([^'\\n]+)')\\s*\\})`,
  'g',
)

const THROW_ERROR_PATTERN = /throw\s+new\s+Error\(\s*(["'`])([^"'`\n]{2,})\1/g
const CRUD_FORM_ERROR_PATTERN = /createCrudFormError\(\s*(["'`])([^"'`\n]{2,})\1/g
const RAISE_CRUD_ERROR_PATTERN = /raiseCrudError\(\s*(["'`])([^"'`\n]{2,})\1/g
const TOAST_CALL_PATTERN = /(?<![a-zA-Z_$])toast\.(?:error|success|warning|warn|info|message|loading)\(\s*(["'`])([^"'`\n]{2,})\1/g

const INTERNAL_PREFIX = '[internal]'

const TECHNICAL_TOKENS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT',
  'TRUE',
  'FALSE',
  'NULL',
  'NaN',
  'UTC',
  'UTC+0',
  'UTC-0',
])

const TECHNICAL_PREFIX_HINTS = [
  'application/',
  'text/',
  'image/',
  'multipart/',
  'http://',
  'https://',
  'data:',
  'mailto:',
  'tel:',
  'urn:',
  '/api/',
  './',
  '../',
]

function looksTechnical(value) {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (TECHNICAL_TOKENS.has(trimmed)) return true
  for (const hint of TECHNICAL_PREFIX_HINTS) {
    if (trimmed.startsWith(hint)) return true
  }
  if (/^[A-Z0-9_]+$/.test(trimmed)) return true
  if (/^[a-zA-Z][\w-]*$/.test(trimmed) && !trimmed.includes(' ')) return true
  return false
}

const ENGLISH_WORD_TOKEN = /[A-Za-z]{2,}/g

export function looksEnglishPhrase(value, { minWords = 2 } = {}) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length < 4) return false
  if (trimmed.startsWith(INTERNAL_PREFIX)) return false
  if (looksTechnical(trimmed)) return false
  if (/^[^A-Za-z]*$/.test(trimmed)) return false

  const tokens = trimmed.match(ENGLISH_WORD_TOKEN) || []
  if (tokens.length < minWords) return false
  // Reject obvious dotted identifiers like `module.entity.title` even if they
  // happen to share a regex shape with normal text — those belong to keys.
  if (/\.[a-z]+\.[a-z]+/.test(trimmed) && !/\s/.test(trimmed)) return false

  let lower = 0
  for (const ch of trimmed) {
    if (ch >= 'a' && ch <= 'z') {
      lower += 1
      if (lower > 1) break
    }
  }
  if (lower < 1) return false

  return true
}

function rangeIsInsideTranslationCall(line, startIndex) {
  const before = line.slice(0, startIndex)
  // If the literal sits inside a `{t(` or `{translate(` expression on the same
  // line, the JSX text node rule should not fire — the text is already i18n'd.
  const lastBrace = before.lastIndexOf('{')
  if (lastBrace < 0) return false
  const fragment = before.slice(lastBrace)
  return /\b(?:t|translate)\(\s*$/.test(fragment) || /\b(?:t|translate)\(\s*[^)]*$/.test(fragment)
}

function pushFinding(findings, finding) {
  findings.push(finding)
}

function applyJsxText(line, lineNumber, file, findings) {
  for (const match of line.matchAll(JSX_TEXT_PATTERN)) {
    const value = match[1].trim()
    if (!looksEnglishPhrase(value)) continue
    const matchIndex = match.index ?? 0
    if (rangeIsInsideTranslationCall(line, matchIndex)) continue
    pushFinding(findings, {
      kind: HARDCODED_KINDS.jsxText,
      value,
      file,
      line: lineNumber,
      column: matchIndex + 1,
      raw: match[0],
    })
  }
}

function applyJsxAttr(line, lineNumber, file, findings) {
  for (const match of line.matchAll(JSX_ATTR_PATTERN)) {
    const attr = match[1]
    const raw = match[0]
    const value = match[3] ?? match[4] ?? match[6] ?? match[7]
    if (!value) continue
    if (!looksEnglishPhrase(value)) continue
    const matchIndex = (match.index ?? 0)
    pushFinding(findings, {
      kind: HARDCODED_KINDS.jsxAttr,
      value,
      attribute: attr,
      file,
      line: lineNumber,
      column: matchIndex + 1,
      raw,
    })
  }
}

function applyMessagePattern(line, lineNumber, file, findings, pattern, kind) {
  for (const match of line.matchAll(pattern)) {
    const value = match[2]
    if (!looksEnglishPhrase(value, { minWords: 2 })) continue
    pushFinding(findings, {
      kind,
      value,
      file,
      line: lineNumber,
      column: (match.index ?? 0) + 1,
      raw: match[0],
    })
  }
}

export function scanLine(line, { file = '<inline>', lineNumber = 1 } = {}) {
  const findings = []
  if (!line) return findings
  applyJsxText(line, lineNumber, file, findings)
  applyJsxAttr(line, lineNumber, file, findings)
  applyMessagePattern(line, lineNumber, file, findings, THROW_ERROR_PATTERN, HARDCODED_KINDS.throwError)
  applyMessagePattern(line, lineNumber, file, findings, CRUD_FORM_ERROR_PATTERN, HARDCODED_KINDS.crudFormError)
  applyMessagePattern(line, lineNumber, file, findings, RAISE_CRUD_ERROR_PATTERN, HARDCODED_KINDS.raiseCrudError)
  applyMessagePattern(line, lineNumber, file, findings, TOAST_CALL_PATTERN, HARDCODED_KINDS.toastCall)
  return findings
}

export function scanText(text, { file = '<inline>' } = {}) {
  if (typeof text !== 'string') return []
  const lines = text.split('\n')
  const findings = []
  for (let i = 0; i < lines.length; i++) {
    const lineFindings = scanLine(lines[i], { file, lineNumber: i + 1 })
    if (lineFindings.length === 0) continue
    findings.push(...lineFindings)
  }
  return findings
}

export function buildAllowlistMatchers(allowlist) {
  if (!allowlist) return []
  const entries = Array.isArray(allowlist.entries) ? allowlist.entries : []
  const matchers = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const fileMatcher = typeof entry.file === 'string' && entry.file.length > 0 ? entry.file : null
    const lineMatcher = typeof entry.line === 'number' && Number.isFinite(entry.line) ? entry.line : null
    const matchSource = typeof entry.match === 'string' && entry.match.length > 0 ? entry.match : null
    const kindMatcher = typeof entry.kind === 'string' && entry.kind.length > 0 ? entry.kind : null
    let matchRegex = null
    if (matchSource) {
      try {
        matchRegex = new RegExp(matchSource)
      } catch {
        matchRegex = null
      }
    }
    if (!fileMatcher && !matchSource && !kindMatcher) continue
    matchers.push({ entry, fileMatcher, lineMatcher, matchSource, matchRegex, kindMatcher })
  }
  return matchers
}

function fileMatches(matcher, relPath) {
  if (!matcher) return true
  if (matcher === relPath) return true
  if (relPath.endsWith('/' + matcher)) return true
  if (relPath.endsWith(matcher)) return true
  return false
}

export function findingIsAllowlisted(finding, matchers) {
  if (!matchers || matchers.length === 0) return null
  for (const matcher of matchers) {
    if (matcher.kindMatcher && matcher.kindMatcher !== finding.kind) continue
    if (matcher.fileMatcher && !fileMatches(matcher.fileMatcher, finding.file)) continue
    if (matcher.lineMatcher && matcher.lineMatcher !== finding.line) continue
    if (matcher.matchRegex && !matcher.matchRegex.test(finding.value) && !matcher.matchRegex.test(finding.raw)) continue
    if (matcher.matchSource && !matcher.matchRegex) {
      if (!finding.value.includes(matcher.matchSource) && !finding.raw.includes(matcher.matchSource)) continue
    }
    return matcher.entry
  }
  return null
}

export function filterFindings(findings, matchers) {
  if (!matchers || matchers.length === 0) {
    return { kept: findings.slice(), allowlisted: [] }
  }
  const kept = []
  const allowlisted = []
  for (const finding of findings) {
    const entry = findingIsAllowlisted(finding, matchers)
    if (entry) allowlisted.push({ finding, entry })
    else kept.push(finding)
  }
  return { kept, allowlisted }
}
