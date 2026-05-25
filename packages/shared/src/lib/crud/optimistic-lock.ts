/**
 * OSS opt-in optimistic-locking guard service.
 *
 * Registered as `crudMutationGuardService` in a module's `di.ts`. Compares
 * the client-sent expected `updated_at` (carried via the extension header
 * defined in `optimistic-lock-headers.ts`) against the current DB
 * `updated_at` for the target entity; on mismatch returns HTTP 409 with the
 * structured `OptimisticLockConflictBody`.
 *
 * Default OFF. Activate via `OM_OPTIMISTIC_LOCK`:
 *   - unset / empty                 → OFF (no behavior change)
 *   - `all`                         → all entities
 *   - `customers.company,sales.order` → allow-list (lowercased, trimmed, deduped)
 *
 * Cannot be registered as a static `data/guards.ts` `MutationGuard` because
 * the static `validate(input)` receives only `MutationGuardInput` — no
 * container / em access. Stateful checks that need to read current DB state
 * MUST go through the DI service path (this file).
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CrudMutationGuardValidateInput,
  CrudMutationGuardValidationResult,
  CrudMutationGuardAfterSuccessInput,
} from './mutation-guard'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_ENV_VAR,
  OPTIMISTIC_LOCK_HEADER_NAME,
  type OptimisticLockConflictBody,
} from './optimistic-lock-headers'
import { getAllOptimisticLockReaders } from './optimistic-lock-store'

export type OptimisticLockConfig =
  | { mode: 'off' }
  | { mode: 'all' }
  | { mode: 'allowlist'; entities: ReadonlySet<string> }

/**
 * Pure parser for `OM_OPTIMISTIC_LOCK`. Exported separately so tests can
 * exercise the grammar without spinning up the full service.
 */
export function parseOptimisticLockEnv(raw: string | undefined | null): OptimisticLockConfig {
  if (raw == null) return { mode: 'off' }
  const trimmed = String(raw).trim()
  if (trimmed === '') return { mode: 'off' }

  const tokens = trimmed
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)

  if (tokens.length === 0) return { mode: 'off' }
  if (tokens.includes('all')) return { mode: 'all' }

  return { mode: 'allowlist', entities: new Set(tokens) }
}

export type OptimisticLockResolverInput = {
  expectedFromHeader: string | null
  resourceKind: string
  resourceId: string
}

/**
 * Hook reserved for the enterprise `record_locks` module to override token
 * resolution (e.g. read the expected token from a lock record instead of
 * the request header). OSS keeps the default = "what the client sent".
 *
 * Documented as part of the enterprise extension contract; not used in OSS
 * itself.
 */
export type ResolveExpectedUpdatedAt = (
  input: OptimisticLockResolverInput,
) => Promise<string | null> | string | null

const defaultResolveExpectedUpdatedAt: ResolveExpectedUpdatedAt = ({ expectedFromHeader }) =>
  expectedFromHeader

export type OptimisticLockCurrentReader = (
  em: EntityManager,
  input: { resourceKind: string; resourceId: string; tenantId: string; organizationId: string | null },
) => Promise<string | null>

export type OptimisticLockGuardOptions = {
  /** EntityManager resolver. Container-bound via DI in real usage. */
  getEm: () => EntityManager
  /**
   * Maps `resourceKind` → reader that returns the current
   * `updated_at` as an ISO string (or null when not found).
   *
   * The reader receives the EM so module authors can choose the
   * right `findOne` shape for their entity (`findOneWithDecryption`
   * when sensitive, plain `findOne` otherwise — but only requesting
   * `updated_at` so no PII materializes).
   *
   * When omitted, the service pulls readers from the shared
   * `optimistic-lock-store` (the recommended pattern for multi-module
   * deployments — each module registers its own readers via
   * `registerOptimisticLockReaders(...)` at module-load time).
   */
  readers?: Record<string, OptimisticLockCurrentReader>
  /** Override env source (mostly for tests). Defaults to `process.env`. */
  envValue?: string | null
  /** Override the token resolver. Defaults to "use the header value". */
  resolveExpected?: ResolveExpectedUpdatedAt
}

export type OptimisticLockGuardService = {
  validateMutation: (input: CrudMutationGuardValidateInput) => Promise<CrudMutationGuardValidationResult>
  afterMutationSuccess: (input: CrudMutationGuardAfterSuccessInput) => Promise<void>
  /** Exposed for tests / introspection. */
  getConfig: () => OptimisticLockConfig
}

function readHeader(headers: Headers, name: string): string | null {
  const direct = headers.get(name)
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim()
  return null
}

function normalizeIsoToken(raw: string): string | null {
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function buildConflictBody(currentIso: string, expectedIso: string): OptimisticLockConflictBody {
  return {
    error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
    code: OPTIMISTIC_LOCK_CONFLICT_CODE,
    currentUpdatedAt: currentIso,
    expectedUpdatedAt: expectedIso,
  }
}

/**
 * Factory for the optimistic-lock guard service.
 *
 * Usage from a module's `di.ts`:
 *
 * ```ts
 * import { asFunction } from 'awilix'
 * import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
 *
 * container.register({
 *   crudMutationGuardService: asFunction((cradle) => createOptimisticLockGuardService({
 *     getEm: () => cradle.em,
 *     readers: {
 *       'customers.company': async (em, { resourceId, tenantId }) => {
 *         const row = await em.findOne(Company, { id: resourceId, tenantId }, { fields: ['updatedAt'] })
 *         return row?.updatedAt ? row.updatedAt.toISOString() : null
 *       },
 *     },
 *   })).singleton(),
 * })
 * ```
 */
export function createOptimisticLockGuardService(
  opts: OptimisticLockGuardOptions,
): OptimisticLockGuardService {
  const envValue = opts.envValue !== undefined ? opts.envValue : process.env[OPTIMISTIC_LOCK_ENV_VAR]
  const config = parseOptimisticLockEnv(envValue)
  const resolveExpected = opts.resolveExpected ?? defaultResolveExpectedUpdatedAt

  function isEntityEnabled(resourceKind: string): boolean {
    if (config.mode === 'off') return false
    if (config.mode === 'all') return true
    return config.entities.has(resourceKind.toLowerCase())
  }

  const debug = process.env.OM_OPTIMISTIC_LOCK_DEBUG === '1'
  const log = (...args: unknown[]): void => {
    if (debug) console.log('[optimistic-lock]', ...args)
  }

  async function validateMutation(
    input: CrudMutationGuardValidateInput,
  ): Promise<CrudMutationGuardValidationResult> {
    // ============ DIAGNOSTIC MODE (gated by OM_OPTIMISTIC_LOCK_DEBUG=1) ============
    // Only fires when the request CARRIES the lock header but the guard would
    // have otherwise returned ok — surfaces the skip reason in the response
    // body so the test failure carries diagnostic info. The no-header path
    // (test 1 'writes without the header always succeed') still returns ok
    // and PUTs go through normally.
    const headerForDebug = readHeader(input.requestHeaders, OPTIMISTIC_LOCK_HEADER_NAME)
    const debugIfHeader = (reason: string, extra?: Record<string, unknown>): CrudMutationGuardValidationResult | null => {
      if (!debug) return null
      if (!headerForDebug) return null
      return {
        ok: false,
        status: 422,
        body: {
          error: 'optimistic_lock_DEBUG',
          reason,
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
          operation: input.operation,
          configMode: config.mode,
          headerName: OPTIMISTIC_LOCK_HEADER_NAME,
          headerValueReceived: headerForDebug,
          allHeaderNames: Array.from(input.requestHeaders.keys()),
          ...(extra ?? {}),
        },
      }
    }
    log('validateMutation', { resourceKind: input.resourceKind, resourceId: input.resourceId, operation: input.operation, configMode: config.mode })
    if (config.mode === 'off') {
      log('skip: config off')
      const dbg = debugIfHeader('config_off'); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }
    if (input.operation !== 'update' && input.operation !== 'delete') {
      log('skip: not update/delete')
      const dbg = debugIfHeader('not_update_or_delete'); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }
    if (!isEntityEnabled(input.resourceKind)) {
      log('skip: entity not enabled', input.resourceKind, config)
      const dbg = debugIfHeader('entity_not_enabled', { config: JSON.stringify(config) }); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }
    const readers = opts.readers ?? getAllOptimisticLockReaders()
    const reader = readers[input.resourceKind]
    if (!reader) {
      log('skip: no reader for', input.resourceKind, 'available keys:', Object.keys(readers))
      const dbg = debugIfHeader('no_reader', { availableReaderKeys: Object.keys(readers) }); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }

    const expectedRaw = readHeader(input.requestHeaders, OPTIMISTIC_LOCK_HEADER_NAME)
    log('expectedRaw from header', { headerName: OPTIMISTIC_LOCK_HEADER_NAME, value: expectedRaw, allHeaderNames: Array.from(input.requestHeaders.keys()) })
    const resolvedExpected = await resolveExpected({
      expectedFromHeader: expectedRaw,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
    })
    if (resolvedExpected == null) {
      log('skip: resolvedExpected null')
      const dbg = debugIfHeader('resolved_expected_null', { expectedRaw }); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }

    const expectedIso = normalizeIsoToken(resolvedExpected)
    if (expectedIso == null) {
      log('skip: expectedIso null', resolvedExpected)
      const dbg = debugIfHeader('expected_iso_null', { resolvedExpected }); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }

    const em = opts.getEm()
    const currentRaw = await reader(em, {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      tenantId: input.tenantId,
      organizationId: input.organizationId ?? null,
    })
    log('reader returned currentRaw', currentRaw)
    if (currentRaw == null) {
      log('skip: currentRaw null')
      const dbg = debugIfHeader('current_raw_null', { expectedIso, tenantId: input.tenantId, organizationId: input.organizationId }); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }
    const currentIso = normalizeIsoToken(currentRaw)
    if (currentIso == null) {
      log('skip: currentIso null')
      const dbg = debugIfHeader('current_iso_null', { currentRaw, expectedIso }); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }

    log('compare', { expectedIso, currentIso, match: currentIso === expectedIso })
    if (currentIso === expectedIso) {
      // Note: this path IS expected to succeed for the first fresh PUT in test 2.
      // We surface it as 422 in debug mode only if the test was sending a STALE token —
      // can't distinguish that here, so we surface ALL matches and let the test help diagnose.
      const dbg = debugIfHeader('compare_match_ok', { expectedIso, currentIso }); if (dbg) return dbg
      return { ok: true, shouldRunAfterSuccess: false }
    }

    return {
      ok: false,
      status: 409,
      body: buildConflictBody(currentIso, expectedIso),
    }
  }

  async function afterMutationSuccess(_input: CrudMutationGuardAfterSuccessInput): Promise<void> {
    // no-op: optimistic check has no post-success cleanup
  }

  function getConfig(): OptimisticLockConfig {
    return config
  }

  return {
    validateMutation,
    afterMutationSuccess,
    getConfig,
  }
}
