import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Workspace-wide guard for #5600: a module backend page MUST take its route
 * params from the `params` prop, never from `useParams()`.
 *
 * Module backend pages are not Next.js route files. They are mounted by the
 * catch-all at `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`,
 * which matches the pathname against the generated backend route manifest and
 * renders `<Component params={match.params} />`. The matched pattern params
 * (`/backend/<mod>/channels/[id]` -> `{ id: '<uuid>' }`) therefore arrive as a
 * PROP. `useParams()` from `next/navigation` returns the params of the real
 * Next.js route instead — always `{ slug: [...] }` for the catch-all — so a
 * page reading `params.id` off it gets `undefined`, never issues its fetch, and
 * hangs on its initial loading state with zero API calls (#5600).
 *
 * Positional workarounds (`params.slug[1]`, `params.slug[params.slug.length - 1]`)
 * are equally forbidden: they hard-code how deep the page sits under `/backend`,
 * so they silently return the wrong segment the moment the page is nested under
 * a module-specific folder — which is exactly what the generator's duplicate
 * route guard (packages/cli/src/lib/generators/module-registry.ts) instructs
 * module authors to do.
 *
 * Fix a failure by giving the page the signature every working detail page uses:
 *
 *   export default function MyDetailPage({ params }: { params?: { id?: string } }) {
 *     const id = params?.id ?? ''
 *
 * Do NOT weaken this scan by adding pages to an allowlist — there is no
 * sanctioned reason for a backend page to call `useParams()`.
 */

const USE_PARAMS = /\buseParams\b/

/**
 * Strip comments before scanning. The convention this guard enforces is worth
 * documenting at the call site — `/backend/[[...slug]]` hands a page `slug`, not
 * `id`, so a page that reaches for `useParams()` gets the wrong shape — and the
 * clearest way to say that is to name `useParams()` in a comment explaining why
 * it is not used. Matching raw file text punished exactly that, flagging two
 * pages that read `params?.id` correctly and only mentioned the hook in prose.
 *
 * This narrows the scan to code, which is what the assertion below claims to
 * measure; it is not an allowlist, and a page that actually calls the hook is
 * still caught whether or not it also mentions it in a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/**
 * The generator treats `page.ts`, `page.tsx`, `page.js`, and `page.jsx` alike
 * (`MODULE_CODE_EXTENSIONS` in packages/cli/src/lib/generators/scanner.ts), so
 * scanning only `.tsx` would let a `page.ts` backend page regress unseen.
 */
const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/

const packagesRoot = join(__dirname, '..', '..', '..')
const repoRoot = join(packagesRoot, '..')
const appsRoot = join(repoRoot, 'apps')

function collectBackendPages(dir: string, insideBackend: boolean, acc: string[]): void {
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
      if (name === 'node_modules' || name === '__tests__' || name === 'dist' || name === 'generated') continue
      collectBackendPages(full, insideBackend || name === 'backend', acc)
    } else if (insideBackend && PAGE_FILE.test(name)) {
      acc.push(full)
    }
  }
}

function collectModuleRootsUnder(workspaceRoot: string): string[] {
  const roots: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(workspaceRoot)
  } catch {
    return roots
  }
  for (const workspace of entries) {
    const modulesDir = join(workspaceRoot, workspace, 'src', 'modules')
    try {
      if (statSync(modulesDir).isDirectory()) roots.push(modulesDir)
    } catch {
      // workspace has no src/modules — skip
    }
  }
  return roots
}

function toRepoRelative(full: string): string {
  return relative(repoRoot, full).split(sep).join('/')
}

describe('backend module pages resolve route params from the params prop', () => {
  const moduleRoots = [...collectModuleRootsUnder(packagesRoot), ...collectModuleRootsUnder(appsRoot)]
  const pages: string[] = []
  for (const root of moduleRoots) collectBackendPages(root, false, pages)

  /**
   * Both floors exist because the two filesystem `catch` blocks above swallow
   * their errors and return an empty result: without a floor, a scan that
   * collapsed to a handful of workspaces or files would still report green and
   * the guard below would pass vacuously. The numbers are the same style of
   * floor the sibling workspace guards pin (optimistic-lock-ui-coverage-workspace
   * pins > 3 roots and > 200 candidates; optimistic-lock-command-coverage pins
   * > 100 files) — set well under today's 22 module roots and 277 pages so
   * ordinary churn never trips them.
   */
  it('scans every workspace module tree, not a truncated slice of it', () => {
    expect(moduleRoots.length).toBeGreaterThan(10)
    expect(pages.length).toBeGreaterThan(200)
  })

  it('has no backend page that reads route params via useParams()', () => {
    const offenders = pages
      .filter((file) => USE_PARAMS.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)

    expect(offenders).toEqual([])
  })
})
