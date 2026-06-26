import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Command-layer optimistic-lock coverage guard (record_locks decision map).
 *
 * Scans EVERY workspace package for direct `enforceCommandOptimisticLock(` call
 * sites and asserts each file is either:
 *   (a) migrated to the async DI-aware seam `enforceCommandOptimisticLockWithGuards`
 *       (so the optional enterprise `record_locks` guard is awaited — i.e. the
 *       site's record_locks decision is "enabled"), OR
 *   (b) present in the explicit COMMAND_GUARD_ALLOWLIST below with a concrete
 *       record_locks decision (OSS-only / exempt, or "migrated in Part B").
 *
 * Phase 6b parts A and B migrated every "enabled" command site (core AND the
 * `checkout` / `webhooks` packages) to the async seam, so those files dropped
 * out of this scan naturally. What remains in the allowlist is, by construction,
 * only the intentional OSS-only / exempt sites.
 *
 * A NEW direct `enforceCommandOptimisticLock(` site that is neither migrated nor
 * allowlisted fails this test — it must carry a record_locks decision.
 */

// Repo-relative paths (POSIX separators) → concrete record_locks decision. Every
// "enabled" site was migrated to `enforceCommandOptimisticLockWithGuards` and
// therefore no longer appears here. The entries below are intentional OSS-only /
// exempt sites (the OSS `updated_at` floor still runs via the synchronous helper).
const COMMAND_GUARD_ALLOWLIST: Record<string, string> = {
  // OSS-only / exempt — record_locks intentionally not engaged; the OSS floor
  // (synchronous `enforceCommandOptimisticLock`) still guards concurrent edits.
  'packages/core/src/modules/auth/api/sidebar/preferences/route.ts':
    'OSS-only / exempt — sidebar preferences are a per-user (and per-role variant) single-owner preference, not a shared collaborative-edit surface; the OSS floor covers the same-user/admin two-tab race.',
  'packages/core/src/modules/perspectives/services/perspectiveService.ts':
    'OSS-only / exempt — saveUserPerspective mutates a perspective filtered by the calling user (strictly per-owner personal views, never cross-user); it is a pure em+cache lib service with no awilix request container to drive the enterprise guard. OSS floor retained.',
  // OSS-only — sites added on `develop` after the Phase 6b record_locks migration
  // (they ship without this branch's guard, so develop CI did not flag them). The
  // synchronous OSS `updated_at` floor guards concurrent edits on each. They are
  // admin/config surfaces, not collaborative merge-dialog targets; promoting any
  // to the enterprise `enforceCommandOptimisticLockWithGuards` seam is a follow-up.
  'packages/core/src/modules/customer_accounts/api/admin/roles/[id]/acl.ts':
    'OSS-only — portal-customer role ACL admin edit; OSS floor guards the concurrent admin two-tab race. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/directory/api/organization-branding/route.ts':
    'OSS-only — organization branding is single-owner admin config (directory.organization); OSS floor guards concurrent edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/entities/api/encryption.ts':
    'OSS-only — per-entity encryption-map admin config; OSS floor guards concurrent edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/integrations/api/[id]/credentials/route.ts':
    'OSS-only — integration credentials are single-admin config keyed by bundle id (integrations.integration); OSS floor guards concurrent admin edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/integrations/api/[id]/state/route.ts':
    'OSS-only — integration enable/disable is a single-admin toggle (integrations.integration); OSS floor guards concurrent admin edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/integrations/api/[id]/version/route.ts':
    'OSS-only — integration version admin endpoint (integrations.integration); OSS floor guards concurrent admin edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/planner/commands/availability-date-specific.ts':
    'OSS-only — date-specific availability rule edit; OSS floor guards concurrent edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/currencies/api/fetch-configs/route.ts':
    'OSS-only — currency fetch-config admin settings added on develop; OSS floor guards concurrent admin edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/feature_toggles/commands/global.ts':
    'OSS-only — global feature-toggle command (feature_toggles.global), instance-level admin config added on develop; OSS floor guards concurrent edits. Enterprise record_locks migration deferred.',
  'packages/core/src/modules/planner/commands/availability-weekly.ts':
    'OSS-only — weekly availability rule-set edit (sibling of the allowlisted availability-date-specific site) added on develop; OSS floor guards concurrent edits. Enterprise record_locks migration deferred.',
}

// `enforceCommandOptimisticLock(` but NOT `enforceCommandOptimisticLockWithGuards(`.
const DIRECT_HELPER_CALL = /enforceCommandOptimisticLock\s*\(/
const ASYNC_SEAM_CALL = /enforceCommandOptimisticLockWithGuards\s*\(/

// The helper definition file itself declares both symbols — never a call site.
const HELPER_DEFINITION_SUFFIX = `${sep}crud${sep}optimistic-lock-command.ts`

const packagesRoot = join(__dirname, '..', '..', '..')

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
      if (
        name === 'node_modules'
        || name === '__tests__'
        || name === '__integration__'
        || name === 'generated'
        || name === 'dist'
      ) continue
      collectSourceFiles(full, acc)
    } else if (
      (name.endsWith('.ts') || name.endsWith('.tsx'))
      && !name.endsWith('.test.ts')
      && !name.endsWith('.test.tsx')
      && !name.endsWith('.spec.ts')
    ) {
      acc.push(full)
    }
  }
}

function toRepoRelative(full: string): string {
  // packagesRoot points at `packages/`; build a repo-relative POSIX path.
  return join('packages', relative(packagesRoot, full)).split(sep).join('/')
}

describe('optimistic-lock-command-coverage: command-layer guard', () => {
  const files: string[] = []
  collectSourceFiles(packagesRoot, files)

  const directCallSites: string[] = []
  for (const full of files) {
    if (full.endsWith(HELPER_DEFINITION_SUFFIX)) continue
    const source = readFileSync(full, 'utf8')
    if (DIRECT_HELPER_CALL.test(source)) directCallSites.push(full)
  }

  it('discovered workspace source files to scan', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('confirms the async seam is actually adopted by migrated core command sites', () => {
    // After Phase 6b part A, the "enabled" core sites no longer call the sync
    // helper directly (they call the async seam), so this guard would be hollow
    // if the seam were never adopted. Assert several known-migrated files use it.
    const migratedSamples = [
      'packages/core/src/modules/business_rules/api/rules/route.ts',
      'packages/core/src/modules/dictionaries/api/[dictionaryId]/route.ts',
      'packages/core/src/modules/entities/api/records.ts',
      'packages/core/src/modules/feature_toggles/api/overrides/route.ts',
      'packages/core/src/modules/auth/api/roles/acl/route.ts',
      'packages/core/src/modules/staff/commands/job-histories.ts',
      'packages/core/src/modules/inbox_ops/api/settings/route.ts',
    ]
    const missing: string[] = []
    for (const rel of migratedSamples) {
      const full = join(packagesRoot, rel.replace(/^packages\//, ''))
      let source: string
      try {
        source = readFileSync(full, 'utf8')
      } catch {
        missing.push(`${rel} (not found)`)
        continue
      }
      if (!ASYNC_SEAM_CALL.test(source)) missing.push(rel)
      if (DIRECT_HELPER_CALL.test(source)) missing.push(`${rel} (still calls sync helper)`)
    }
    expect(missing).toEqual([])
  })

  it('every direct enforceCommandOptimisticLock site is allowlisted with a record_locks decision', () => {
    const violations: string[] = []
    for (const full of directCallSites) {
      const rel = toRepoRelative(full)
      if (rel in COMMAND_GUARD_ALLOWLIST) continue
      violations.push(rel)
    }
    expect(violations).toEqual([])
  })

  it('allowlist has no stale entries (every entry still has a direct call site)', () => {
    const liveRelPaths = new Set(directCallSites.map(toRepoRelative))
    const stale = Object.keys(COMMAND_GUARD_ALLOWLIST).filter((rel) => !liveRelPaths.has(rel))
    expect(stale).toEqual([])
  })

  it('every allowlist entry carries a non-empty reason', () => {
    for (const [rel, reason] of Object.entries(COMMAND_GUARD_ALLOWLIST)) {
      expect(typeof reason).toBe('string')
      expect(reason.trim().length).toBeGreaterThan(0)
      expect(rel).toMatch(/^packages\//)
    }
  })
})
