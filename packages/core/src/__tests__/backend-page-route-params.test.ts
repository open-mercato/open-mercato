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
  const pages: string[] = []
  for (const root of [...collectModuleRootsUnder(packagesRoot), ...collectModuleRootsUnder(appsRoot)]) {
    collectBackendPages(root, false, pages)
  }

  it('finds backend pages to scan', () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  it('has no backend page that reads route params via useParams()', () => {
    const offenders = pages
      .filter((file) => USE_PARAMS.test(readFileSync(file, 'utf8')))
      .map(toRepoRelative)

    expect(offenders).toEqual([])
  })
})
