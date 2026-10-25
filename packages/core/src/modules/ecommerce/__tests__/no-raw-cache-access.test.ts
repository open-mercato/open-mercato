import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * R1 structural guard (SPEC-029 §6.1 "Enforcement", D7). `lib/cacheKeys.ts` is the only file in
 * the ecommerce module allowed to resolve the DI `cache`; every storefront key must be built by
 * `buildStorefrontCacheKey` through `storefrontCache(...)`, so a buyer-dependent entry can never
 * be stored under a key that omits the buyer's digest or named scope component.
 *
 * Package-local by design, so it is not registered in `scripts/repo-wide-guards.mjs`.
 */

const moduleRoot = join(__dirname, '..')
const ALLOWED_FILE = ['lib', 'cacheKeys.ts'].join('/')
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "resolve('cache')", pattern: /\bresolve\s*(?:<[^>()]*>)?\s*\(\s*['"`]cache['"`]/ },
  { name: "tryResolve(..., 'cache')", pattern: /\btryResolve\s*(?:<[^>()]*>)?\s*\([^)]*['"`]cache['"`]/ },
  { name: 'resolveCrudCache(', pattern: /\bresolveCrudCache\s*\(/ },
  { name: 'cradle.cache', pattern: /\bcradle\s*\.\s*cache\b/ },
]

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      collectSourceFiles(full, out)
      continue
    }
    if (!SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue
    if (/\.test\.tsx?$/.test(entry)) continue
    out.push(full)
  }
  return out
}

function findViolations(source: string): string[] {
  return FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name)
}

describe('ecommerce raw cache access guard', () => {
  it('detects every forbidden access shape in a synthetic snippet', () => {
    const offending = [
      "const cache = container.resolve('cache')",
      'const cache = ctx.container.resolve("cache")',
      'const cache = container.resolve<CacheStrategy>(`cache`)',
      "const cache = tryResolve(container, 'cache')",
      "const cache = tryResolve<CacheStrategy>(ctx.container, 'cache')",
      'const cache = resolveCrudCache(container)',
      'const cache = container.cradle.cache',
    ]
    for (const snippet of offending) {
      expect(findViolations(snippet)).not.toHaveLength(0)
    }
    expect(findViolations("container.resolve('em'); searchParams.get('cache'); headers.set('cache-control', 'no-store')")).toEqual([])
  })

  it('keeps the typed accessor as the single cache resolution point', () => {
    const accessor = readFileSync(join(moduleRoot, 'lib', 'cacheKeys.ts'), 'utf8')
    expect(findViolations(accessor)).toContain("resolve('cache')")
  })

  it('finds no raw cache access outside lib/cacheKeys.ts', () => {
    const files = collectSourceFiles(moduleRoot)
    expect(files.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const file of files) {
      const relativePath = toPosix(relative(moduleRoot, file))
      if (relativePath === ALLOWED_FILE) continue
      for (const name of findViolations(readFileSync(file, 'utf8'))) {
        violations.push(`${relativePath}: ${name}`)
      }
    }
    expect(violations).toEqual([])
  })
})
