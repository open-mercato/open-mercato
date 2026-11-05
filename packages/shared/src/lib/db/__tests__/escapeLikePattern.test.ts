import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { escapeLikePattern } from '../escapeLikePattern'

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLikePattern('%')).toBe('\\%')
    expect(escapeLikePattern('_')).toBe('\\_')
    expect(escapeLikePattern('\\')).toBe('\\\\')
    expect(escapeLikePattern('a%b_c')).toBe('a\\%b\\_c')
  })

  it('escapes the backslash before the wildcards so the escape itself is literal', () => {
    expect(escapeLikePattern('100%\\_')).toBe('100\\%\\\\\\_')
  })

  it('leaves ordinary input untouched', () => {
    expect(escapeLikePattern('hello world')).toBe('hello world')
    expect(escapeLikePattern('')).toBe('')
  })
})

/**
 * Regression guard for #2932 (and the earlier #2734 fix).
 *
 * Every user-supplied value interpolated into a MikroORM `$ilike` pattern under
 * any module's `api/**` tree MUST flow through `escapeLikePattern`, otherwise a
 * caller can inject LIKE metacharacters (`%`, `_`, `\`) to broaden predicates or
 * force pathological full scans. This scans the whole monorepo so a NEW unescaped
 * `$ilike` interpolation in any package or app fails the build.
 */
function findRepoRoot(start: string): string {
  let current = start
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, 'packages')) && existsSync(join(current, 'apps'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('[internal] could not locate monorepo root for $ilike guard')
}

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'generated', 'dist', '.next', '.mercato'])

function collectApiSourceFiles(dir: string, acc: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      collectApiSourceFiles(full, acc)
    } else if (
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test.tsx') &&
      full.split(sep).includes('api')
    ) {
      acc.push(full)
    }
  }
}

const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/

function isPreEscapedVariable(expr: string, source: string): boolean {
  if (!BARE_IDENTIFIER.test(expr)) return false
  const assignedFromEscape = new RegExp(`\\b${expr}\\s*=\\s*escapeLikePattern\\(`)
  return assignedFromEscape.test(source)
}

function findUnescapedIlikeInterpolations(source: string): string[] {
  const ilikeTemplate = /\$ilike:\s*`([^`]*)`/g
  const interpolation = /\$\{([^}]*)\}/g
  const offenders: string[] = []
  let templateMatch: RegExpExecArray | null
  while ((templateMatch = ilikeTemplate.exec(source)) !== null) {
    const literal = templateMatch[1]
    let exprMatch: RegExpExecArray | null
    while ((exprMatch = interpolation.exec(literal)) !== null) {
      const expr = exprMatch[1].trim()
      if (expr.startsWith('escapeLikePattern(')) continue
      if (isPreEscapedVariable(expr, source)) continue
      offenders.push(`\`${templateMatch[1]}\``)
    }
  }
  return offenders
}

describe('$ilike user input must be escaped under api/** (#2932)', () => {
  const repoRoot = findRepoRoot(__dirname)
  const roots = [join(repoRoot, 'packages'), join(repoRoot, 'apps')]
  const files: string[] = []
  for (const root of roots) collectApiSourceFiles(root, files)

  it('discovered api source files to scan', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('every $ilike pattern interpolating a variable uses escapeLikePattern', () => {
    const violations: string[] = []
    for (const full of files) {
      const source = readFileSync(full, 'utf8')
      const offenders = findUnescapedIlikeInterpolations(source)
      if (offenders.length === 0) continue
      const rel = relative(repoRoot, full).split(sep).join('/')
      for (const offender of offenders) violations.push(`${rel}: ${offender}`)
    }
    expect(violations).toEqual([])
  })
})
