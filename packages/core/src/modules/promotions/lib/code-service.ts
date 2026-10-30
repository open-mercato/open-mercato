import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { CrudHttpError, isCrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { Code, CodeReservation, CodeUsage, GeneratedCode, type PromotionCodeType } from '../data/entities'
import type {
  CodeReservationResult,
  CodeUseResult,
  CodeValidationResult,
  RevertCodeUseInput,
  RevertCodeUseResult,
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
    if (!isUniqueViolation(err)) throw err

    // `promotion_code_reservations_code_customer_unique` has no `usagePerCustomer`-aware
    // WHERE clause (§Data Models) — it fires for ANY second reservation by the same
    // customer, even on a code that enforces no per-customer limit at all (review
    // finding: a logged-in customer who abandoned a cart was refused the same code on a
    // new cart, and so was a customer with the code on a second cart, even though the
    // code is unlimited per customer). Only a code that actually limits per-customer
    // reuse treats this as a genuine eligibility failure — two concurrent `reserve` calls
    // both passing `evaluateCodeEligibility`'s pre-check before either inserts, where the
    // check would have rejected this exact call a moment later. An unlimited code instead
    // moves the stale row onto THIS cart, the same idempotent-extend treatment the
    // `(code_id, cart_id)` race gets below.
    if (input.customerId != null && isUniqueViolation(err, 'promotion_code_reservations_code_customer_unique')) {
      if (resolved.code.usagePerCustomer != null) {
        throw eligibilityFailureError(CODE_INVALID_REASON)
      }
      const racedByCustomer = await em.findOne(CodeReservation, {
        codeId: resolved.code.id,
        customerId: input.customerId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (!racedByCustomer) throw err
      racedByCustomer.cartId = input.cartId
      racedByCustomer.expiresAt = expiresAt
      racedByCustomer.codeString = input.codeString
      await em.flush()
      return
    }

    // §Data Models: `UNIQUE (code_id, cart_id)` — a losing concurrent insert for the
    // exact same (code, cart) pair is the idempotent-extend case, not an error: treat it
    // the same as the `existing` branch above instead of surfacing the DB error.
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
   *
   * Idempotent on retry (C14 hardening): checkout's `recover-stuck-submits` worker
   * resumes a crashed submit by re-calling `continueOrderOutcome` from scratch, which
   * re-invokes this method with the SAME `(codeId, cartId, orderId)` for a use that may
   * already have committed in a prior, crashed attempt. Without a guard, a retry would
   * either double-consume a code with remaining global uses, or — for an exhausted/
   * single-use code — fail eligibility on the SECOND call and wrongly cancel an otherwise
   * already-redeemed, valid order (the exact C14 compensation-correctness failure this
   * hardening pass exists to close). A pre-existing, non-reverted `CodeUsage` for this
   * exact `(codeId, cartId, orderId)` tuple proves the use already landed durably in an
   * earlier, committed transaction — that case short-circuits before any lock, re-eval or
   * counter increment, returning the same `{ ok: true }` the original call returned.
   */
  async useCode(em: EntityManager, input: UseCodeInput, scope: PromotionsCodeScope): Promise<CodeUseResult> {
    const priorUsage = await em.findOne(CodeUsage, {
      codeId: input.codeId,
      cartId: input.cartId,
      orderId: input.orderId ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      revertedAt: null,
    })
    if (priorUsage) {
      return { ok: true }
    }

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
            // Release 5 C5/SPEC-055 amendment: record what this use can be reversed
            // against — the reserving cart always, the order when the caller already
            // knows it (checkout's Phase 4 submit calls `useCode` after document
            // creation), and the SPECIFIC generated code for a dynamic use so
            // `revertCodeUse` reactivates that one voucher, not every row under the
            // parent `Code`.
            cartId: input.cartId,
            orderId: input.orderId ?? null,
            generatedCodeId: input.type === 'dynamic' ? generatedCode!.id : null,
            customerId: input.customerId,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            // Explicit (not left `undefined`): the idempotency lookup at the top of this
            // method matches on `revertedAt: null` to find a prior, still-valid use.
            revertedAt: null,
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

    // `useCode` runs outside the command bus's own post-execute cache hook (this service
    // is called directly, not via a `CommandHandler.buildLog`), so the CRUD list cache
    // (ENABLE_CRUD_API_CACHE) never sees `code.used`/`active`/the generated code's
    // `active` flip without an explicit invalidation here.
    await invalidateCrudCache(
      this.container as unknown as AwilixContainer,
      'promotions.code',
      { id: code.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
      scope.tenantId,
      'promotions.code.use',
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

  /**
   * Release 5 C5/SPEC-055 amendment, additive: the inverse of `useCode` — NOT
   * `releaseCode` above, which deletes a still-open `CodeReservation` (pre-use hold).
   * This reverses an already-RECORDED use: a static code's `used` counter decrements
   * (and `active` returns to `true` once headroom exists again, the exact inverse of
   * `useCode`'s own flip), a dynamic code's specific `GeneratedCode.active` returns to
   * `true`, and the `CodeUsage` row is marked `revertedAt` — never deleted (append-only
   * log, see the class comment on `CodeUsage`).
   *
   * Idempotent: a `CodeUsage` row already carrying `revertedAt` is excluded from the
   * lookup, so calling this twice for the same cart/order reverts nothing the second
   * time. Scoped by `tenantId`/`organizationId` on every lookup and every lock, so an
   * id collision across tenants can never revert the wrong tenant's usage.
   */
  async revertCodeUse(em: EntityManager, input: RevertCodeUseInput, scope: PromotionsCodeScope): Promise<RevertCodeUseResult> {
    if (!input.cartId && !input.orderId) {
      throw new CrudHttpError(400, { error: '[internal] revertCodeUse requires a cartId or an orderId' })
    }

    // Two separate lookups, merged and de-duplicated by id, rather than a single `$or`
    // query — keeps this readable against the same plain-`findOne`/`find` MikroORM
    // surface the rest of this file already uses, with no operator-shape assumption.
    const matches = new Map<string, CodeUsage>()
    if (input.cartId) {
      const rows = await em.find(CodeUsage, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        cartId: input.cartId,
        revertedAt: null,
      })
      for (const row of rows) matches.set(row.id, row)
    }
    if (input.orderId) {
      const rows = await em.find(CodeUsage, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        orderId: input.orderId,
        revertedAt: null,
      })
      for (const row of rows) matches.set(row.id, row)
    }

    const usageRows = Array.from(matches.values())
    if (usageRows.length === 0) return { ok: true, revertedCount: 0 }

    let revertedCount = 0
    for (const usage of usageRows) {
      await withAtomicFlush(
        em,
        [
          async () => {
            if (usage.generatedCodeId) {
              const lockedGeneratedCode = await em.findOne(
                GeneratedCode,
                { id: usage.generatedCodeId, tenantId: scope.tenantId, organizationId: scope.organizationId },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
              )
              if (lockedGeneratedCode) lockedGeneratedCode.active = true
            } else {
              const lockedCode = await em.findOne(
                Code,
                { id: usage.codeId, tenantId: scope.tenantId, organizationId: scope.organizationId },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
              )
              if (lockedCode) {
                lockedCode.used = Math.max(0, lockedCode.used - 1)
                // Only reactivates a code this very decrement makes eligible again —
                // never flips a code an admin disabled for an unrelated reason in the
                // window between `useCode` and this revert (documented limitation, same
                // judgment-call spirit as this file's other edge-case comments).
                if (hasRemainingGlobalUses(lockedCode)) lockedCode.active = true
              }
            }
          },
          () => {
            usage.revertedAt = new Date()
          },
        ],
        { transaction: true, label: 'promotions.code.use.revert' },
      )
      revertedCount += 1

      await invalidateCrudCache(
        this.container as unknown as AwilixContainer,
        'promotions.code',
        { id: usage.codeId, organizationId: scope.organizationId, tenantId: scope.tenantId },
        scope.tenantId,
        'promotions.code.use.revert',
      )
    }

    return { ok: true, revertedCount }
  }
}
