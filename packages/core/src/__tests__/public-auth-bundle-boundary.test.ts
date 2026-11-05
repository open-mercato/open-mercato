import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Unauthenticated auth screens must not pull the backoffice data-grid stack.
 *
 * `login.tsx` needs exactly one 10-line helper from the perspectives layer —
 * `clearAllPerspectiveState` — which `DataTable` re-exports for backward
 * compatibility. Importing it *through* `DataTable` dragged the whole admin
 * grid graph (`@tanstack/table-core`, `@dnd-kit/core`, `@radix-ui/react-select`,
 * the full lucide icon index) into the login page's client bundle: ~200 KB
 * minified instead of ~56 KB. That delays hydration of the login form, and a
 * form submitted before its client handler hydrates falls back to a native
 * navigation — the exact race TC-CRM-087 fails on when a CI shard is loaded.
 *
 * Import the leaf module (`@open-mercato/ui/backend/perspectiveState`) instead.
 * The `DataTable` re-export stays for third-party callers.
 */

const HEAVY_IMPORTS = [
  '@open-mercato/ui/backend/DataTable',
  '@open-mercato/ui/backend/CrudForm',
]

const publicAuthRoot = join(__dirname, '..', 'modules', 'auth', 'frontend')

function collectSourceFiles(dir: string, acc: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc)
      continue
    }
    if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(full)
  }
}

describe('public auth screens stay out of the backoffice bundle', () => {
  const files: string[] = []
  collectSourceFiles(publicAuthRoot, files)

  it('finds the auth frontend sources', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(HEAVY_IMPORTS)('does not import %s', (heavyImport) => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(`from '${heavyImport}'`))
    expect(offenders.map((file) => relative(publicAuthRoot, file))).toEqual([])
  })
})
