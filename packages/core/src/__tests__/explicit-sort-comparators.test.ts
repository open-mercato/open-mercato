import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Explicit-sort-comparator regression audit (#3620).
 *
 * `Array.prototype.sort()` / `toSorted()` called with no comparator fall back
 * to JavaScript's default ordering, which coerces every element to a string and
 * compares UTF-16 code units. That is implicit — it only happens to be correct
 * because the arrays currently hold strings, renders user-visible lists in a
 * non-locale order, and silently mis-orders if a call site ever drifts to
 * numbers or mixed types (`[2, 10]` sorts as `[10, 2]`).
 *
 * Every production sort site MUST pass an explicit comparator so the intended
 * ordering is self-documenting and immune to type drift:
 *   - display strings → `(a, b) => a.localeCompare(b)`
 *   - canonical/internal keys → `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`
 *   - numbers → `(a, b) => a - b`
 *
 * This audit fails if any non-test source file under a package `src` root or
 * under `scripts/` calls `.sort()` / `.toSorted()` with empty parens. Test and
 * spec files are intentionally out of scope — their bare sorts operate on known
 * string fixtures for assertion convenience.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__integration__', 'generated', 'dist', '.next', '.mercato'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']
const BARE_SORT = /\.(?:sort|toSorted)\(\s*\)/

function discoverPackageSrcRoots(): string[] {
  const roots: string[] = []
  let packages: string[]
  try {
    packages = readdirSync(join(repoRoot, 'packages'))
  } catch {
    return roots
  }
  for (const name of packages.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const srcDir = join(repoRoot, 'packages', name, 'src')
    try {
      if (statSync(srcDir).isDirectory()) {
        roots.push(`packages/${name}/src`)
      }
    } catch {
      // package without a src directory — skip
    }
  }
  return roots
}

const SCAN_ROOTS = [...discoverPackageSrcRoots(), 'scripts']

function isSourceFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return false
  if (/\.(test|spec)\.(ts|tsx|mjs|js)$/.test(name)) return false
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))
}

function collectSourceFiles(dir: string, acc: string[]): void {
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
      collectSourceFiles(full, acc)
    } else if (isSourceFile(name)) {
      acc.push(full)
    }
  }
}

function findBareSortLines(source: string): number[] {
  if (!source.includes('.sort(') && !source.includes('.toSorted(')) return []
  const hits: number[] = []
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (BARE_SORT.test(lines[index])) hits.push(index + 1)
  }
  return hits
}

describe('sort/toSorted call sites use explicit comparators (#3620)', () => {
  const files: string[] = []
  for (const root of SCAN_ROOTS) {
    collectSourceFiles(join(repoRoot, root), files)
  }

  it('discovered a meaningful set of source files to scan', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  it('covers the package src roots and the scripts directory named in the issue', () => {
    for (const expected of [
      'packages/core/src',
      'packages/shared/src',
      'packages/ui/src',
      'packages/cli/src',
      'packages/ai-assistant/src',
      'packages/checkout/src',
      'packages/sync-akeneo/src',
      'packages/create-app/src',
      'scripts',
    ]) {
      expect(SCAN_ROOTS).toContain(expected)
    }
  })

  it('detects a bare sort and accepts an explicit comparator', () => {
    expect(findBareSortLines('const a = [2, 1].sort()')).toEqual([1])
    expect(findBareSortLines('const a = items.toSorted()')).toEqual([1])
    expect(findBareSortLines('const a = [2, 1].sort((x, y) => x - y)')).toEqual([])
    expect(findBareSortLines('const a = keys.sort((x, y) => x.localeCompare(y))')).toEqual([])
    expect(findBareSortLines('const a = keys.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))')).toEqual([])
  })

  it('no production sort/toSorted call omits its comparator', () => {
    const violations: string[] = []
    for (const full of files) {
      const source = readFileSync(full, 'utf8')
      for (const line of findBareSortLines(source)) {
        const rel = relative(repoRoot, full).split(sep).join('/')
        violations.push(`${rel}:${line}`)
      }
    }
    expect(violations).toEqual([])
  })
})
