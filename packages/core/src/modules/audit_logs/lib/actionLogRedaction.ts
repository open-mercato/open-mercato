import type { EntityManager } from '@mikro-orm/postgresql'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'

type SoftResolver = {
  resolve: <R = unknown>(name: string) => R
  hasRegistration?: (name: string) => boolean
}

/**
 * Per-module local soft-resolve helper — see `packages/core/AGENTS.md` §
 * Cross-Module Coupling. A module simply not registering `name` (its
 * provider is absent, e.g. the owning module is disabled) is expected and
 * not reported. A registered token that fails to resolve — a broken
 * provider — is NOT indistinguishable from absence: it is reported, since
 * silently treating it as "absent" would hide a real initialization failure
 * behind the same fail-closed suppression.
 */
function tryResolve<T>(resolver: SoftResolver, name: string): T | undefined {
  if (typeof resolver.hasRegistration === 'function' && !resolver.hasRegistration(name)) return undefined
  try {
    return resolver.resolve<T>(name)
  } catch (err) {
    getTelemetryRuntime()?.reportError(err, {
      module: 'audit_logs',
      code: 'audit_logs.redaction_provider_resolve_failed',
    })
    return undefined
  }
}

export type ActionLogRedactionContext = unknown

/**
 * Generic action-log redaction extension point (#8887, #8978). A module that
 * owns privacy-sensitive resource kinds (e.g. `customers`) registers an
 * `ActionLogRedactionProvider` under the `actionLogRedactionProvider` DI key
 * from its OWN `di.ts` — this generic audit infrastructure never defines,
 * imports, or names that module's types or services (see
 * `packages/core/AGENTS.md` § Cross-Module Coupling: "the upstream module
 * MUST NOT import, resolve, or hard-require the consumer").
 */
export type ActionLogRedactionProvider = {
  loadContext: (
    em: EntityManager,
    scope: { tenantId: string; organizationId: string | null },
    viewerUserId: string | null,
  ) => Promise<ActionLogRedactionContext>
  redactEntry: (entry: ActionLog, ctx: ActionLogRedactionContext) => ActionLog
}

const REDACTION_PROVIDER_DI_KEY = 'actionLogRedactionProvider'

/**
 * `resourceKind` prefixes that stay privacy-protected even when no provider
 * can be resolved for them. Disabling the owning module does not delete its
 * `action_logs` rows (#8978) — module absence is not evidence that the
 * underlying private data is gone, so these MUST fail CLOSED (suppressed),
 * never pass through unredacted. This is the only knowledge this generic
 * module keeps about an optional peer; the actual redaction logic always
 * lives in the registered provider.
 */
const PROTECTED_RESOURCE_KIND_PREFIXES: readonly string[] = ['customers.']

function isProtectedResourceKind(resourceKind: string | null | undefined): boolean {
  if (!resourceKind) return false
  return PROTECTED_RESOURCE_KIND_PREFIXES.some((prefix) => resourceKind.startsWith(prefix))
}

/**
 * Replaces a protected entry's payload with redacted placeholders. Used when
 * no provider is available to apply the real, fine-grained visibility rule —
 * suppressing is the safe default; it never leaks private content.
 */
function suppressProtectedEntry(entry: ActionLog): ActionLog {
  return {
    ...entry,
    snapshotBefore: null,
    snapshotAfter: null,
    changesJson: null,
  }
}

/**
 * Applies the registered redaction provider to every entry. Entries whose
 * `resourceKind` is privacy-protected (see `PROTECTED_RESOURCE_KIND_PREFIXES`)
 * are suppressed — not passed through — when no provider is available to
 * apply the real visibility rule. Entries outside that allowlist are never
 * touched by this module.
 */
export async function redactActionLogEntries(
  container: SoftResolver,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
  viewerUserId: string | null,
  entries: ActionLog[],
): Promise<ActionLog[]> {
  const provider = tryResolve<ActionLogRedactionProvider>(container, REDACTION_PROVIDER_DI_KEY)
  if (!provider) {
    return entries.map((entry) => (isProtectedResourceKind(entry.resourceKind) ? suppressProtectedEntry(entry) : entry))
  }
  const ctx = await provider.loadContext(em, scope, viewerUserId)
  return entries.map((entry) => (isProtectedResourceKind(entry.resourceKind) ? provider.redactEntry(entry, ctx) : entry))
}
