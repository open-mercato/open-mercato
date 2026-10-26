import { z } from 'zod'

export type TpayEnvironment = 'sandbox' | 'production'

export const TPAY_BASE_URLS: Record<TpayEnvironment, string> = {
  production: 'https://api.tpay.com',
  sandbox: 'https://openapi.sandbox.tpay.com',
}

export const TPAY_REQUEST_TIMEOUT_MS = 10_000
export const TPAY_MAX_RESPONSE_BYTES = 256 * 1024

export class TpayClientError extends Error {
  readonly status: number | null
  readonly code: 'http' | 'timeout' | 'network' | 'oversized' | 'invalid_response' | 'invalid_url'

  constructor(
    message: string,
    code: TpayClientError['code'],
    status: number | null = null,
  ) {
    super(message)
    this.name = 'TpayClientError'
    this.code = code
    this.status = status
  }
}

export function resolveTpayEnvironment(value: unknown): TpayEnvironment {
  if (value === 'sandbox' || value === 'production') return value
  throw new TpayClientError('[internal] Unsupported Tpay environment', 'invalid_response')
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
})

const numericSchema = z
  .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/)])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value))

const transactionResponseSchema = z.object({
  transactionId: z.string().min(1).optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  transactionPaymentUrl: z.string().optional(),
  amount: numericSchema.optional(),
  currency: z.string().optional(),
  hiddenDescription: z.string().optional(),
  payments: z
    .object({
      amountPaid: numericSchema.optional(),
    })
    .passthrough()
    .optional(),
})

export type TpayTransaction = z.infer<typeof transactionResponseSchema>

export type TpayCreateTransactionBody = {
  amount: number
  currency: 'PLN'
  description: string
  hiddenDescription?: string
  lang?: string
  payer: { email: string; name: string }
  callbacks?: {
    payerUrls?: { success?: string; error?: string }
    notification?: { url?: string; email?: string }
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > TPAY_MAX_RESPONSE_BYTES) {
    throw new TpayClientError('[internal] Tpay response too large', 'oversized', response.status)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > TPAY_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new TpayClientError('[internal] Tpay response too large', 'oversized', response.status)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

async function send(url: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TPAY_REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new TpayClientError('[internal] Tpay request timed out', 'timeout')
    }
    throw new TpayClientError('[internal] Tpay request failed', 'network')
  }
  const text = await readBoundedText(response)
  if (!response.ok) {
    throw new TpayClientError(`[internal] Tpay responded with HTTP ${response.status}`, 'http', response.status)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new TpayClientError('[internal] Tpay returned malformed JSON', 'invalid_response', response.status)
  }
}

function parseResponse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new TpayClientError('[internal] Tpay returned an unexpected response shape', 'invalid_response')
  }
  return parsed.data
}

export async function requestAccessToken(input: {
  clientId: string
  clientSecret: string
  environment: TpayEnvironment
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })
  const data = await send(`${TPAY_BASE_URLS[input.environment]}/oauth/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  return parseResponse(tokenResponseSchema, data).access_token
}

export async function createTransaction(
  token: string,
  environment: TpayEnvironment,
  body: TpayCreateTransactionBody,
): Promise<TpayTransaction> {
  const data = await send(`${TPAY_BASE_URLS[environment]}/transactions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  return parseResponse(transactionResponseSchema, data)
}

export async function getTransaction(
  token: string,
  environment: TpayEnvironment,
  transactionId: string,
): Promise<TpayTransaction> {
  const data = await send(
    `${TPAY_BASE_URLS[environment]}/transactions/${encodeURIComponent(transactionId)}`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    },
  )
  return parseResponse(transactionResponseSchema, data)
}

export function assertTpayPaymentUrl(url: string, environment: TpayEnvironment): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TpayClientError('[internal] Tpay payment URL is invalid', 'invalid_url')
  }
  const host = parsed.hostname.toLowerCase()
  const hostAllowed = host === 'tpay.com' || host.endsWith('.tpay.com')
  if (parsed.protocol !== 'https:' || !hostAllowed || parsed.username || parsed.password) {
    throw new TpayClientError(
      `[internal] Tpay payment URL rejected for ${environment} environment`,
      'invalid_url',
    )
  }
  return parsed
}
