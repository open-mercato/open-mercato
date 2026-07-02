import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Workspace-wide optimistic-lock UI-coverage guard (record_locks Phase 6b Step 5).
 *
 * The original `optimistic-lock-ui-coverage.test.ts` only scans
 * `packages/core/src/modules`. This successor extends the same raw-mutation /
 * header audit to EVERY module package (`packages/<pkg>/src/modules`), so a mutating
 * UI file in `checkout`, `webhooks`, `enterprise`, `ai-assistant`, `scheduler`,
 * etc. cannot ship a `PUT`/`PATCH`/`DELETE` (or `updateCrud`/`deleteCrud`)
 * without participating in OSS optimistic locking — or carrying an explicit
 * decision.
 *
 * It scans BOTH `.tsx` AND `.ts` sources: raw UI mutation adapters routinely
 * live in plain `.ts` files (detail-section notes/address/activities adapters,
 * deal-association hooks). A `.tsx`-only sweep would let a `.ts` adapter regress
 * to `buildOptimisticLockHeader(undefined)` or drop the header while still
 * passing.
 *
 * A file is COVERED when it sends the expected-version header (lock primitives /
 * `<CrudForm>` auto-derive) OR carries an inline `optimistic-lock-exempt`
 * reason. CRITICAL (the bug this scan exists to catch): a bare
 * `buildOptimisticLockHeader(undefined)` / `buildOptimisticLockHeader(null)` is
 * NOT coverage — it sends NO version header. Such a tokenless call only counts
 * as covered when an inline `optimistic-lock-exempt` reason explains the
 * intentionally-tokenless write. Otherwise the scan would pass while the request
 * silently sends no version header (the integrations-bundle false positive).
 *
 * Files that are neither covered nor inline-exempt must appear in
 * WORKSPACE_ALLOWLIST with a concrete record_locks decision (enabled-elsewhere /
 * exempt / pre-existing-out-of-phase). A NEW mutating UI file that is neither
 * covered, inline-exempt, nor allowlisted fails this test. Do NOT weaken the
 * assertion — wire the header, add an inline exempt reason, or allowlist with a
 * documented reason.
 */

const MUTATION = /\b(deleteCrud|updateCrud)\s*\(|method:\s*['"](PUT|PATCH|DELETE)['"]/
// A lock primitive / CrudForm / inline exempt marker present in the file.
const COVERED_PRIMITIVE =
  /buildOptimisticLockHeader|withScopedApiRequestHeaders|withOptimisticLockFor|optimisticLockUpdatedAt|disableOptimisticLock|<CrudForm|optimistic-lock-exempt/
// A tokenless `buildOptimisticLockHeader(undefined|null)` — sends no version.
const TOKENLESS_HEADER = /buildOptimisticLockHeader\s*\(\s*(undefined|null)\s*\)/
const INLINE_EXEMPT = /optimistic-lock-exempt/
// A real version reference (anything that is NOT only the tokenless call). When a
// file references a lock primitive AND it is not the tokenless form, it is wired.
const HEADER_WITH_TOKEN = /buildOptimisticLockHeader\s*\(\s*(?!undefined\b|null\b)/
const OTHER_LOCK_PRIMITIVE =
  /withOptimisticLockFor|optimisticLockUpdatedAt|disableOptimisticLock|<CrudForm/

/**
 * Repo-relative (POSIX) path → record_locks decision. These are mutating UI
 * files outside this phase's Step-5 named scope (planner, api_keys, integrations,
 * webhooks, checkout, customer_accounts, attachments, translations) that send no
 * version header today. Each carries a concrete reason; this surfaces them so
 * they cannot masquerade as "covered" via a tokenless helper call.
 */
const WORKSPACE_ALLOWLIST: Record<string, string> = {
  // --- Pre-existing tokenless TODO sites outside this phase's named scope ---
  'packages/core/src/modules/sales/components/documents/AddressesSection.tsx':
    'exempt — sales document-address sub-resource; the parent document aggregate owns the optimistic lock at the command layer (sub-resource guarded by parent aggregate). Threading the document version into this section is tracked separately (#2373-C); not a standalone collaborative-edit record.',
  'packages/core/src/modules/inbox_ops/components/proposals/EditActionDialog.tsx':
    'pre-existing / out-of-phase — proposal-action payload edit; the ActionDetail response does not yet expose a record version (#2373-D). Outside record_locks Phase 6b Step-5 named scope.',
  // --- ai_assistant per-tenant config surfaces (single-admin settings) ---
  'packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/agents/AiAgentSettingsPageClient.tsx':
    'exempt — per-tenant AI agent enablement/override config (single-admin settings toggles), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/allowlist/AiTenantAllowlistPageClient.tsx':
    'exempt — per-tenant AI allowlist config (single-admin settings), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/ai-assistant/src/modules/ai_assistant/components/AiAssistantSettingsPageClient.tsx':
    'exempt — per-tenant AI assistant settings (single-admin config), not a collaborative-edit record surface. Outside Step-5 named scope.',
  // --- enterprise security / sso config surfaces ---
  'packages/enterprise/src/modules/security/backend/security/enforcement/[id]/page.tsx':
    'exempt — tenant security-enforcement policy config (single-admin), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/security/backend/security/enforcement/page.tsx':
    'exempt — tenant security-enforcement policy config (single-admin), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/security/backend/security/sudo/page.tsx':
    'exempt — sudo-session revoke (security action on the caller\'s own elevated session), idempotent and not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/security/components/GenericProviderSetup.tsx':
    'exempt — MFA/security provider setup config (single-admin), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/security/components/OtpEmailProviderDetails.tsx':
    'exempt — OTP-email provider config (single-admin), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/security/components/PasskeyProviderDetails.tsx':
    'exempt — passkey provider config (single-admin), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/security/components/TotpProviderDetails.tsx':
    'exempt — TOTP provider config (single-admin), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/sso/backend/page.tsx':
    'exempt — SSO config list-row delete (single-admin config), not a collaborative-edit record surface. Outside Step-5 named scope.',
  'packages/enterprise/src/modules/sso/backend/sso/config/[id]/page.tsx':
    'exempt — SSO provider config edit/delete (single-admin config), not a collaborative-edit record surface. Outside Step-5 named scope.',
  // --- scheduler config surfaces ---
  'packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/[id]/page.tsx':
    'exempt — scheduled-job config (single-admin scheduling config); job edits guarded at the command layer / outside Step-5 named scope.',
  'packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/page.tsx':
    'exempt — scheduled-job list-row delete (single-admin scheduling config). Outside Step-5 named scope.',
  // --- checkout list-row status toggles / quick delete (forms are covered via LinkTemplateForm) ---
  'packages/checkout/src/modules/checkout/backend/checkout/pay-links/page.tsx':
    'exempt — pay-link list-row status toggle (publish/deactivate = status transition, exempt) + quick delete; the collaborative form-edit surface (LinkTemplateForm) carries the host version and the command layer enforces it. Public pay flows are server-authoritative.',
  'packages/checkout/src/modules/checkout/backend/checkout/templates/page.tsx':
    'exempt — template list-row quick delete; the collaborative form-edit surface (LinkTemplateForm) carries the host version and the command layer enforces it.',
  'packages/checkout/src/modules/checkout/components/LogoUploadField.tsx':
    'exempt — deletes a previously-uploaded attachment as part of a logo replace (file cleanup), not a versioned collaborative-edit record surface.',
  // --- `.ts` adapters surfaced once the scan started collecting `.ts` (Phase-8) ---
  'packages/core/src/modules/resources/components/detail/activitiesAdapter.ts':
    'exempt — timeline activity-log adapter; the shared `ActivitiesDataAdapter` interface (packages/ui/src/backend/detail/ActivitiesSection.tsx) does not thread a record `updatedAt` to `update`/`delete` (unlike `NotesDataAdapter`), so no per-record version is available to send. Server routes are `makeCrudRoute` floor-covered. Threading a version into the shared activities section is a separate UI-contract change.',
  'packages/core/src/modules/staff/components/detail/activitiesAdapter.ts':
    'exempt — timeline activity-log adapter; same as the resources activities adapter — the shared `ActivitiesDataAdapter` interface passes no `updatedAt` to `update`/`delete`, so no record version is available. Server routes are `makeCrudRoute` floor-covered.',
  'packages/core/src/modules/messages/components/useMessagesInboxBulkActions.ts':
    'exempt — inbox bulk markRead/markUnread/archive are status transitions; bulk delete is a non-audited single-owner inbox action. Documented in the Phase-7 cross-cutting delete sweep.',
  'packages/enterprise/src/modules/security/components/hooks/useMfaStatus.ts':
    'exempt — removes the caller\'s OWN MFA method (single-owner security action), not a collaborative-edit record surface. Documented in the Phase-7 sweep ("mfa factor reset remain exempt").',
}

const packagesRoot = join(__dirname, '..', '..', '..')

/**
 * Whether a file should be scanned. We collect BOTH `.tsx` AND `.ts` sources:
 * raw UI mutation adapters frequently live in plain `.ts` files (e.g.
 * `components/detail/notesAdapter.ts`, `addressesAdapter.ts`, deal-association
 * hooks). A `.tsx`-only sweep would let a `.ts` adapter regress to
 * `buildOptimisticLockHeader(undefined)` or drop the header entirely while the
 * scan still passed. Test files and type-declaration files are excluded.
 */
function isScannableSource(name: string): boolean {
  if (name.endsWith('.d.ts')) return false
  if (name.endsWith('.test.tsx') || name.endsWith('.test.ts')) return false
  return name.endsWith('.tsx') || name.endsWith('.ts')
}

function collectSources(dir: string, acc: string[]): void {
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
      collectSources(full, acc)
    } else if (isScannableSource(name)) {
      acc.push(full)
    }
  }
}

function collectModulePackages(): string[] {
  const roots: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(packagesRoot)
  } catch {
    return roots
  }
  for (const pkg of entries) {
    const modulesDir = join(packagesRoot, pkg, 'src', 'modules')
    try {
      if (statSync(modulesDir).isDirectory()) roots.push(modulesDir)
    } catch {
      // package has no src/modules — skip
    }
  }
  return roots
}

function toRepoRelative(full: string): string {
  return join('packages', relative(packagesRoot, full)).split(sep).join('/')
}

/**
 * Coverage classifier — exported logic used by both the live scan and the
 * regression fixtures. A file is covered when it carries a real version header
 * (token-bearing helper or another lock primitive / CrudForm) OR an inline
 * exempt reason. A file whose ONLY lock reference is the tokenless
 * `buildOptimisticLockHeader(undefined|null)` is NOT covered.
 */
function isCovered(source: string): boolean {
  if (!COVERED_PRIMITIVE.test(source)) return false
  if (INLINE_EXEMPT.test(source)) return true
  if (HEADER_WITH_TOKEN.test(source)) return true
  if (OTHER_LOCK_PRIMITIVE.test(source)) return true
  // The only lock reference left is the tokenless header form → not covered.
  if (TOKENLESS_HEADER.test(source)) return false
  // `buildOptimisticLockHeader` referenced (e.g. imported/used) but the
  // token-bearing regex did not match a literal — treat as covered (real usage).
  return true
}

describe('optimistic locking (workspace) — mutating UI calls send the version header', () => {
  const moduleRoots = collectModulePackages()
  const files: string[] = []
  for (const root of moduleRoots) collectSources(root, files)
  const candidates = files.filter((f) => f.includes(`${sep}backend${sep}`) || f.includes(`${sep}components${sep}`))

  it('scans multiple workspace packages (not just core)', () => {
    expect(moduleRoots.length).toBeGreaterThan(3)
    expect(candidates.length).toBeGreaterThan(200)
  })

  it('every mutating UI file across packages is covered, inline-exempt, or allowlisted', () => {
    const violations: string[] = []
    for (const full of candidates) {
      const source = readFileSync(full, 'utf8')
      if (!MUTATION.test(source)) continue
      if (isCovered(source)) continue
      const rel = toRepoRelative(full)
      if (rel in WORKSPACE_ALLOWLIST) continue
      violations.push(rel)
    }
    expect(violations).toEqual([])
  })

  it('allowlist has no stale entries (every entry is still an uncovered mutating file)', () => {
    const stale: string[] = []
    for (const rel of Object.keys(WORKSPACE_ALLOWLIST)) {
      const full = join(packagesRoot, rel.replace(/^packages\//, ''))
      let source: string
      try {
        source = readFileSync(full, 'utf8')
      } catch {
        stale.push(`${rel} (not found)`)
        continue
      }
      if (!MUTATION.test(source)) stale.push(`${rel} (no mutating call)`)
      else if (isCovered(source)) stale.push(`${rel} (now covered - remove from allowlist)`)
    }
    expect(stale).toEqual([])
  })

  it('every allowlist entry carries a non-empty reason and a packages/ path', () => {
    for (const [rel, reason] of Object.entries(WORKSPACE_ALLOWLIST)) {
      expect(rel).toMatch(/^packages\//)
      expect(typeof reason).toBe('string')
      expect(reason.trim().length).toBeGreaterThan(0)
    }
  })

  describe('classifier regression fixtures (Phase 6b Step 5 requirement)', () => {
    it('true-positive: a tokenless buildOptimisticLockHeader(undefined) without an exempt reason is NOT covered', () => {
      const tokenlessNoExempt = `
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(undefined),
          () => apiCall('/api/x', { method: 'PUT', body: '{}' }),
        )
      `
      expect(MUTATION.test(tokenlessNoExempt)).toBe(true)
      expect(isCovered(tokenlessNoExempt)).toBe(false)
    })

    it('exempt-tokenless: the same tokenless write WITH an inline exempt reason IS covered', () => {
      const tokenlessExempt = `
        // optimistic-lock-exempt: single-admin config toggle, no per-record version
        await apiCall('/api/x/state', { method: 'PUT', body: '{}' })
      `
      expect(MUTATION.test(tokenlessExempt)).toBe(true)
      expect(isCovered(tokenlessExempt)).toBe(true)
    })

    it('a real token-bearing header IS covered', () => {
      const tokenBearing = `
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(record.updatedAt),
          () => deleteCrud('x', id),
        )
      `
      expect(MUTATION.test(tokenBearing)).toBe(true)
      expect(isCovered(tokenBearing)).toBe(true)
    })

    it('.ts adapter: a header-less updateCrud/deleteCrud (no CrudForm, no header) is NOT covered', () => {
      // Mirrors a plain `.ts` detail adapter (e.g. an activities adapter) that
      // never sends a version header — exactly the regression `.ts` collection
      // now catches.
      const tsAdapterNoHeader = `
        export function createActivitiesAdapter() {
          return {
            update: async ({ id, patch }) => { await updateCrud('mod/activities', { id, ...patch }) },
            delete: async ({ id }) => { await deleteCrud('mod/activities', { id }) },
          }
        }
      `
      expect(MUTATION.test(tsAdapterNoHeader)).toBe(true)
      expect(isCovered(tsAdapterNoHeader)).toBe(false)
    })

    it('.ts adapter: a header-bearing updateCrud/deleteCrud IS covered', () => {
      const tsAdapterWithHeader = `
        export function createNotesAdapter() {
          return {
            update: async ({ id, patch, updatedAt }) =>
              withScopedApiRequestHeaders(
                buildOptimisticLockHeader(updatedAt ?? null),
                () => updateCrud('mod/notes', { id, ...patch }),
              ),
          }
        }
      `
      expect(MUTATION.test(tsAdapterWithHeader)).toBe(true)
      expect(isCovered(tsAdapterWithHeader)).toBe(true)
    })
  })
})
