import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  getPaymentGatewayDescriptor,
  type PaymentGatewayPayerField,
} from '@open-mercato/shared/modules/payment_gateways/types'

export const PAYER_FIELDS_NOT_COLLECTED_MESSAGE_KEY = 'checkout.validation.gatewayProviderKey.payerFieldsNotCollected'

export const PAYER_FIELD_CUSTOMER_FIELD_KEYS: Readonly<Record<PaymentGatewayPayerField, readonly string[]>> = {
  email: ['email'],
  name: ['firstName', 'lastName'],
}

type CustomerFieldRequirementLike = {
  key?: unknown
  required?: unknown
}

export type PayerFieldCollectionInput = {
  requiredPayerFields: readonly string[] | null | undefined
  collectCustomerDetails: boolean | null | undefined
  customerFieldsSchema: readonly CustomerFieldRequirementLike[] | null | undefined
}

export type CheckoutPayerFieldConfiguration = {
  gatewayProviderKey?: string | null
  collectCustomerDetails?: boolean | null
  customerFieldsSchema?: readonly CustomerFieldRequirementLike[] | null
}

function isKnownPayerField(value: string): value is PaymentGatewayPayerField {
  return Object.prototype.hasOwnProperty.call(PAYER_FIELD_CUSTOMER_FIELD_KEYS, value)
}

export function findUncollectedPayerFields(input: PayerFieldCollectionInput): PaymentGatewayPayerField[] {
  const requested = Array.from(new Set(input.requiredPayerFields ?? [])).filter(isKnownPayerField)
  if (requested.length === 0) return []
  if (input.collectCustomerDetails === false) return requested

  const requiredCustomerFieldKeys = new Set(
    (input.customerFieldsSchema ?? [])
      .filter((field) => field.required === true && typeof field.key === 'string')
      .map((field) => field.key as string),
  )

  return requested.filter((payerField) =>
    PAYER_FIELD_CUSTOMER_FIELD_KEYS[payerField].some((key) => !requiredCustomerFieldKeys.has(key)),
  )
}

export function resolveRequiredPayerFields(providerKey: string | null | undefined): PaymentGatewayPayerField[] {
  const normalizedProviderKey = typeof providerKey === 'string' ? providerKey.trim() : ''
  if (!normalizedProviderKey) return []
  return getPaymentGatewayDescriptor(normalizedProviderKey)?.requiresPayerFields ?? []
}

export function ensurePayerFieldsCollected(configuration: CheckoutPayerFieldConfiguration): void {
  const missing = findUncollectedPayerFields({
    requiredPayerFields: resolveRequiredPayerFields(configuration.gatewayProviderKey),
    collectCustomerDetails: configuration.collectCustomerDetails,
    customerFieldsSchema: configuration.customerFieldsSchema,
  })
  if (missing.length === 0) return

  throw new CrudHttpError(422, {
    error: 'Validation failed',
    fieldErrors: {
      gatewayProviderKey: PAYER_FIELDS_NOT_COLLECTED_MESSAGE_KEY,
    },
    missingPayerFields: missing,
  })
}
