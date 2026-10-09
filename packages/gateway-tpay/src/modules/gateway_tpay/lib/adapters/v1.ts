import { z } from 'zod'
import type {
  CancelResult,
  CaptureResult,
  CreateSessionInput,
  CreateSessionResult,
  GatewayAdapter,
  GatewayPaymentStatus,
  GetStatusInput,
  RefundResult,
  UnifiedPaymentStatus,
  WebhookEvent,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toTpayAmount } from '../amount'
import { resolveTpayNotificationUrl } from '../callback-url'
import { tpayHttpError, translateTpayText } from '../errors'
import { mapTpayStatus } from '../status-map'
import {
  assertTpayPaymentUrl,
  createTransaction,
  getTransaction,
  requestAccessToken,
  resolveTpayEnvironment,
  type TpayCreateTransactionBody,
  type TpayEnvironment,
} from '../tpay-client'

const logger = createLogger('gateway_tpay').child({ component: 'adapter-v1' })

const MAX_PAYER_NAME_LENGTH = 255
const MAX_DESCRIPTION_LENGTH = 128
const MAX_PROVIDER_TEXT_LENGTH = 128
const TPAY_LANGUAGE = 'pl'

const emailSchema = z.string().trim().min(1).email()

type TpayCredentials = {
  clientId: string
  clientSecret: string
  environment: TpayEnvironment
  notificationUrl: unknown
}

function bounded(value: string | undefined, max = MAX_PROVIDER_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length > max ? value.slice(0, max) : value
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveCredentials(credentials: Record<string, unknown>): TpayCredentials {
  const clientId = readNonEmptyString(credentials.clientId)
  const clientSecret = readNonEmptyString(credentials.clientSecret)
  if (!clientId || !clientSecret) {
    throw new Error('[internal] Tpay credentials are incomplete')
  }
  const environment = resolveTpayEnvironment(credentials.environment ?? 'sandbox')
  return { clientId, clientSecret, environment, notificationUrl: credentials.notificationUrl }
}

async function resolvePayer(metadata: Record<string, unknown> | undefined): Promise<{ email: string; name: string }> {
  const email = emailSchema.safeParse(metadata?.customerEmail)
  if (!email.success) throw await tpayHttpError(422, 'payerEmailRequired')
  const name = readNonEmptyString(metadata?.customerName)
  if (!name || name.length > MAX_PAYER_NAME_LENGTH) throw await tpayHttpError(422, 'payerNameRequired')
  return { email: email.data, name }
}

async function resolveDescription(description: string | undefined): Promise<string> {
  const provided = readNonEmptyString(description)
  const value = provided ?? (await translateTpayText('gateway_tpay.description.fallback', 'Payment via Tpay'))
  return value.slice(0, MAX_DESCRIPTION_LENGTH)
}

async function withProviderErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isCrudHttpError(error)) throw error
    throw await tpayHttpError(502, 'providerUnavailable')
  }
}

async function unsupportedOperation(): Promise<never> {
  throw await tpayHttpError(422, 'unsupportedOperation')
}

export const tpayAdapterV1: GatewayAdapter = {
  providerKey: 'tpay',

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    if (typeof input.currencyCode !== 'string' || input.currencyCode.trim().toUpperCase() !== 'PLN') {
      throw await tpayHttpError(422, 'currencyNotSupported')
    }
    const amount = await toTpayAmount(input.amount)
    const payer = await resolvePayer(input.metadata)
    const credentials = resolveCredentials(input.credentials)
    const notificationUrl = await resolveTpayNotificationUrl({
      credential: credentials.notificationUrl,
      environment: credentials.environment,
    })
    const description = await resolveDescription(input.description)

    const payerUrls: { success?: string; error?: string } = {}
    if (input.successUrl) payerUrls.success = input.successUrl
    if (input.cancelUrl) payerUrls.error = input.cancelUrl
    const callbacks: NonNullable<TpayCreateTransactionBody['callbacks']> = {}
    if (Object.keys(payerUrls).length > 0) callbacks.payerUrls = payerUrls
    if (notificationUrl) callbacks.notification = { url: notificationUrl }

    const body: TpayCreateTransactionBody = {
      amount,
      currency: 'PLN',
      description,
      hiddenDescription: input.paymentId,
      lang: TPAY_LANGUAGE,
      payer,
      ...(Object.keys(callbacks).length > 0 ? { callbacks } : {}),
    }

    return withProviderErrors(async () => {
      const token = await requestAccessToken({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        environment: credentials.environment,
      })
      const transaction = await createTransaction(token, credentials.environment, body)
      const transactionId = readNonEmptyString(transaction.transactionId)
      const paymentUrl = readNonEmptyString(transaction.transactionPaymentUrl)
      if (!transactionId || !paymentUrl) {
        throw new Error('[internal] Tpay response is missing the transaction id or payment url')
      }
      const redirectUrl = assertTpayPaymentUrl(paymentUrl, credentials.environment).toString()
      return {
        sessionId: transactionId,
        status: 'pending',
        redirectUrl,
        clientSession: { type: 'redirect', redirectUrl },
        providerData: {
          title: bounded(transaction.title),
          providerStatus: bounded(transaction.status),
        },
      }
    })
  },

  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> {
    const credentials = resolveCredentials(input.credentials)
    return withProviderErrors(async () => {
      const token = await requestAccessToken({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        environment: credentials.environment,
      })
      const transaction = await getTransaction(token, credentials.environment, input.sessionId)
      const providerStatus = bounded(transaction.status)
      const status = mapTpayStatus(transaction.status)
      if (status === 'unknown') {
        logger.warn('Unknown Tpay transaction status', { providerStatus: providerStatus ?? null })
      }
      return {
        status,
        amount: transaction.amount ?? 0,
        amountReceived: transaction.payments?.amountPaid ?? 0,
        currencyCode: transaction.currency ?? 'PLN',
        providerData: { providerStatus },
      }
    })
  },

  async capture(): Promise<CaptureResult> {
    return unsupportedOperation()
  },

  async refund(): Promise<RefundResult> {
    return unsupportedOperation()
  },

  async cancel(): Promise<CancelResult> {
    return unsupportedOperation()
  },

  async verifyWebhook(): Promise<WebhookEvent> {
    throw new Error('[internal] Tpay notifications are not supported yet')
  },

  mapStatus(providerStatus: string): UnifiedPaymentStatus {
    return mapTpayStatus(providerStatus)
  },
}
