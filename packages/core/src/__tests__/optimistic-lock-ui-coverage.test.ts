import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Optimistic-locking UI-coverage regression audit (#2191 / #2055).
 *
 * Flags backend UI files that perform a mutating call — `deleteCrud(`,
 * `updateCrud(`, or a raw `apiCall*` with `method: 'PUT' | 'PATCH' | 'DELETE'`
 * — without participating in OSS optimistic locking, so a *new* raw mutation
 * cannot silently ship without sending the expected-version header.
 *
 * A file is considered COVERED when it references any of the lock primitives
 * (`buildOptimisticLockHeader`, `withScopedApiRequestHeaders`,
 * `withOptimisticLockFor*`, `optimisticLockUpdatedAt`, `disableOptimisticLock`)
 * or is a `<CrudForm>` host (which auto-derives the header from
 * `initialValues.updatedAt` for its own submit/delete).
 *
 * The KNOWN_UNWIRED allowlist is now **empty** — every mutating UI file in core
 * is wired or carries an `optimistic-lock-exempt` reason (#2373 drained). Any NEW
 * mutating UI file that neither sends the header nor documents an exemption fails
 * this test; do NOT re-add entries to the allowlist — wire it or exempt it inline.
 */

const MUTATION = /\b(deleteCrud|updateCrud)\s*\(|method:\s*['"](PUT|PATCH|DELETE)['"]/
// A file is COVERED when it sends the version header (lock primitives / CrudForm
// auto-derive) OR carries an explicit `optimistic-lock-exempt: <reason>` marker
// documenting why a mutating call legitimately does not version-lock (junction
// add/remove, single-admin preference, create-only, legacy/dead route, etc.).
const COVERED =
  /buildOptimisticLockHeader|withScopedApiRequestHeaders|withOptimisticLockFor|optimisticLockUpdatedAt|disableOptimisticLock|<CrudForm|optimistic-lock-exempt/

// Paths relative to packages/core/src — tracked for wiring/exclusion in #2373.
const KNOWN_UNWIRED = new Set<string>([])

const srcRoot = join(__dirname, '..')
const modulesRoot = join(srcRoot, 'modules')

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
      if (name === 'node_modules' || name === '__tests__' || name === 'generated') continue
      collectTsx(full, acc)
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      acc.push(full)
    }
  }
}

describe('optimistic locking — mutating UI calls send the version header (or are allowlisted)', () => {
  const files: string[] = []
  collectTsx(modulesRoot, files)
  // Only backend pages + components host mutating UI flows.
  const candidates = files.filter((f) => f.includes(`${sep}backend${sep}`) || f.includes(`${sep}components${sep}`))

  it('discovered backend/component tsx files to scan', () => {
    expect(candidates.length).toBeGreaterThan(50)
  })

  it('every mutating UI file is covered or explicitly allowlisted (#2373)', () => {
    const violations: string[] = []
    for (const full of candidates) {
      const source = readFileSync(full, 'utf8')
      if (!MUTATION.test(source)) continue
      if (COVERED.test(source)) continue
      const rel = relative(srcRoot, full).split(sep).join('/')
      if (KNOWN_UNWIRED.has(rel)) continue
      violations.push(rel)
    }
    expect(violations).toEqual([])
  })
})
