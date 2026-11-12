import { Resend } from 'resend'

/**
 * The Resend client used for inbound mail. The SDK reads `RESEND_BASE_URL` itself (the
 * integration harness points it at the test stub), so only the API key is resolved here.
 */
export function createInboundResendClient(env: Readonly<Record<string, string | undefined>> = process.env): Resend {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is required to fetch Resend inbound emails')
  return new Resend(apiKey)
}
