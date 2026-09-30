/**
 * Pluggable CAPTCHA verification — T5 (replaces the forms-2d stub).
 *
 * A distribution may require a CAPTCHA via `distribution.settings.captcha`.
 * The start route resolves a `CaptchaVerifier` from DI (`formsCaptchaVerifier`)
 * and verifies the participant's token before bootstrapping a submission.
 *
 * Two implementations ship:
 *
 *  - `ProviderCaptchaVerifier` — verifies a token against a provider's
 *    siteverify HTTP endpoint (Cloudflare Turnstile or Google reCAPTCHA).
 *    Configured by env (`FORMS_CAPTCHA_PROVIDER` + `FORMS_CAPTCHA_SECRET`).
 *    Fail-closed: any network / parse error resolves to `{ success: false }`.
 *
 *  - `NoopCaptchaVerifier` — always reports success. Used when no provider is
 *    configured; the start route still enforces token *presence* for backward
 *    compatibility, but performs no real verification.
 *
 * Operators inject a custom verifier by overriding `formsCaptchaVerifier`.
 *
 * SECURITY: never log the secret or the participant token.
 */

export type CaptchaVerifyInput = {
  token: string
  remoteIp?: string
}

export type CaptchaVerifyResult = {
  success: boolean
  /** Optional machine-readable reason surfaced when `success === false`. */
  reason?: string
}

export interface CaptchaVerifier {
  verify(input: CaptchaVerifyInput): Promise<CaptchaVerifyResult>
}

export type CaptchaProvider = 'turnstile' | 'recaptcha'

const PROVIDER_ENDPOINTS: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
}

const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Always-success verifier. SAFE-BY-DECLARATION ONLY — performs no inspection.
 * Used when no provider is configured.
 */
export class NoopCaptchaVerifier implements CaptchaVerifier {
  async verify(): Promise<CaptchaVerifyResult> {
    return { success: true }
  }
}

export type ProviderCaptchaVerifierOptions = {
  provider: CaptchaProvider
  secret: string
  timeoutMs?: number
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

function isSiteverifyResponse(value: unknown): value is { success: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { success?: unknown }).success === 'boolean'
  )
}

/**
 * Verifies a CAPTCHA token against a provider's siteverify endpoint.
 *
 * Fail-closed: when a provider is configured, any transport or parse failure
 * MUST reject (`{ success: false, reason }`) rather than silently passing.
 */
export class ProviderCaptchaVerifier implements CaptchaVerifier {
  private readonly provider: CaptchaProvider
  private readonly secret: string
  private readonly endpoint: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: ProviderCaptchaVerifierOptions) {
    this.provider = options.provider
    this.secret = options.secret
    this.endpoint = PROVIDER_ENDPOINTS[options.provider]
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async verify(input: CaptchaVerifyInput): Promise<CaptchaVerifyResult> {
    if (!input.token) return { success: false, reason: 'missing_token' }

    const body = new URLSearchParams()
    body.set('secret', this.secret)
    body.set('response', input.token)
    if (this.provider === 'turnstile' && input.remoteIp) {
      body.set('remoteip', input.remoteIp)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      })
      if (!response.ok) {
        return { success: false, reason: `http_${response.status}` }
      }
      const parsed: unknown = await response.json()
      if (!isSiteverifyResponse(parsed)) {
        return { success: false, reason: 'malformed_response' }
      }
      return parsed.success ? { success: true } : { success: false, reason: 'rejected' }
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error'
      return { success: false, reason }
    } finally {
      clearTimeout(timer)
    }
  }
}

function parseProvider(value: string | undefined): CaptchaProvider | null {
  if (value === 'turnstile' || value === 'recaptcha') return value
  return null
}

/**
 * Selects a verifier from the environment:
 *  - `FORMS_CAPTCHA_PROVIDER` (`turnstile` | `recaptcha`) + `FORMS_CAPTCHA_SECRET`
 *    both set ⇒ `ProviderCaptchaVerifier` (real verification, fail-closed).
 *  - otherwise ⇒ `NoopCaptchaVerifier`.
 */
export function resolveCaptchaVerifier(env: NodeJS.ProcessEnv): CaptchaVerifier {
  const provider = parseProvider(env.FORMS_CAPTCHA_PROVIDER)
  const secret = env.FORMS_CAPTCHA_SECRET
  if (provider && secret) {
    return new ProviderCaptchaVerifier({ provider, secret })
  }
  return new NoopCaptchaVerifier()
}

/**
 * True when a real provider is configured. The start route uses this to decide
 * whether to require + verify a token (provider) or merely require its presence
 * (noop / backward-compat).
 */
export function isCaptchaProviderConfigured(env: NodeJS.ProcessEnv): boolean {
  return parseProvider(env.FORMS_CAPTCHA_PROVIDER) !== null && Boolean(env.FORMS_CAPTCHA_SECRET)
}
