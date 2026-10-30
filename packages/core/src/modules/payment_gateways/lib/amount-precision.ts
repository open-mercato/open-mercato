import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import { findCurrencyAmountPrecisionError, resolveCurrencyDecimalPlaces } from '@open-mercato/shared/lib/currencyPrecision'
import { parseDecimal } from '@open-mercato/shared/lib/decimal'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { PaymentGatewayScope } from '@open-mercato/shared/modules/payment_gateways/types'
import { GatewayTransaction } from '../data/entities'
import { resolvePaymentGatewayTranslator } from './order-amount-reconciliation'

type ServiceContainer = {
  resolve<T = unknown>(name: string): T
}

export type AmountPrecisionErrorBody = {
  error: string
}

/**
 * Rejects a payment amount carrying more decimals than the currency itself has
 * (`10.005` USD): a provider charging in minor units would round it, so the
 * captured amount could differ from the stored one. A tenant precision above the
 * ISO 4217 minor unit (USD at 4 decimals) is capped at the ISO digits, since that
 * is what providers charge in. Skipped when the currency precision is unknown.
 */
export async function findAmountPrecisionError(
  container: ServiceContainer,
  input: {
    amount: number | string | null | undefined
    currencyCode: string | null | undefined
    scope: PaymentGatewayScope
  },
): Promise<AmountPrecisionErrorBody | null> {
  const amount = parseDecimal(input.amount)
  const currencyCode = input.currencyCode?.trim().toUpperCase()
  if (amount === null || !currencyCode) return null
  const currencyDecimalPlaces = await resolveCurrencyDecimalPlaces(container, {
    code: currencyCode,
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
  })
  const precisionError = findCurrencyAmountPrecisionError({
    amount: input.amount,
    currencyCode,
    decimalPlaces: currencyDecimalPlaces,
  })
  if (!precisionError) return null
  const translate = await resolvePaymentGatewayTranslator()
  return {
    error: translate(
      'payment_gateways.errors.amountPrecisionExceeded',
      'Amount {amount} has more decimal places than {currencyCode} supports ({decimalPlaces})',
      precisionError,
    ),
  }
}

export async function resolveTransactionCurrencyCode(
  container: ServiceContainer,
  transactionId: string,
  scope: PaymentGatewayScope,
): Promise<string | null> {
  const em = container.resolve<EntityManager>('em')
  const transaction = await findOneWithDecryption(
    em,
    GatewayTransaction,
    { id: transactionId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
    undefined,
    scope,
  )
  return transaction?.currencyCode ?? null
}

/**
 * Invalid-payload body whose field messages (i18n keys from the module validators)
 * are translated for the request locale.
 */
export async function buildInvalidPayloadBody(error: z.ZodError): Promise<{ error: string; details: unknown }> {
  const translate = await resolvePaymentGatewayTranslator()
  return {
    error: 'Invalid payload',
    details: error.flatten((issue) => translate(issue.message, issue.message)),
  }
}
