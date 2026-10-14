import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')

/**
 * The portal's `(frontend)` layout — the server component that decides the portal chrome and
 * resolves the customer session — sits above the `[...slug]` segment so portal navigation does not
 * remount the client subtree. That is a deliberate, permanent performance choice, and it creates a
 * rule the whole portal depends on:
 *
 *   Any navigation that crosses the authenticated/public boundary must be a full page load, so the
 *   server layout re-runs and recomputes the chrome and the session.
 *
 * A client-side `router.push`/`router.replace` across that boundary leaves the previous side's
 * chrome painted over the new page — authenticated chrome (and the user menu, and the mounted SSE
 * bridge) over the login page after a logout, or logged-out chrome over the dashboard after a
 * login. These guards pin the rule so it survives without reviewer vigilance.
 */

const SCANNED_ROOTS = ['apps', 'packages']

const IGNORED_DIRS = new Set([
  'node_modules',
  '.mercato',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.yarn',
  '.git',
  '.ai',
])

/** Public, unauthenticated portal routes. Reaching one from an authenticated page crosses the boundary. */
const PUBLIC_PORTAL_ROUTES = ['login', 'signup', 'verify', 'reset-password', 'invite']

/** The only module allowed to reload the document directly; every portal call site goes through it. */
const PAGE_RELOAD_HELPER = path.join(REPO_ROOT, 'packages/shared/src/lib/navigation/pageReload.ts')

/** Each helper stands in for one client-router call, and must keep that call's history semantics. */
const PAGE_RELOAD_HELPER_CONTRACT: Array<{ helper: string; documentApi: string }> = [
  { helper: 'navigateWithPageReload', documentApi: 'window.location.assign(path)' },
  { helper: 'replaceWithPageReload', documentApi: 'window.location.replace(path)' },
]

const CLIENT_NAV = /router\.(push|replace)\(/
const PORTAL_PATH_LITERAL = /\/portal\//
const PUBLIC_ROUTE_LITERAL = new RegExp(String.raw`\/portal\/(${PUBLIC_PORTAL_ROUTES.join('|')})\b`)
const RAW_PAGE_RELOAD = /window\.location\.(assign|replace)\(|window\.location\.href\s*=/

function collectPortalSourceFiles(start: string, out: string[]) {
  const entries = fs.readdirSync(start, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const full = path.join(start, entry.name)
    if (entry.isDirectory()) {
      collectPortalSourceFiles(full, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!/\.tsx?$/.test(entry.name)) continue
    const relative = path.relative(REPO_ROOT, full)
    if (/(^|[\\/])__tests__[\\/]/.test(relative)) continue
    if (!/[\\/]portal[\\/]/.test(relative)) continue
    out.push(full)
  }
}

function portalSourceFiles(): string[] {
  const files: string[] = []
  for (const dir of SCANNED_ROOTS) {
    const fullDir = path.join(REPO_ROOT, dir)
    if (fs.existsSync(fullDir)) collectPortalSourceFiles(fullDir, files)
  }
  return files
}

type Violation = { file: string; line: number; snippet: string }

type LineMatcher = (context: { line: string; index: number; lines: string[] }) => boolean

function scan(files: string[], matches: LineMatcher): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (!matches({ line, index, lines })) return
      violations.push({
        file: path.relative(REPO_ROOT, file),
        line: index + 1,
        snippet: line.trim().slice(0, 160),
      })
    })
  }
  return violations
}

describe('portal boundary-crossing navigation guard', () => {
  it('finds portal sources to scan', () => {
    expect(portalSourceFiles().length).toBeGreaterThan(0)
  })

  it('only client-side navigates to a statically same-side portal target', () => {
    // A same-side navigation must name its target inline, so this guard can check which side it
    // lands on. A target hidden behind a variable — `router.push(loginPath)`, the shape that let
    // the portal's own logout hook drift out of step with `PortalContext` — is unverifiable and is
    // therefore a violation too: inline the literal, or call `navigateWithPageReload` if the
    // navigation crosses the public/authenticated boundary.
    const violations = scan(portalSourceFiles(), ({ line, index, lines }) => {
      if (!CLIENT_NAV.test(line)) return false
      const callWindow = lines.slice(index, index + 3).join('\n')
      if (PUBLIC_ROUTE_LITERAL.test(callWindow)) return true
      return !PORTAL_PATH_LITERAL.test(callWindow)
    })

    expect(violations).toEqual([])
  })

  it('never client-side navigates away from a public auth page', () => {
    const publicPageDir = new RegExp(String.raw`[\\/]portal[\\/](${PUBLIC_PORTAL_ROUTES.join('|')})[\\/]`)

    const violations = scan(
      portalSourceFiles().filter((file) => publicPageDir.test(path.relative(REPO_ROOT, file))),
      ({ line }) => CLIENT_NAV.test(line),
    )

    expect(violations).toEqual([])
  })

  it('routes every portal page reload through the shared helpers', () => {
    const violations = scan(
      portalSourceFiles().filter((file) => file !== PAGE_RELOAD_HELPER),
      ({ line }) => RAW_PAGE_RELOAD.test(line),
    )

    expect(violations).toEqual([])
  })

  it.each(PAGE_RELOAD_HELPER_CONTRACT)(
    'keeps $helper as the single place the document is reloaded via $documentApi',
    ({ helper, documentApi }) => {
      const contents = fs.readFileSync(PAGE_RELOAD_HELPER, 'utf8')
      expect(contents).toContain(`export function ${helper}(path: string): void {`)
      expect(contents).toContain(documentApi)
    },
  )
})
