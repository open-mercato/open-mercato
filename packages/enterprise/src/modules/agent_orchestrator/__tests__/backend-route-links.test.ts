/**
 * Every `/backend/...` the module navigates to must be a page that exists.
 *
 * Both P0s in the 2026-08-11 evals audit were the same bug: the agent-centric
 * consolidation (#4489) deleted the eval-cases LIST page, and two references
 * outlived it — the trace inspector's "View eval set" button and an integration
 * test asserting that page lists drafts. The button was a dead end for months
 * and the test had been failing in CI the whole time.
 *
 * Nothing type-checks a route string, so nothing caught either. This does.
 *
 * The check is deliberately narrow: literal `/backend/...` paths with a static
 * first segment, resolved against the page files this module actually declares
 * plus a small allowlist of routes owned by other modules. A template literal
 * whose interpolation lands mid-segment is skipped rather than guessed at —
 * the goal is zero false positives, because a guard people learn to skip is
 * worse than no guard.
 */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import fg from 'fast-glob'

const MODULE_ROOT = join(__dirname, '..')

/**
 * Backend routes this module links to that are declared elsewhere. Each needs a
 * reason, so a stale entry is obvious rather than inherited.
 */
const EXTERNAL_ROUTES: Record<string, string> = {
  'backend/workflows': 'core workflows — the Studio',
  'backend/tasks': 'core workflows — the frozen user-task surface',
  'backend/instances': 'core workflows — a run instance. NOT /backend/workflows/instances: the module prefix is not in the route, and assuming it was is exactly the dead link this guard first caught.',
  'backend/instances/[id]': 'core workflows — one run instance',
}

/** Declared page routes as segment lists; `[id]` is a wildcard segment. */
function declaredRouteSegments(): string[][] {
  const pages = fg.sync(['backend/**/page.tsx'], { cwd: MODULE_ROOT })
  const routes = pages.map((page) => page.replace(/^backend\//, '').replace(/\/page\.tsx$/, '').split('/'))
  for (const external of Object.keys(EXTERNAL_ROUTES)) {
    routes.push(external.replace(/^backend\//, '').split('/'))
  }
  return routes
}

/**
 * A linked path matches a declared route only when the SEGMENT COUNT agrees.
 * That distinction is the whole point: `eval-cases/[id]` existing does not make
 * `/backend/eval-cases` — the deleted list — a real page, and a prefix-only
 * check would have called the dead link healthy.
 */
function isDeclared(link: string[], routes: string[][]): boolean {
  return routes.some(
    (route) =>
      route.length === link.length &&
      route.every((segment, index) => segment.startsWith('[') || link[index] === '*' || segment === link[index]),
  )
}

/**
 * Literal `/backend/...` paths as segment lists. A `${...}` interpolation
 * filling a whole segment becomes `*`; one landing mid-segment makes the path
 * unresolvable and it is skipped rather than guessed at — the guard aims at
 * zero false positives.
 */
function backendLinksIn(source: string): string[][] {
  const found: string[][] = []
  for (const match of source.matchAll(/['"`]\/backend\/([^'"`]*)['"`]/g)) {
    const path = match[1].split('?')[0].split('#')[0].replace(/\/$/, '')
    if (!path) continue
    const segments = path.split('/')
    if (segments.some((segment) => segment.includes('${') && segment.replace(/\$\{[^}]*\}/g, '') !== '')) continue
    found.push(segments.map((segment) => (segment.includes('${') ? '*' : segment)))
  }
  return found
}

describe('backend route links resolve to a page that exists', () => {
  const files = fg.sync(['**/*.{ts,tsx}'], {
    cwd: MODULE_ROOT,
    absolute: true,
    ignore: ['**/__tests__/**', '**/__integration__/**'],
  })

  it('scans a meaningful number of module files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('distinguishes a detail page from the list that was deleted', () => {
    const routes = declaredRouteSegments()
    expect(isDeclared(['eval-cases', '*'], routes)).toBe(true)
    // The route whose deletion started this. A prefix check would pass it.
    expect(isDeclared(['eval-cases'], routes)).toBe(false)
    expect(isDeclared(['agents', '*'], routes)).toBe(true)
    expect(isDeclared(['traces'], routes)).toBe(true)
  })

  it('never navigates to a backend route this module does not declare', () => {
    const routes = declaredRouteSegments()
    const violations: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const link of backendLinksIn(source)) {
        if (isDeclared(link, routes)) continue
        violations.push(`${relative(MODULE_ROOT, file).split(sep).join('/')} \u2192 /backend/${link.join('/')}`)
      }
    }
    expect(violations).toEqual([])
  })
})
