import {
  NoopCaptchaVerifier,
  ProviderCaptchaVerifier,
  resolveCaptchaVerifier,
  isCaptchaProviderConfigured,
} from '../services/captcha-verifier'

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

describe('NoopCaptchaVerifier', () => {
  it('always reports success', async () => {
    const verifier = new NoopCaptchaVerifier()
    await expect(verifier.verify({ token: '' })).resolves.toEqual({ success: true })
    await expect(verifier.verify({ token: 'anything' })).resolves.toEqual({ success: true })
  })
})

describe('ProviderCaptchaVerifier', () => {
  it('returns success when the provider reports success', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ success: true }))
    const verifier = new ProviderCaptchaVerifier({
      provider: 'turnstile',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(verifier.verify({ token: 'tok' })).resolves.toEqual({ success: true })
  })

  it('returns failure with reason "rejected" when the provider reports failure', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ success: false }))
    const verifier = new ProviderCaptchaVerifier({
      provider: 'recaptcha',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(verifier.verify({ token: 'tok' })).resolves.toEqual({
      success: false,
      reason: 'rejected',
    })
  })

  it('POSTs secret + response to the turnstile endpoint and includes remoteip', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ success: true }))
    const verifier = new ProviderCaptchaVerifier({
      provider: 'turnstile',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await verifier.verify({ token: 'tok', remoteIp: '203.0.113.7' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(options.method).toBe('POST')
    const body = options.body as URLSearchParams
    expect(body.get('secret')).toBe('secret-key')
    expect(body.get('response')).toBe('tok')
    expect(body.get('remoteip')).toBe('203.0.113.7')
  })

  it('POSTs to the reCAPTCHA endpoint and omits remoteip', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ success: true }))
    const verifier = new ProviderCaptchaVerifier({
      provider: 'recaptcha',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await verifier.verify({ token: 'tok', remoteIp: '203.0.113.7' })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify')
    const body = options.body as URLSearchParams
    expect(body.has('remoteip')).toBe(false)
  })

  it('fails closed without calling fetch when the token is empty', async () => {
    const fetchImpl = jest.fn()
    const verifier = new ProviderCaptchaVerifier({
      provider: 'turnstile',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(verifier.verify({ token: '' })).resolves.toEqual({
      success: false,
      reason: 'missing_token',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed on a non-2xx HTTP response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 503 }))
    const verifier = new ProviderCaptchaVerifier({
      provider: 'turnstile',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(verifier.verify({ token: 'tok' })).resolves.toEqual({
      success: false,
      reason: 'http_503',
    })
  })

  it('fails closed on a malformed JSON body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ unexpected: true }))
    const verifier = new ProviderCaptchaVerifier({
      provider: 'turnstile',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(verifier.verify({ token: 'tok' })).resolves.toEqual({
      success: false,
      reason: 'malformed_response',
    })
  })

  it('fails closed on a network error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('connection reset'))
    const verifier = new ProviderCaptchaVerifier({
      provider: 'turnstile',
      secret: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(verifier.verify({ token: 'tok' })).resolves.toEqual({
      success: false,
      reason: 'network_error',
    })
  })

  it('fails closed with reason "timeout" when the request aborts', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchImpl = jest.fn().mockRejectedValue(abortError)
    const verifier = new ProviderCaptchaVerifier({
      provider: 'turnstile',
      secret: 'secret-key',
      timeoutMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(verifier.verify({ token: 'tok' })).resolves.toEqual({
      success: false,
      reason: 'timeout',
    })
  })
})

describe('resolveCaptchaVerifier', () => {
  it('selects a turnstile provider verifier when provider + secret are set', () => {
    const verifier = resolveCaptchaVerifier({
      FORMS_CAPTCHA_PROVIDER: 'turnstile',
      FORMS_CAPTCHA_SECRET: 'secret-key',
    } as NodeJS.ProcessEnv)
    expect(verifier).toBeInstanceOf(ProviderCaptchaVerifier)
  })

  it('selects a reCAPTCHA provider verifier when provider + secret are set', () => {
    const verifier = resolveCaptchaVerifier({
      FORMS_CAPTCHA_PROVIDER: 'recaptcha',
      FORMS_CAPTCHA_SECRET: 'secret-key',
    } as NodeJS.ProcessEnv)
    expect(verifier).toBeInstanceOf(ProviderCaptchaVerifier)
  })

  it('falls back to noop when the secret is missing', () => {
    const verifier = resolveCaptchaVerifier({
      FORMS_CAPTCHA_PROVIDER: 'turnstile',
    } as NodeJS.ProcessEnv)
    expect(verifier).toBeInstanceOf(NoopCaptchaVerifier)
  })

  it('falls back to noop when the provider is missing or unknown', () => {
    expect(
      resolveCaptchaVerifier({ FORMS_CAPTCHA_SECRET: 'secret-key' } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(NoopCaptchaVerifier)
    expect(
      resolveCaptchaVerifier({
        FORMS_CAPTCHA_PROVIDER: 'hcaptcha',
        FORMS_CAPTCHA_SECRET: 'secret-key',
      } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(NoopCaptchaVerifier)
  })
})

describe('isCaptchaProviderConfigured', () => {
  it('is true only when provider + secret are both set to valid values', () => {
    expect(
      isCaptchaProviderConfigured({
        FORMS_CAPTCHA_PROVIDER: 'turnstile',
        FORMS_CAPTCHA_SECRET: 'secret-key',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
    expect(
      isCaptchaProviderConfigured({ FORMS_CAPTCHA_PROVIDER: 'turnstile' } as NodeJS.ProcessEnv),
    ).toBe(false)
    expect(
      isCaptchaProviderConfigured({ FORMS_CAPTCHA_SECRET: 'secret-key' } as NodeJS.ProcessEnv),
    ).toBe(false)
    expect(isCaptchaProviderConfigured({} as NodeJS.ProcessEnv)).toBe(false)
  })
})
