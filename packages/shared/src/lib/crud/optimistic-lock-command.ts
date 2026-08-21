/**
 * Generalist command-level OSS optimistic-locking helper.
 *
 * The CRUD guard (`optimistic-lock.ts` + `makeCrudRoute`) only protects
 * mutations that flow through the CRUD factory. Domain writes implemented via
 * the Command pattern — sales document sub-resources (lines, adjustments,
 * shipments, payments, returns), status transitions, quote→order conversion,
 * etc. — run their own logic inside a command handler and never reach the CRUD
 * guard for the **aggregate** they mutate. This helper lets any command enforce
 * the same `updated_at` version check against an arbitrary target record
 * (typically the aggregate root, e.g. the parent order/quote) and fail with the
 * identical structured 409 the CRUD path returns.
 *
 * Contract (mirrors the CRUD guard so clients see one behavior):
 *   - The client sends the expected version via the
 *     `x-om-ext-optimistic-lock-expected-updated-at` header (or a command
 *     accepts it as a typed input field and passes it as `expected`).
 *   - The command loads the current record (it usually already does) and passes
 *     its `updated_at` as `current`.
 *   - On mismatch the helper throws `CrudHttpError(409, OptimisticLockConflictBody)`.
 *
 * Strictly additive: when no expected token is present (no header, no input
 * field) the helper is a no-op, so existing API consumers that don't send the
 * header keep working. Respects the same `OM_OPTIMISTIC_LOCK` env contract
 * (default ON; `off` disables; allow-list scopes by `resourceKind`).
 *
 * Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md (§ command-level checks)
 *       .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md (Phase 4)
 */
import type { AwilixContainer } from 'awilix'
import { CrudHttpError, isCrudHttpError } from './errors'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_ENV_VAR,
  OPTIMISTIC_LOCK_HEADER_NAME,
  type OptimisticLockConflictBody,
} from './optimistic-lock-headers'
import {
  normalizeIsoToken,
  parseOptimisticLockEnv,
  type OptimisticLockConfig,
  type OptimisticLockResolverInput,
  type ResolveExpectedUpdatedAt,
} from './optimistic-lock'

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return normalizeIsoToken(trimmed)
}

function resolveConfig(envValue: string | null | undefined): OptimisticLockConfig {
  return parseOptimisticLockEnv(envValue !== undefined ? envValue : process.env[OPTIMISTIC_LOCK_ENV_VAR])
}

function isResourceLockEnabled(config: OptimisticLockConfig, resourceKind: string): boolean {
  if (config.mode === 'off') return false
  if (config.mode === 'all') return true
  return config.entities.has(resourceKind.toLowerCase())
}

/**
 * Extract the expected `updated_at` token from a request's headers (or a bare
 * `Headers` object). Returns the trimmed header value, or `null` when absent /
 * empty. Does NOT normalize — `assertOptimisticLock` normalizes both sides.
 */
export function readOptimisticLockExpected(
  source: Request | Headers | null | undefined,
): string | null {
  if (!source) return null
  const headers = source instanceof Headers
    ? source
    : (source as Request).headers instanceof Headers
      ? (source as Request).headers
      : null
  if (!headers) return null
  const direct = headers.get(OPTIMISTIC_LOCK_HEADER_NAME)
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim()
  return null
}

export function buildOptimisticLockConflictBody(
  currentIso: string,
  expectedIso: string,
): OptimisticLockConflictBody {
  return {
    error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
    code: OPTIMISTIC_LOCK_CONFLICT_CODE,
    currentUpdatedAt: currentIso,
    expectedUpdatedAt: expectedIso,
  }
}

export type AssertOptimisticLockInput = {
  resourceKind: string
  resourceId: string
  /** Client-provided expected version (header value or typed input field). */
  expected: string | Date | null | undefined
  /** Current version loaded from the DB (typically the aggregate root's `updatedAt`). */
  current: string | Date | null | undefined
  /** Override `OM_OPTIMISTIC_LOCK` (mostly for tests). */
  envValue?: string | null
}

/**
 * Pure version assertion. Throws `CrudHttpError(409, OptimisticLockConflictBody)`
 * when the expected and current versions disagree.
 *
 * No-op (returns silently) when:
 *   - the env disables the guard for this `resourceKind`,
 *   - `expected` is missing / unparseable (strictly additive — clients that
 *     don't send the token are never blocked),
 *   - `current` is missing / unparseable (let the command's own 404 fire).
 */
export function assertOptimisticLock(input: AssertOptimisticLockInput): void {
  const config = resolveConfig(input.envValue)
  if (!isResourceLockEnabled(config, input.resourceKind)) return

  const expectedIso = toIsoOrNull(input.expected)
  if (expectedIso == null) return

  const currentIso = toIsoOrNull(input.current)
  if (currentIso == null) return

  if (currentIso === expectedIso) return

  throw new CrudHttpError(409, buildOptimisticLockConflictBody(currentIso, expectedIso))
}

export type EnforceCommandOptimisticLockInput = {
  resourceKind: string
  resourceId: string
  /** Current version loaded from the DB (the aggregate root's `updatedAt`). */
  current: string | Date | null | undefined
  /**
   * Explicit expected version — wins over the request header. Use when the
   * command accepts the token as a typed input field instead of (or in addition
   * to) the extension header.
   */
  expected?: string | Date | null
  /** Request whose headers carry the expected token (e.g. `ctx.request`). */
  request?: Request | Headers | null
  /** Override `OM_OPTIMISTIC_LOCK` (mostly for tests). */
  envValue?: string | null
}

/**
 * Command-handler convenience: resolves the expected version from an explicit
 * override or the request header, then delegates to `assertOptimisticLock`.
 *
 * ```ts
 * enforceCommandOptimisticLock({
 *   resourceKind: 'sales.order',
 *   resourceId: order.id,
 *   current: order.updatedAt,
 *   request: ctx.request,
 * })
 * ```
 */
export function enforceCommandOptimisticLock(input: EnforceCommandOptimisticLockInput): void {
  const expected = input.expected !== undefined && input.expected !== null
    ? input.expected
    : readOptimisticLockExpected(input.request ?? null)
  assertOptimisticLock({
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    expected,
    current: input.current,
    envValue: input.envValue,
  })
}

export type EnforceRecordGoneIsConflictInput = {
  resourceKind: string
  resourceId: string
  /** Explicit expected version — wins over the request header. */
  expected?: string | Date | null
  /** Request whose headers carry the expected token (e.g. `ctx.request`). */
  request?: Request | Headers | null
  /** Override `OM_OPTIMISTIC_LOCK` (mostly for tests). */
  envValue?: string | null
}

/**
 * Command-handler convenience for the *concurrent-delete* race: when a command
 * cannot find its target record (it was deleted in another tab) AND the client
 * opted into optimistic locking (sent the expected-version header / token),
 * throw the SAME structured `CrudHttpError(409, OptimisticLockConflictBody)`
 * the version-mismatch path returns — so a stale modal save surfaces the unified
 * "Record changed" conflict bar instead of a bare, generic 404.
 *
 * Strictly additive and fail-open: a no-op (returns silently) when the env
 * disables the guard for `resourceKind`, or when no expected token is present
 * (plain API consumers that never sent the header keep their existing 404).
 * The caller MUST still throw its own 404 afterwards for that no-token path:
 *
 * ```ts
 * if (!interaction) {
 *   enforceRecordGoneIsConflict({ resourceKind: 'customers.interaction', resourceId: id, request: ctx.request })
 *   throw new CrudHttpError(404, { error: 'Interaction not found' })
 * }
 * ```
 *
 * The gone record has no current version, so `currentUpdatedAt` echoes the
 * expected token (the body is used only for the conflict-bar copy + diagnostics;
 * the client keys off `code`, not the timestamps).
 */
export function enforceRecordGoneIsConflict(input: EnforceRecordGoneIsConflictInput): void {
  const config = resolveConfig(input.envValue)
  if (!isResourceLockEnabled(config, input.resourceKind)) return
  const clientSupplied = input.expected !== undefined && input.expected !== null
    ? input.expected
    : readOptimisticLockExpected(input.request ?? null)
  const expectedIso = toIsoOrNull(clientSupplied)
  if (expectedIso == null) return
  throw new CrudHttpError(409, buildOptimisticLockConflictBody(expectedIso, expectedIso))
}

/**
 * DI-resolvable command-level optimistic-lock guard. This is the framework
 * seam that lets BOTH layers protect Command-pattern writes through one
 * contract:
 *
 *   - **OSS** registers the default service (header/explicit token compare —
 *     identical to calling `enforceCommandOptimisticLock` directly).
 *   - **Enterprise** (`record_locks`) re-registers the same DI key with a
 *     `resolveExpected` that reads the held pessimistic lock's version, so a
 *     stale command write fails with the same structured 409 WITHOUT any
 *     command handler changing. Mirrors how enterprise already replaces the
 *     CRUD-path `crudMutationGuardService` (see `optimistic-lock.ts`).
 *
 * Command handlers depend only on this interface (resolved from the container),
 * never on a concrete implementation — that is what makes the next-PR
 * enterprise extension a pure DI swap.
 */
export type CommandOptimisticLockGuardService = {
  /**
   * Enforce the version check for a command-level mutation against an
   * aggregate/record. Async because an enterprise resolver may load the
   * expected token from a lock record. No-op (resolves silently) when the env
   * disables the guard for `resourceKind` or when no expected token is
   * resolved — strictly additive, exactly like {@link enforceCommandOptimisticLock}.
   * Throws `CrudHttpError(409, OptimisticLockConflictBody)` on mismatch.
   */
  enforce: (input: EnforceCommandOptimisticLockInput) => Promise<void>
}

export type CreateCommandOptimisticLockGuardServiceOptions = {
  /**
   * Override how the expected version is derived. Receives
   * `{ expectedFromHeader, resourceKind, resourceId }` (where
   * `expectedFromHeader` is the normalized client-supplied token — explicit
   * input or request header) and returns the expected token (or `null` to
   * skip). Defaults to "use the client-supplied token", which is the OSS
   * behavior. The enterprise `record_locks` module plugs a lock-backed
   * resolver here. Mirrors the CRUD guard's `resolveExpected`.
   */
  resolveExpected?: ResolveExpectedUpdatedAt
}

/**
 * Build a {@link CommandOptimisticLockGuardService}. With no options it is
 * behaviourally identical to {@link enforceCommandOptimisticLock} (header/
 * explicit compare), so the OSS default is a thin wrapper. Pass
 * `resolveExpected` to override token resolution (enterprise extension point).
 */
export function createCommandOptimisticLockGuardService(
  options: CreateCommandOptimisticLockGuardServiceOptions = {},
): CommandOptimisticLockGuardService {
  const resolveExpected: ResolveExpectedUpdatedAt | null = options.resolveExpected ?? null
  return {
    async enforce(input: EnforceCommandOptimisticLockInput): Promise<void> {
      const config = resolveConfig(input.envValue)
      if (!isResourceLockEnabled(config, input.resourceKind)) return

      const clientSupplied = input.expected !== undefined && input.expected !== null
        ? input.expected
        : readOptimisticLockExpected(input.request ?? null)
      const expectedFromHeader = toIsoOrNull(clientSupplied)

      let expected: string | null = expectedFromHeader
      if (resolveExpected) {
        const resolverInput: OptimisticLockResolverInput = {
          expectedFromHeader,
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
        }
        expected = await resolveExpected(resolverInput)
      }

      assertOptimisticLock({
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        expected,
        current: input.current,
        envValue: input.envValue,
      })
    },
  }
}

const COMMAND_OPTIMISTIC_LOCK_GUARD_SERVICE_KEY = 'commandOptimisticLockGuardService'

function resolveCommandOptimisticLockGuardService(
  container: AwilixContainer,
): CommandOptimisticLockGuardService | null {
  try {
    const service = container.resolve<CommandOptimisticLockGuardService>(
      COMMAND_OPTIMISTIC_LOCK_GUARD_SERVICE_KEY,
    )
    if (!service || typeof service.enforce !== 'function') return null
    return service
  } catch {
    return null
  }
}

/**
 * Async, DI-aware command-level optimistic-lock runner (Phase 0 / S1). This is
 * the additive seam command handlers migrate to so BOTH the OSS floor and the
 * optional enterprise `record_locks` enrichment protect Command-pattern writes
 * through one call:
 *
 *   1. The OSS `updated_at` floor runs **unconditionally first** via the
 *      synchronous {@link enforceCommandOptimisticLock} — a stale write 409s
 *      here regardless of any record-lock token / widget state (H2). The legacy
 *      helper is reused verbatim, so the floor behaves identically to existing
 *      direct call sites.
 *   2. If the floor passes, the optional `commandOptimisticLockGuardService` is
 *      resolved from the request container and awaited for enrichment.
 *
 * Fail-closed delegation (H3): a `record_lock_conflict`/409 from the enterprise
 * service is rethrown (the write must be blocked), but ANY non-conflict error
 * from a broken/unregistered enterprise guard is swallowed — the request
 * degrades to OSS-only protection, never to "skip the guard".
 *
 * Strictly additive: with no enterprise service registered (OSS-only build) this
 * is exactly the OSS compare. The synchronous {@link enforceCommandOptimisticLock}
 * helper is left untouched for external callers.
 */
export async function enforceCommandOptimisticLockWithGuards(
  container: AwilixContainer,
  input: EnforceCommandOptimisticLockInput,
): Promise<void> {
  // 1. OSS floor — unconditional, synchronous, identical to direct call sites.
  enforceCommandOptimisticLock(input)

  // 2. Optional enterprise enrichment, fail-closed.
  const guard = resolveCommandOptimisticLockGuardService(container)
  if (!guard) return

  try {
    await guard.enforce(input)
  } catch (error) {
    // A real conflict must block the write; anything else degrades to OSS-only.
    if (isCrudHttpError(error) && error.status === 409) throw error
  }
}
