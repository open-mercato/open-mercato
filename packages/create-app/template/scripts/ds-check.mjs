import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const UI_POLICY_PATTERN_SOURCES = Object.freeze({
  palette: String.raw`(?:^|\s)(?:[a-z-]+:)*(?:text|bg|border|ring)-(?:red|green|emerald|blue|amber|orange|yellow|rose|lime|cyan|teal|indigo|violet|purple|pink)-\d{2,3}(?:\/\d+)?\b`,
  arbitrary: String.raw`(?:^|\s)\S*\[[^\]]+\]`,
  darkMode: String.raw`(?:^|\s)dark:`,
})

export const DS_RULES = Object.freeze([
  {
    id: 'hardcoded-palette',
    description: 'Use semantic or status design tokens instead of palette shades.',
    pattern: UI_POLICY_PATTERN_SOURCES.palette,
    stringPolicy: true,
  },
  {
    id: 'arbitrary-tailwind',
    description: 'Use the design-system scale instead of arbitrary Tailwind values.',
    pattern: UI_POLICY_PATTERN_SOURCES.arbitrary,
    stringPolicy: true,
  },
  {
    id: 'manual-dark-override',
    description: 'Semantic and status tokens already provide their dark-mode values.',
    pattern: UI_POLICY_PATTERN_SOURCES.darkMode,
    stringPolicy: true,
  },
  {
    id: 'inline-style',
    description: 'Use shared components and design tokens instead of inline style props.',
    pattern: String.raw`\bstyle\s*=`,
  },
  {
    id: 'raw-backend-table',
    description: 'Use the shared DataTable family in backend pages.',
    pattern: String.raw`<(?:table|thead|tbody|tfoot|tr|th|td)\b`,
    backendOnly: true,
  },
])

function collectSourceFiles(root) {
  const sourceRoot = path.join(root, 'src')
  if (!fs.existsSync(sourceRoot)) return []
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.mercato') continue
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
  const candidates = []
  const inlineStyleOffsets = []
  const rawTableTags = []
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
    const literalValue = quote === '`' ? value.replace(/\$\{[\s\S]*?\}/g, (expression) => ' '.repeat(expression.length)) : value
    candidates.push({ value: literalValue, offset: start + 1 })
    index += 1
  }
  const syntax = syntaxMask.join('')
  for (const match of syntax.matchAll(/<[A-Za-z][^>]*>/g)) {
    const openingTag = match[0]
    const tag = /^<([A-Za-z][\w.-]*)/.exec(openingTag)?.[1]?.toLowerCase()
    if (tag && ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'].includes(tag)) {
      rawTableTags.push({ tag, offset: match.index })
    }
    for (const styleMatch of openingTag.matchAll(/\bstyle\s*=/g)) {
      inlineStyleOffsets.push(match.index + styleMatch.index)
    }
  }
  return { candidates, inlineStyleOffsets, rawTableTags }
}

function readIgnoreFile(root) {
  const ignorePath = path.join(root, '.ds-check-ignore')
  if (!fs.existsSync(ignorePath)) return { entries: [], errors: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(ignorePath, 'utf8'))
    if (!Array.isArray(parsed.entries)) {
      return { entries: [], errors: ['.ds-check-ignore must contain an entries array.'] }
    }
    const errors = []
    const entries = parsed.entries.map((entry, index) => {
      if (!entry || typeof entry.file !== 'string' || typeof entry.rule !== 'string' || typeof entry.match !== 'string' || entry.match.length === 0) {
        errors.push(`.ds-check-ignore entry ${index + 1} requires non-empty file, rule, and match strings.`)
      }
      if (typeof entry?.reason !== 'string' || entry.reason.trim().length === 0) {
        errors.push(`.ds-check-ignore entry ${index + 1} requires a non-empty reason.`)
      }
      return { ...entry, matched: false }
    })
    return { entries, errors }
  } catch (error) {
    return { entries: [], errors: [`.ds-check-ignore is invalid JSON: ${error.message}`] }
  }
}

function matchesIgnore(entry, finding) {
  return entry.file === finding.file
    && entry.rule === finding.rule
    && finding.match.includes(entry.match)
    && (typeof entry.line !== 'number' || entry.line === finding.line)
}

function isPolicyMatch(rule, match) {
  if (rule.id !== 'arbitrary-tailwind') return true
  const token = match.trim()
  return /^(?:[a-z@][\w@/-]*:)*-?[a-z][\w/-]*-\[[^\]]+\]$/.test(token)
    || /^\[(?:[^\w\s]|[a-z-]+:)[^\]]+\]/.test(token)
}

export function scanDesignSystem(root = process.cwd(), options = {}) {
  const normalizedRoot = path.resolve(root)
  const ignore = options.useIgnore === false ? { entries: [], errors: [] } : readIgnoreFile(normalizedRoot)
  const findings = []
  const sourceFiles = collectSourceFiles(normalizedRoot)

  const recordFinding = (source, relativePath, rule, match, position) => {
    const location = lineAndColumn(source, position)
    const finding = {
      file: relativePath,
      rule: rule.id,
      message: rule.description,
      match: match.trim(),
      ...location,
    }
    const ignoredBy = ignore.entries.find((entry) => !entry.matched && matchesIgnore(entry, finding))
    if (ignoredBy) ignoredBy.matched = true
    else findings.push(finding)
  }

  for (const absolutePath of sourceFiles) {
    const source = fs.readFileSync(absolutePath, 'utf8')
    const relativePath = path.relative(normalizedRoot, absolutePath).split(path.sep).join('/')
    const syntaxFacts = collectSyntaxFacts(source, relativePath)
    for (const candidate of syntaxFacts.candidates) {
      for (const rule of DS_RULES.filter((item) => item.stringPolicy)) {
        const pattern = new RegExp(rule.pattern, 'g')
        for (const match of candidate.value.matchAll(pattern)) {
          if (!isPolicyMatch(rule, match[0])) continue
          recordFinding(source, relativePath, rule, match[0], candidate.offset + match.index)
        }
      }
    }
    const inlineStyleRule = DS_RULES.find((candidate) => candidate.id === 'inline-style')
    for (const offset of syntaxFacts.inlineStyleOffsets) {
      recordFinding(source, relativePath, inlineStyleRule, 'style=', offset)
    }
    if (/(?:^|\/)backend(?:\/|$)/.test(relativePath)) {
      const rawTableRule = DS_RULES.find((candidate) => candidate.id === 'raw-backend-table')
      for (const { tag, offset } of syntaxFacts.rawTableTags) {
        recordFinding(source, relativePath, rawTableRule, `<${tag}`, offset)
      }
    }
  }

  const staleIgnores = ignore.entries
    .filter((entry) => !entry.matched)
    .map((entry) => ({ file: entry.file, rule: entry.rule, match: entry.match, line: entry.line ?? null }))
  return {
    ok: findings.length === 0 && staleIgnores.length === 0 && ignore.errors.length === 0,
    filesScanned: sourceFiles.length,
    findings,
    staleIgnores,
    errors: ignore.errors,
  }
}

function runCli() {
  const json = process.argv.slice(2).includes('--json')
  const result = scanDesignSystem()
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    process.stdout.write(`[ds:check] ${result.filesScanned} files passed.\n`)
  } else {
    for (const finding of result.findings) {
      process.stderr.write(`${finding.file}:${finding.line}:${finding.column} [${finding.rule}] ${finding.message}\n`)
    }
    for (const stale of result.staleIgnores) {
      process.stderr.write(`.ds-check-ignore [stale] ${stale.file} ${stale.rule}${stale.match ? ` ${stale.match}` : ''}\n`)
    }
    for (const error of result.errors) process.stderr.write(`[ds:check] ${error}\n`)
  }
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
