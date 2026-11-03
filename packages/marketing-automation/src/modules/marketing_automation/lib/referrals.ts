import { randomBytes } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { PLACED_ORDER_FILTER_SQL } from './order-filter.js'
import { MarketingReferralCode, MarketingReferralRedemption } from '../data/entities.js'
import {
  generateReferralCode,
  isValidReferralCode,
  normalizeReferralCode,
  referralUrlFor,
} from './engine/referral-code.js'
import { SALES_ORDERS } from './external/tables.js'
import { hasSales } from './capabilities.js'

/** Postgres unique violation — losing a race against a concurrent claim, which the index is there to win. */
const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * The referral programme: issuing a code, claiming one, and converting it on a first order.
 *
 * The shape worth stating up front is the SUBJECT FLIP. Everything else in this module is about the customer
 * something happened to; a conversion is about the person who is not in the room — the referrer. That is why
 * the conversion emits an event carrying the referrer as its subject, and why the referred customer's id
 * travels as trigger context rather than as the subject.
 */

export type ReferralScope = { tenantId: string; organizationId: string }

/** The config key for where a shared link should point, with `{code}` in it. */
export const REFERRAL_URL_TEMPLATE_CONFIG = 'referralUrlTemplate'

/**
 * How many times to retry a colliding code.
 *
 * Forty bits over a shop's worth of codes collides essentially never, so this is about the unique index doing
 * its job rather than about probability — and a handful of retries turns an astronomically unlikely clash into
 * a non-event instead of a 500.
 */
const CODE_ATTEMPTS = 5

/**
 * The customer's code, created on first use.
 *
 * Idempotent, because the step that calls it runs inside a journey that may be redelivered: a second call
 * returns the same code rather than a second one, which is also what keeps a person's code stable across every
 * message that ever printed it.
 */
export async function ensureReferralCode(
  em: EntityManager,
  scope: ReferralScope,
  referrerEntityId: string,
): Promise<string> {
  const existing = await em.findOne(MarketingReferralCode, { ...scope, referrerEntityId, deletedAt: null })
  if (existing) return existing.code

  let lastError: unknown = null
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = generateReferralCode((size) => randomBytes(size))
    try {
      const row = em.create(MarketingReferralCode, { ...scope, referrerEntityId, code })
      em.persist(row)
      await em.flush()
      return code
    } catch (error) {
      lastError = error
      em.clear()
      // Either the code collided or this customer got a code from a concurrent call. The second is the
      // likelier one and the right answer to it is the code that won.
      const raced = await em.findOne(MarketingReferralCode, { ...scope, referrerEntityId, deletedAt: null })
      if (raced) return raced.code
    }
  }
  throw lastError ?? new Error('[internal] could not issue a referral code')
}

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

/** The tenant's referral link template, or null. Scope inside the options object — see `lib/tiers.ts`. */
export async function loadReferralUrlTemplate(
  container: AwilixContainer,
  scope: ReferralScope,
): Promise<string | null> {
  let service: ModuleConfigLike
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return null
  }
  try {
    const value = await service.getValue<unknown>('marketing_automation', REFERRAL_URL_TEMPLATE_CONFIG, { scope })
    return typeof value === 'string' && value.includes('{code}') ? value : null
  } catch {
    return null
  }
}

export type ClaimOutcome =
  | { status: 'claimed'; referrerEntityId: string; code: string }
  | { status: 'unknown_code' }
  | { status: 'already_referred' }
  | { status: 'self_referral' }
  /** Already a buyer before the code was used, so there is no referral to reward. */
  | { status: 'already_a_customer' }

/**
 * Records that someone arrived on a code.
 *
 * Refuses the two cases a programme is always gamed through: claiming your own code, and claiming a second
 * time. Both answer with a distinct outcome rather than an error, because the caller is a checkout or a
 * sign-up form that needs to tell the person something specific.
 */
/** Whether a referrer is still a live customer: codes of deleted customers neither resolve nor list. */
async function liveReferrerIds(em: EntityManager, scope: ReferralScope, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await em.find(
    CustomerEntity,
    { id: { $in: ids }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { fields: ['id'] },
  )
  return new Set(rows.map((row) => row.id))
}

async function isLiveReferrer(em: EntityManager, scope: ReferralScope, id: string): Promise<boolean> {
  return (await liveReferrerIds(em, scope, [id])).has(id)
}

export async function claimReferral(
  em: EntityManager,
  scope: ReferralScope,
  input: { code: string; referredEntityId: string },
): Promise<ClaimOutcome> {
  const normalized = normalizeReferralCode(input.code)
  if (!isValidReferralCode(normalized)) return { status: 'unknown_code' }

  const code = await em.findOne(MarketingReferralCode, { ...scope, code: normalized, deletedAt: null })
  if (!code) return { status: 'unknown_code' }
  // An erased referrer's code is retired in the same statement that unlinks them, so this is belt and
  // braces — but a code with nobody behind it must never be claimable: there would be nobody to reward.
  if (!code.referrerEntityId) return { status: 'unknown_code' }
  /**
   * Nor a code whose owner was deleted from the CRM.
   *
   * The code is not retired on delete, because a delete can be undone and the code is already printed in every
   * message that mentioned it; it simply stops resolving while its owner is gone.
   */
  if (!(await isLiveReferrer(em, scope, code.referrerEntityId))) return { status: 'unknown_code' }
  if (code.referrerEntityId === input.referredEntityId) return { status: 'self_referral' }

  const existing = await em.findOne(MarketingReferralRedemption, { ...scope, referredEntityId: input.referredEntityId })
  if (existing) return { status: 'already_referred' }

  /**
   * An existing buyer cannot be referred, which is the third way a programme is gamed.
   *
   * The reward is for bringing somebody NEW. Without this, an existing customer types any code before their
   * next order and the conversion pays out on a purchase that was going to happen anyway — and done between
   * two accounts that is a reward machine, since the referred side needs nothing but a code and an order.
   * "No earlier orders" is checked with the module's own definition of an order that counts, so a cancelled
   * one does not disqualify somebody and a draft cart does not either.
   */
  /**
   * Skipped where there is no `sales` module, and that is not a weakened check.
   *
   * The question is "has this person ordered before", and on an installation with no order table the answer is
   * genuinely no — there are no orders for anybody. Nor is anything left exposed: a conversion fires on
   * `sales.order.created`, which that installation cannot emit, so the programme is codes-only and the payout
   * this check guards cannot happen at all.
   */
  const earlierOrders = (await hasSales(em))
    ? await em.execute<Array<{ one: number }>>(
        `select 1 as one
           from ${SALES_ORDERS}
          where ${PLACED_ORDER_FILTER_SQL}
            and customer_entity_id = ?
          limit 1`,
        [scope.tenantId, scope.organizationId, input.referredEntityId],
      )
    : []
  if (earlierOrders.length > 0) return { status: 'already_a_customer' }

  try {
    const redemption = em.create(MarketingReferralRedemption, {
      ...scope,
      codeId: code.id,
      referrerEntityId: code.referrerEntityId,
      referredEntityId: input.referredEntityId,
      status: 'pending',
    })
    em.persist(redemption)
    await em.flush()
  } catch (error) {
    /**
     * Only a unique violation means "already referred".
     *
     * The unique index is the real guard against two simultaneous claims, and losing that race is not a
     * failure. Everything ELSE is: a bare catch here answered `already_referred` to a dead connection, a
     * statement timeout and a constraint nobody anticipated alike, so a storefront told the customer their
     * code had been used and the real error was never reported.
     */
    em.clear()
    const code = (error as { code?: unknown })?.code
    if (code !== POSTGRES_UNIQUE_VIOLATION) throw error
    return { status: 'already_referred' }
  }

  return { status: 'claimed', referrerEntityId: code.referrerEntityId, code: normalized }
}

export type ConversionOutcome = {
  referrerEntityId: string
  referredEntityId: string
  code: string
  orderId: string
  orderTotal: string | null
} | null

/**
 * Converts a pending claim when the referred customer places an order.
 *
 * Returns null when there is nothing to convert, which is the overwhelmingly common case — every order by
 * every customer passes through here, so the first query has to be the cheap one. Conversion is a single
 * conditional UPDATE: two orders arriving at once would otherwise both see `pending` and both emit a reward.
 */
export async function convertPendingReferral(
  em: EntityManager,
  scope: ReferralScope,
  input: { referredEntityId: string; orderId: string; orderTotal?: string | null; now: Date },
): Promise<ConversionOutcome> {
  const pending = await em.findOne(MarketingReferralRedemption, {
    ...scope,
    referredEntityId: input.referredEntityId,
    status: 'pending',
  })
  if (!pending) return null

  const claimed = await em.nativeUpdate(
    MarketingReferralRedemption,
    { id: pending.id, ...scope, status: 'pending' },
    {
      status: 'converted',
      orderId: input.orderId,
      orderTotal: input.orderTotal ?? null,
      convertedAt: input.now,
    },
  )
  // Lost the race: somebody else converted this claim, and exactly one of us may emit the event.
  if (claimed === 0) return null
  // The conversion is recorded either way — it happened — but an erased referrer gets no reward event,
  // because there is no longer a person for it to be about.
  if (!pending.referrerEntityId || !pending.referredEntityId) return null

  const code = await em.findOne(MarketingReferralCode, { id: pending.codeId, ...scope })
  return {
    referrerEntityId: pending.referrerEntityId,
    referredEntityId: pending.referredEntityId,
    code: code?.code ?? '',
    orderId: input.orderId,
    orderTotal: input.orderTotal ?? null,
  }
}

export type ReferralSummary = {
  code: string | null
  url: string | null
  /** People who entered this customer's code, whether or not they have bought anything. */
  claimed: number
  /** Those who went on to place an order — the number a reward should be based on. */
  converted: number
  /** Who referred THIS customer, when somebody did. `referrerEntityId` is null once that person is erased. */
  referredBy: { referrerEntityId: string | null; status: string } | null
}

/** Everything the customer profile shows about referrals, in two queries plus a lookup. */
export async function loadReferralSummary(
  em: EntityManager,
  scope: ReferralScope,
  customerId: string,
  urlTemplate: string | null,
): Promise<ReferralSummary> {
  const [code, redemptions, inbound] = await Promise.all([
    em.findOne(MarketingReferralCode, { ...scope, referrerEntityId: customerId, deletedAt: null }),
    em.find(MarketingReferralRedemption, { ...scope, referrerEntityId: customerId }),
    em.findOne(MarketingReferralRedemption, { ...scope, referredEntityId: customerId }),
  ])

  return {
    code: code?.code ?? null,
    url: code ? referralUrlFor(urlTemplate, code.code) : null,
    claimed: redemptions.length,
    converted: redemptions.filter((row) => row.status === 'converted').length,
    referredBy: inbound ? { referrerEntityId: inbound.referrerEntityId ?? null, status: inbound.status } : null,
  }
}
