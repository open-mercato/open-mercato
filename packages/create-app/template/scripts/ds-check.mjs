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

function collectStringCandidates(source) {
  const candidates = []
  let index = 0
  while (index < source.length) {
    if (source[index] === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2)
      if (index < 0) break
      continue
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    const quote = source[index]
    if (quote !== '"' && quote !== "'" && quote !== '`') {
      index += 1
      continue
    }
    const start = index + 1
    index = start
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2
        continue
      }
      if (source[index] === quote) break
      index += 1
    }
    candidates.push({ value: source.slice(start, index), offset: start })
    index += 1
  }
  return candidates
}

function isClassCandidate(source, candidate) {
  const prefix = source.slice(Math.max(0, candidate.offset - 120), candidate.offset - 1)
  if (/(?:className|class)\s*=\s*(?:\{\s*)?$/.test(prefix)) return true
  if (/(?:cn|clsx|cva|twMerge)\s*\([^)]*$/.test(prefix)) return true
  return /\s/.test(candidate.value)
    && /(?:^|\s)(?:flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|items-|justify-|gap-|space-|p[trblxy]?-|m[trblxy]?-|w-|h-|min-|max-|text-|bg-|border-|ring-|rounded-|shadow-)/.test(candidate.value)
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
      if (!entry || typeof entry.file !== 'string' || typeof entry.rule !== 'string') {
        errors.push(`.ds-check-ignore entry ${index + 1} requires file and rule strings.`)
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
    && (typeof entry.match !== 'string' || finding.match.includes(entry.match))
}

export function scanDesignSystem(root = process.cwd()) {
  const normalizedRoot = path.resolve(root)
  const ignore = readIgnoreFile(normalizedRoot)
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
    const ignoredBy = ignore.entries.find((entry) => matchesIgnore(entry, finding))
    if (ignoredBy) ignoredBy.matched = true
    else findings.push(finding)
  }

  for (const absolutePath of sourceFiles) {
    const source = fs.readFileSync(absolutePath, 'utf8')
    const relativePath = path.relative(normalizedRoot, absolutePath).split(path.sep).join('/')
    for (const candidate of collectStringCandidates(source)) {
      if (!isClassCandidate(source, candidate)) continue
      for (const rule of DS_RULES.filter((item) => item.stringPolicy)) {
        const pattern = new RegExp(rule.pattern, 'g')
        for (const match of candidate.value.matchAll(pattern)) {
          recordFinding(source, relativePath, rule, match[0], candidate.offset + match.index)
        }
      }
    }
    const inlineStyleRule = DS_RULES.find((candidate) => candidate.id === 'inline-style')
    for (const match of source.matchAll(/\bstyle\s*=/g)) {
      recordFinding(source, relativePath, inlineStyleRule, match[0], match.index)
    }
    if (/(?:^|\/)backend(?:\/|$)/.test(relativePath)) {
      const rawTableRule = DS_RULES.find((candidate) => candidate.id === 'raw-backend-table')
      for (const match of source.matchAll(/<(?:table|thead|tbody|tfoot|tr|th|td)\b/g)) {
        recordFinding(source, relativePath, rawTableRule, match[0], match.index)
      }
    }
  }

  const staleIgnores = ignore.entries
    .filter((entry) => !entry.matched)
    .map((entry) => ({ file: entry.file, rule: entry.rule, match: entry.match ?? null }))
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
