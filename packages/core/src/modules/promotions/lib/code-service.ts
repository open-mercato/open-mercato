import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, isCrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { Code, CodeReservation, CodeUsage, GeneratedCode, type PromotionCodeType } from '../data/entities'
import type {
  CodeReservationResult,
  CodeUseResult,
  CodeValidationResult,
  ReserveCodeInput,
  UseCodeInput,
} from './types'

// SPEC-055 §Code Lifecycle / §Amendment A.2a (Release 4 PLAN.md Step 6.2). This file is
// `promotions`' own `lib/code-service.ts` named by the spec's Implementation Plan
// (`promotionCodeService` DI token, §Release 4 Contract Freeze) — the business-logic
// layer `commands/codes.ts`'s three registered commands (`reserve`/`release`/`use`) wrap,
// and that `lib/promotions-service.ts`'s `validateCode`/`extendReservation` call directly
// (§A.2a: those two are plain reads/housekeeping, never commanded).

export type PromotionsCodeScope = { tenantId: string; organizationId: string }

// §Data Models (rev C7/D-R4-8): `created_at + 24h`, extended on `extendReservation`.
const CODE_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000

// §Code Lifecycle / `codes/reserve`: "unknown, inactive and exhausted codes answer with
// the same error shape" — this one reason string covers all three so there is no
// enumeration oracle. `code_requires_identified_customer` is the one distinct, named
// reason the endpoint text calls out separately.
export const CODE_INVALID_REASON = 'code_invalid'
export const CODE_REQUIRES_IDENTIFIED_CUSTOMER_REASON = 'code_requires_identified_customer'

export type ResolvedCode = {
  code: Code
  type: PromotionCodeType
  generatedCode: GeneratedCode | null
}

export type CodeEligibilityResult = { ok: true } | { ok: false; reason: string }

function codeInvalidError(): CrudHttpError {
  return new CrudHttpError(422, { error: CODE_INVALID_REASON })
}

function codeRequiresIdentifiedCustomerError(): CrudHttpError {
  return new CrudHttpError(422, { error: CODE_REQUIRES_IDENTIFIED_CUSTOMER_REASON })
}

function eligibilityFailureError(reason: string): CrudHttpError {
  return reason === CODE_REQUIRES_IDENTIFIED_CUSTOMER_REASON
    ? codeRequiresIdentifiedCustomerError()
    : codeInvalidError()
}

/**
 * §Data Models rev W5d: `Code.code` and `GeneratedCode.code` share one normalised code
 * namespace per `(tenant_id, organization_id)` — a `codeString` lookup checks BOTH
 * tables. Verified per Step 6.1's own flagged gap: nothing in this module's schema
 * enforces that namespace across the two tables at the DB level (only `Code.code`'s own
 * partial unique index and `GeneratedCode.code`'s own per-tenant unique index are real
 * constraints) — it is an application-level rule this function is the sole enforcement
 * point for. This step's own write paths (`reserveCode`/`useCode`) never INSERT into
 * either table, so they introduce no new collision risk; the code-generation worker that
 * will insert `GeneratedCode` rows (Step 6.4) is the one that must honor this namespace
 * when minting new codes.
 */
export async function resolveCodeByString(
  em: EntityManager,
  codeString: string,
  scope: PromotionsCodeScope,
): Promise<ResolvedCode | null> {
  // QA F9 (Low/UX, confirmed live): `Code.code`/`GeneratedCode.code` are stored
  // upper-cased (`data/validators.ts`'s `codeBaseShape`) — normalize the presented string
  // the same way so a buyer typing `summer10` resolves the same row as a stored
  // `SUMMER10`. Every caller (reserve/release/use/validate) funnels through this one
  // function, so this single normalization closes the gap for all of them.
  const normalizedCodeString = codeString.trim().toUpperCase()
  const staticCode = await em.findOne(Code, {
    code: normalizedCodeString,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (staticCode) {
    return { code: staticCode, type: 'static', generatedCode: null }
  }

  const generatedCode = await em.findOne(GeneratedCode, {
    code: normalizedCodeString,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!generatedCode) return null

  const parentCode = await em.findOne(Code, {
    id: generatedCode.codeId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!parentCode) return null

  return { code: parentCode, type: 'dynamic', generatedCode }
}

/** Static-code global-use headroom. Dynamic codes track their own use via `GeneratedCode.active`. */
export function hasRemainingGlobalUses(code: Code): boolean {
  if (code.usage === 'unlimited') return true
  if (code.usage === 'single') return code.used < 1
  return code.usageAmount == null || code.used < code.usageAmount
}

function isCodeActiveForUse(resolved: ResolvedCode): boolean {
  if (!resolved.code.active) return false
  if (resolved.type === 'dynamic') return resolved.generatedCode?.active === true
  return true
}

/**
 * §Data Models rev C7/D-R4-8: the per-customer limit is counted as `CodeUsage` rows
 * PLUS every OTHER cart's still-active `CodeReservation` rows for that customer — never
 * `CodeUsage` alone, which let two carts both pass the check and race to the single
 * remaining use. `excludeCartId` is the calling cart's own id: a cart re-reserving (or
 * using) a code it already holds a reservation for must not have that same reservation
 * count against itself.
 */
export async function countActiveCustomerUsage(
  em: EntityManager,
  codeId: string,
  customerId: string,
  scope: PromotionsCodeScope,
  excludeCartId: string,
): Promise<number> {
  const usageCount = await em.count(CodeUsage, {
    codeId,
    customerId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const reservationCount = await em.count(CodeReservation, {
    codeId,
    customerId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    cartId: { $ne: excludeCartId },
    expiresAt: { $gt: new Date() },
  })
  return usageCount + reservationCount
}

/**
 * Shared eligibility check behind `reserveCode`, `validateCode` and `useCode`'s
 * under-lock re-check — code resolution, active + remaining-global-uses, and the
 * per-customer limit (counting `CodeUsage` + other carts' active `CodeReservation`s). A
 * `null` customerId against a code carrying a per-customer limit fails closed with the
 * one distinct, named reason; every other failure collapses to the same uniform reason.
 */
export async function evaluateCodeEligibility(
  em: EntityManager,
  resolved: ResolvedCode | null,
  params: { customerId: string | null; cartId: string; scope: PromotionsCodeScope },
): Promise<CodeEligibilityResult> {
  if (!resolved) return { ok: false, reason: CODE_INVALID_REASON }
  if (!isCodeActiveForUse(resolved)) return { ok: false, reason: CODE_INVALID_REASON }
  if (resolved.type === 'static' && !hasRemainingGlobalUses(resolved.code)) {
    return { ok: false, reason: CODE_INVALID_REASON }
  }

  const limit = resolved.code.usagePerCustomer
  if (limit != null) {
    if (params.customerId === null) {
      return { ok: false, reason: CODE_REQUIRES_IDENTIFIED_CUSTOMER_REASON }
    }
    const count = await countActiveCustomerUsage(em, resolved.code.id, params.customerId, params.scope, params.cartId)
    if (count >= limit) return { ok: false, reason: CODE_INVALID_REASON }
  }

  return { ok: true }
}

async function upsertReservation(
  em: EntityManager,
  resolved: ResolvedCode,
  input: ReserveCodeInput,
  scope: PromotionsCodeScope,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CODE_RESERVATION_TTL_MS)
  const existing = await em.findOne(CodeReservation, {
    codeId: resolved.code.id,
    cartId: input.cartId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existing) {
    // §Code Lifecycle: idempotent per `(code, cart)` — a second `reserve` call extends
    // the TTL rather than erroring or inserting a duplicate row.
    existing.expiresAt = expiresAt
    existing.codeString = input.codeString
    existing.customerId = input.customerId
    await em.flush()
    return
  }

  try {
    const reservation = em.create(CodeReservation, {
      codeId: resolved.code.id,
      codeString: input.codeString,
      cartId: input.cartId,
      customerId: input.customerId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      expiresAt,
    })
    em.persist(reservation)
    await em.flush()
  } catch (err) {
    // `promotion_code_reservations_code_customer_unique` — a second cart for the SAME
    // customer losing the race on this partial index (two concurrent `reserve` calls both
    // passing `evaluateCodeEligibility`'s pre-check before either inserts) is a genuine
    // eligibility failure, not an idempotent retry: the eligibility check would have
    // rejected this exact call had it run a moment later, so surface the same clean 422
    // instead of an unhandled 500.
    if (input.customerId != null && isUniqueViolation(err, 'promotion_code_reservations_code_customer_unique')) {
      throw eligibilityFailureError(CODE_INVALID_REASON)
    }
    // §Data Models: `UNIQUE (code_id, cart_id)` — a losing concurrent insert for the
    // exact same (code, cart) pair is the idempotent-extend case, not an error: treat it
    // the same as the `existing` branch above instead of surfacing the DB error.
    if (!isUniqueViolation(err)) throw err
    const raced = await em.findOne(CodeReservation, {
      codeId: resolved.code.id,
      cartId: input.cartId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!raced) throw err
    raced.expiresAt = expiresAt
    raced.codeString = input.codeString
    raced.customerId = input.customerId
    await em.flush()
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (§`codes/reserve`: "Rate-limited ... to blunt brute-force code
// guessing"). Env prefix follows this release's established `CART_*` convention
// (`cart/lib/rateLimit.ts`) with this module's own `PROMOTIONS_*` prefix — resolved env
// vars are `RATE_LIMIT_PROMOTIONS_CODE_RESERVE_{POINTS,DURATION,BLOCK_DURATION}`. Default
// budget: 20 attempts / 60s, keyed by `tenantId:organizationId:cartId` — the only stable
// actor identity available at this DI-service layer (no HTTP request/IP exists here;
// `cart` and any other in-process caller share one cart id per guessing session).
// ---------------------------------------------------------------------------

const PROMOTIONS_CODE_RESERVE_RATE_LIMIT_ENV_PREFIX = 'PROMOTIONS_CODE_RESERVE'
const PROMOTIONS_CODE_RESERVE_RATE_LIMIT_POINTS = 20
const PROMOTIONS_CODE_RESERVE_RATE_LIMIT_WINDOW_SECONDS = 60
const PROMOTIONS_CODE_RESERVE_RATE_LIMIT_KEY_PREFIX = 'promotions_code_reserve'

function readPromotionsCodeReserveRateLimitConfig(): RateLimitConfig {
  return readEndpointRateLimitConfig(PROMOTIONS_CODE_RESERVE_RATE_LIMIT_ENV_PREFIX, {
    points: PROMOTIONS_CODE_RESERVE_RATE_LIMIT_POINTS,
    duration: PROMOTIONS_CODE_RESERVE_RATE_LIMIT_WINDOW_SECONDS,
    keyPrefix: PROMOTIONS_CODE_RESERVE_RATE_LIMIT_KEY_PREFIX,
  })
}

export type PromotionCodeServiceContainer = {
  resolve: <T = unknown>(name: string) => T
}

function resolveRateLimiter(container: PromotionCodeServiceContainer): RateLimiterService | null {
  try {
    return container.resolve<RateLimiterService>('rateLimiterService') ?? null
  } catch {
    return null
  }
}

export class PromotionCodeService {
  constructor(private readonly container: PromotionCodeServiceContainer) {}

  /**
   * Fail-open on a missing/erroring limiter (same default as `cart/lib/rateLimit.ts`'s
   * `enforceCartRateLimit`) — a degraded rate limiter must not block code reservation
   * outright. Fails closed (429) only when the limiter is reachable and reports the
   * budget exhausted.
   */
  private async enforceReserveRateLimit(cartId: string, scope: PromotionsCodeScope): Promise<void> {
    const limiter = resolveRateLimiter(this.container)
    if (!limiter) return
    try {
      const key = `${scope.tenantId}:${scope.organizationId}:${cartId}`
      const result = await limiter.consume(key, readPromotionsCodeReserveRateLimitConfig())
      if (!result.allowed) {
        throw new CrudHttpError(429, { error: '[internal] promotions code reserve rate limit exceeded' })
      }
    } catch (err) {
      if (isCrudHttpError(err)) throw err
      // Limiter backing store unreachable: serve without a limit rather than block.
    }
  }

  async reserveCode(em: EntityManager, input: ReserveCodeInput, scope: PromotionsCodeScope): Promise<CodeReservationResult> {
    await this.enforceReserveRateLimit(input.cartId, scope)

    const resolved = await resolveCodeByString(em, input.codeString, scope)
    const eligibility = await evaluateCodeEligibility(em, resolved, {
      customerId: input.customerId,
      cartId: input.cartId,
      scope,
    })
    if (!eligibility.ok) throw eligibilityFailureError(eligibility.reason)
    // `eligibility.ok` is true only when `resolveCodeByString` found a code (see
    // `evaluateCodeEligibility`'s first check), so `resolved` is guaranteed non-null here.
    const found = resolved!

    await upsertReservation(em, found, input, scope)

    return { ok: true, codeId: found.code.id, type: found.type }
  }

  async extendReservation(em: EntityManager, codeId: string, cartId: string, scope: PromotionsCodeScope): Promise<void> {
    const reservation = await em.findOne(CodeReservation, {
      codeId,
      cartId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    // No matching reservation: documented no-op. The caller (eventually `cart`'s own
    // "extend reservation on cart activity" need, Step 7.2) calls this opportunistically
    // on cart activity and does not know (or care) whether a reservation already exists.
    if (!reservation) return
    reservation.expiresAt = new Date(Date.now() + CODE_RESERVATION_TTL_MS)
    await em.flush()
  }

  async validateCode(em: EntityManager, input: ReserveCodeInput, scope: PromotionsCodeScope): Promise<CodeValidationResult> {
    const resolved = await resolveCodeByString(em, input.codeString, scope)
    const eligibility = await evaluateCodeEligibility(em, resolved, {
      customerId: input.customerId,
      cartId: input.cartId,
      scope,
    })
    return eligibility.ok ? { valid: true } : { valid: false, reason: eligibility.reason }
  }

  /**
   * §Code Lifecycle / `codes/use` (rev — C6/D-R4-12, the serializable-isolation claim
   * corrected): locks the `Code` row (`SELECT ... FOR UPDATE` via
   * `LockMode.PESSIMISTIC_WRITE`) inside the transaction `withAtomicFlush` opens (or the
   * ambient one `ctx.transactionalEm` joins, via the command in `commands/codes.ts`),
   * re-reads eligibility under that lock, then proceeds — correct under a joined
   * transaction with no `40001` retry loop. For a dynamic code the `GeneratedCode` row is
   * locked too, since that is the row whose `active` flag carries the mutable "is this
   * voucher still usable" state. Never serializable isolation — `withAtomicFlush` ignores
   * `isolationLevel` on an ambient transaction and no retry helper exists for it anyway.
   */
  async useCode(em: EntityManager, input: UseCodeInput, scope: PromotionsCodeScope): Promise<CodeUseResult> {
    let code!: Code
    let generatedCode: GeneratedCode | null = null

    await withAtomicFlush(
      em,
      [
        async () => {
          const lockedCode = await em.findOne(
            Code,
            { id: input.codeId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          )
          if (!lockedCode) throw codeInvalidError()
          code = lockedCode

          if (input.type === 'dynamic') {
            // QA F9's grep sweep: this lookup is a direct `GeneratedCode` query (needed
            // for the row lock), not a call through `resolveCodeByString` — it must apply
            // the SAME trim+uppercase normalization that function does, or a caller
            // forwarding a buyer's raw-cased `codeString` here (e.g. `codes/use`'s HTTP
            // body) would miss the upper-cased stored row.
            const lockedGeneratedCode = await em.findOne(
              GeneratedCode,
              {
                codeId: code.id,
                code: input.codeString.trim().toUpperCase(),
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
              },
              { lockMode: LockMode.PESSIMISTIC_WRITE },
            )
            if (!lockedGeneratedCode) throw codeInvalidError()
            generatedCode = lockedGeneratedCode
          }

          const resolved: ResolvedCode = { code, type: input.type, generatedCode }
          const eligibility = await evaluateCodeEligibility(em, resolved, {
            customerId: input.customerId,
            cartId: input.cartId,
            scope,
          })
          if (!eligibility.ok) throw eligibilityFailureError(eligibility.reason)
        },
        () => {
          if (input.type === 'dynamic') {
            generatedCode!.active = false
          } else {
            code.used += 1
            if (!hasRemainingGlobalUses(code)) code.active = false
          }
        },
        () => {
          const usage = em.create(CodeUsage, {
            codeId: code.id,
            customerId: input.customerId,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
          })
          em.persist(usage)
        },
        async () => {
          await em.nativeDelete(CodeReservation, {
            codeId: code.id,
            cartId: input.cartId,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
          })
        },
      ],
      { transaction: true, label: 'promotions.code.use' },
    )

    return { ok: true }
  }

  /** Deletes the `CodeReservation` for that `(code, cartId)` pair only — never another cart's. */
  async releaseCode(em: EntityManager, codeId: string, cartId: string, scope: PromotionsCodeScope): Promise<void> {
    await em.nativeDelete(CodeReservation, {
      codeId,
      cartId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }
}
