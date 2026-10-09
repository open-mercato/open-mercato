import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const TPAY_ERROR_FALLBACKS = {
  currencyNotSupported: 'Tpay supports payments in PLN only.',
  invalidAmount: 'The payment amount is invalid.',
  invalidNotificationUrl: 'The notification URL is invalid.',
  payerEmailRequired: 'Payer email address is required.',
  payerNameRequired: 'Payer name is required.',
  providerUnavailable: 'Tpay is temporarily unavailable. Try again later.',
  unsupportedOperation: 'This operation is not supported by Tpay.',
} as const

export type TpayErrorKey = keyof typeof TPAY_ERROR_FALLBACKS

export async function translateTpayText(key: string, fallback: string): Promise<string> {
  try {
    const { translate } = await resolveTranslations()
    return translate(key, fallback)
  } catch {
    return fallback
  }
}

export async function tpayHttpError(status: number, key: TpayErrorKey): Promise<CrudHttpError> {
  const code = `gateway_tpay.errors.${key}`
  const message = await translateTpayText(code, TPAY_ERROR_FALLBACKS[key])
  return new CrudHttpError(status, { error: message, code })
}
