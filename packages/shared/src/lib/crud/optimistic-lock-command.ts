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
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md (§ command-level checks)
 *       .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md (Phase 4)
 */
import { CrudHttpError } from './errors'
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
