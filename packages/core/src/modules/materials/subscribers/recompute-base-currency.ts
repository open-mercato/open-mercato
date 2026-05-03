import type { EntityManager } from '@mikro-orm/postgresql'
import { Currency, ExchangeRate } from '@open-mercato/core/modules/currencies/data/entities'
import { MaterialPrice } from '../data/entities'

export const metadata = {
  event: 'currencies.exchange_rate.updated',
  persistent: true,
  id: 'materials:recompute-base-currency-on-rate-updated',
}

type ExchangeRateUpdatedPayload = {
  id: string
  organizationId: string
  tenantId: string
}

type EventBus = {
  emitEvent: (event: string, payload: unknown, options?: { persistent?: boolean }) => Promise<void>
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const DEBUG = process.env.MATERIALS_FX_DEBUG === 'true'

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[materials.fx]', ...args)
}

/**
 * Recompute MaterialPrice.base_currency_amount in response to an exchange rate update.
 *
 * Algorithm:
 *  1. Load the ExchangeRate by id (payload only carries the id).
 *  2. Resolve the tenant base currency for the same org/tenant. If the updated rate is not
 *     "fromCode -> baseCode" we skip (rates for other pairs do not affect our cache).
 *  3. Resolve the source currency (Currency where code = exchangeRate.fromCurrencyCode).
 *  4. Find all live MaterialPrice rows in the same org with currencyId = source.id.
 *  5. For each: base_currency_amount = price_amount * rate (parseFloat — same precision
 *     model used elsewhere in the currencies module; numeric(18,6) DB column truncates
 *     stored value to 6 decimals).
 *  6. Emit `materials.price.fx_recalculated` per affected row (non-persistent — UI hint, no
 *     audit value beyond the price update itself which already runs through commands).
 *
 * Idempotent: if the recomputed value matches the existing cache, no UPDATE is issued and
 * no event is emitted. Forked EM avoids identity-map pollution with concurrent CRUD events.
 *
 * Initial FX compute on materials.price.created is intentionally NOT done here per Phase 1
 * spec (Step 9 only listens to currencies.exchange_rate.updated). Until the next rate update
 * lands the UI shows a "pending FX" badge for new prices in non-base currencies. A follow-up
 * subscriber on materials.price.created can be added when the UX gap matters.
 */
export default async function handle(payload: ExchangeRateUpdatedPayload, ctx: ResolverContext) {
  if (!payload?.id) return
  const em = (ctx.resolve('em') as EntityManager).fork()

  const rate = await em.findOne(ExchangeRate, { id: payload.id, deletedAt: null })
  if (!rate) {
    debug('rate not found', payload.id)
    return
  }
  const rateValue = parseFloat(rate.rate)
  if (!Number.isFinite(rateValue) || rateValue <= 0) {
    debug('invalid rate value', rate.rate)
    return
  }

  const baseCurrency = await em.findOne(Currency, {
    organizationId: rate.organizationId,
    tenantId: rate.tenantId,
    isBase: true,
    isActive: true,
  })
  if (!baseCurrency) {
    debug('no base currency configured for org/tenant', rate.organizationId, rate.tenantId)
    return
  }
  if (rate.toCurrencyCode !== baseCurrency.code) {
    debug('rate target is not base currency', { to: rate.toCurrencyCode, base: baseCurrency.code })
    return
  }
  // Same-currency rate is meaningless for cache; would also short-circuit the price.amount * 1 case.
  if (rate.fromCurrencyCode === baseCurrency.code) {
    debug('rate source equals base currency; nothing to recompute')
    return
  }

  const sourceCurrency = await em.findOne(Currency, {
    organizationId: rate.organizationId,
    tenantId: rate.tenantId,
    code: rate.fromCurrencyCode,
    isActive: true,
  })
  if (!sourceCurrency) {
    debug('source currency not found in scope', rate.fromCurrencyCode)
    return
  }

  const prices = await em.find(MaterialPrice, {
    organizationId: rate.organizationId,
    tenantId: rate.tenantId,
    currencyId: sourceCurrency.id,
    deletedAt: null,
  })
  if (prices.length === 0) {
    debug('no prices in this currency to recompute')
    return
  }

  const eventBus = ctx.resolve('eventBus') as EventBus | undefined
  const now = new Date()
  let touched = 0

  for (const price of prices) {
    const amount = parseFloat(price.priceAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      debug('skipping price with invalid amount', price.id, price.priceAmount)
      continue
    }
    const recomputed = (amount * rateValue).toFixed(6)
    if (price.baseCurrencyAmount === recomputed) continue
    price.baseCurrencyAmount = recomputed
    price.baseCurrencyAt = now
    touched += 1
  }

  if (touched > 0) {
    await em.flush()
    if (eventBus) {
      for (const price of prices) {
        if (price.baseCurrencyAt !== now) continue
        await eventBus
          .emitEvent(
            'materials.price.fx_recalculated',
            {
              id: price.id,
              baseCurrencyAmount: price.baseCurrencyAmount,
              baseCurrencyAt: price.baseCurrencyAt,
              organizationId: price.organizationId,
              tenantId: price.tenantId,
            },
            { persistent: false },
          )
          .catch((err) => debug('emitEvent failed', price.id, err))
      }
    }
  }

  debug(`recomputed ${touched}/${prices.length} prices for ${rate.fromCurrencyCode}->${rate.toCurrencyCode}`)
}
