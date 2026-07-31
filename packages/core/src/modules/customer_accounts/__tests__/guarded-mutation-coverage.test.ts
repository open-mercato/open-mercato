import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Regression coverage for #3195 — the remaining customer_accounts non-CrudForm
 * write paths must route through `useGuardedMutation` so the shared mutation
 * injection lifecycle (record locks, conflict UI, global write guards) runs
 * instead of calling `apiCall` directly.
 *
 * These two UI surfaces are not `CrudForm` hosts, so they need the guard wired
 * by hand. This test fails if either drops the wiring.
 */
const moduleRoot = join(__dirname, '..')

const GUARDED_WRITE_FILES = [
  'backend/customer_accounts/roles/page.tsx',
  'widgets/injection/account-status/widget.client.tsx',
]

describe('customer_accounts non-CrudForm writes route through useGuardedMutation (#3195)', () => {
  it.each(GUARDED_WRITE_FILES)('%s imports and invokes useGuardedMutation', (relativePath) => {
    const source = readFileSync(join(moduleRoot, relativePath), 'utf8')
    expect(source).toContain("from '@open-mercato/ui/backend/injection/useGuardedMutation'")
    expect(source).toContain('useGuardedMutation')
    expect(source).toContain('runMutation')
  })
})
