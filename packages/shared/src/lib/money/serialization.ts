import { z } from 'zod'
import { decimalStringSchema } from '../decimal'
import { resolveCurrency } from './currency'
import { brandCurrency } from './internal'
import { createMoney } from './money'
import { MAX_MONEY_DECIMAL_PLACES, type Money } from './types'

type ServiceContainer = {
  resolve<T = unknown>(name: string): T
}

export type MoneyScope = {
  tenantId: string
  organizationId?: string | null
}

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)

/**
 * Untrusted money from clients (request bodies, imports, webhooks). Parses into a
 * plain `MoneyInput`, never a `Money`: precision keys a client sends are stripped,
 * and the value reaches a `Money` only through `resolveMoney`.
 */
export const moneyInputSchema = z.object({
  amount: decimalStringSchema,
  currencyCode: z.string().trim().toUpperCase().pipe(currencyCodeSchema),
})

export type MoneyInput = z.infer<typeof moneyInputSchema>

/**
 * Trusted money this system wrote itself (queues, caches, events, workflow
 * state, persisted JSON). Keeps the precision at the time of the snapshot.
 * Keys may be added but never renamed or removed.
 */
export const moneySnapshotSchema = z.object({
  amount: decimalStringSchema,
  currencyCode: currencyCodeSchema,
  currencyDecimalPlaces: z.number().int().min(0).max(MAX_MONEY_DECIMAL_PLACES),
})

export type MoneySnapshot = z.infer<typeof moneySnapshotSchema>

/** API response shape. Precision and symbol come from `/api/currencies/currencies`. */
export function serializeMoney(money: Money): MoneyInput {
  return { amount: money.amount.toFixed(), currencyCode: money.currency.code }
}

/** Resolves client input against the tenant's current currency precision. */
export async function resolveMoney(container: ServiceContainer, scope: MoneyScope, input: MoneyInput): Promise<Money> {
  const parsed = moneyInputSchema.safeParse(input)
  if (!parsed.success) throw new Error('[internal] Invalid money input')
  const currency = await resolveCurrency(container, {
    code: parsed.data.currencyCode,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId ?? null,
  })
  return createMoney(parsed.data.amount, currency)
}

export function snapshotMoney(money: Money): MoneySnapshot {
  return {
    amount: money.amount.toFixed(),
    currencyCode: money.currency.code,
    currencyDecimalPlaces: money.currency.decimalPlaces,
  }
}

/**
 * Restores a snapshot this system wrote, synchronously and without a tenant
 * lookup, at the precision it was written with (`symbol` is `null`). MUST NOT
 * receive request input: parse that with `moneyInputSchema` and `resolveMoney`.
 */
export function restoreMoney(snapshot: MoneySnapshot): Money {
  const parsed = moneySnapshotSchema.safeParse(snapshot)
  if (!parsed.success) throw new Error('[internal] Invalid money snapshot')
  const { amount, currencyCode, currencyDecimalPlaces } = parsed.data
  return createMoney(amount, brandCurrency(currencyCode, currencyDecimalPlaces, null))
}
