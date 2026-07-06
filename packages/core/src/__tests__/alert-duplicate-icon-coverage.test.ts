import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Alert duplicate-icon regression audit (#2759, scope hardening #3027).
 *
 * The redesigned `Alert` primitive (`packages/ui/src/primitives/alert.tsx`)
 * renders its own leading status icon automatically (`showIcon` defaults to
 * `true`). Passing an icon element as the Alert's first child — the legacy
 * pre-redesign pattern — draws the icon twice. Plain status banners should
 * let `Alert` render the default icon; intentional custom icons belong on
 * the `icon` prop (which replaces the default instead of adding to it).
 *
 * This audit flags any `<Alert …>` whose first JSX child on the next line
 * is a self-closing, icon-shaped component (capitalized tag whose className
 * carries a bare sizing utility such as `size-4` or `h-4 w-4`).
 *
 * Scan scope is derived from a per-package `src` discovery walk so any
 * package that renders `<Alert>` is covered automatically, including future
 * ones. A few roots outside that walk (the app modules and the create-app
 * template) are appended explicitly.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const EXTRA_SCAN_ROOTS = [
  'apps/mercato/src/modules',
  'packages/create-app/template/src/modules',
]

function discoverPackageSrcRoots(): string[] {
  const roots: string[] = []
  let packages: string[]
  try {
    packages = readdirSync(join(repoRoot, 'packages'))
  } catch {
    return roots
  }
  for (const name of packages.sort()) {
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

const SCAN_ROOTS = [...discoverPackageSrcRoots(), ...EXTRA_SCAN_ROOTS]

const ALERT_OPEN = /<Alert\b[^>]*>$/
const ICON_CHILD =
  /^<[A-Z][A-Za-z0-9]*\s[^>]*className="[^"]*(?:\bsize-\d|\bh-\d+(?:\.\d+)?\s+w-\d+(?:\.\d+)?|\bw-\d+(?:\.\d+)?\s+h-\d+(?:\.\d+)?)[^"]*"[^>]*\/>$/

function findDuplicateIconLines(source: string): number[] {
  if (!source.includes('<Alert')) return []
  const hits: number[] = []
  const lines = source.split('\n')
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!ALERT_OPEN.test(lines[index].trimEnd())) continue
    const child = lines[index + 1].trim()
    if (ICON_CHILD.test(child)) hits.push(index + 2)
  }
  return hits
}

function collectTsx(dir: string, acc: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === 'generated' || name === 'dist') continue
      collectTsx(full, acc)
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      acc.push(full)
    }
  }
}

describe('Alert callouts do not double the leading icon (#2759, #3027)', () => {
  const files: string[] = []
  for (const root of SCAN_ROOTS) {
    collectTsx(join(repoRoot, root), files)
  }

  it('discovered tsx files to scan', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('covers the package src roots that render <Alert> (incl. #3027 follow-up packages)', () => {
    for (const expected of [
      'packages/core/src',
      'packages/ui/src',
      'packages/webhooks/src',
      'packages/enterprise/src',
      'packages/checkout/src',
      'packages/scheduler/src',
      'packages/sync-akeneo/src',
      'packages/ai-assistant/src',
    ]) {
      expect(SCAN_ROOTS).toContain(expected)
    }
  })

  it('detects an icon element passed as the Alert first child', () => {
    const planted = ['<Alert variant="info">', '  <Info className="size-4" />', '</Alert>'].join('\n')
    expect(findDuplicateIconLines(planted)).toEqual([2])
    expect(findDuplicateIconLines('<Alert variant="info">\n  <p>Plain banner</p>\n</Alert>')).toEqual([])
  })

  it('no <Alert> passes an icon element as its first child — use the icon prop instead', () => {
    const violations: string[] = []
    for (const full of files) {
      const source = readFileSync(full, 'utf8')
      for (const line of findDuplicateIconLines(source)) {
        const rel = relative(repoRoot, full).split(sep).join('/')
        violations.push(`${rel}:${line}`)
      }
    }
    expect(violations).toEqual([])
  })
})
