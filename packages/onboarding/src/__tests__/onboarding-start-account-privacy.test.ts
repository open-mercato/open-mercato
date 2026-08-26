const findOneWithDecryption = jest.fn()
const createOrUpdateRequest = jest.fn()
const sendEmail = jest.fn()
const getSecurityEmailBaseUrl = jest.fn()
const consume = jest.fn()
const deleteRateLimitKey = jest.fn()
const resolveRateLimiterService = jest.fn()

const originalSelfServiceOnboardingEnabled = process.env.SELF_SERVICE_ONBOARDING_ENABLED

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return { flush: jest.fn() }
      if (name === 'rateLimiterService') return resolveRateLimiterService()
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  lookupHashCandidates: (email: string) => [`candidate:${email}`],
  hashForLookup: (email: string) => `hash:${email}`,
}))

jest.mock('@open-mercato/shared/lib/url', () => ({
  getSecurityEmailBaseUrl: (...args: unknown[]) => getSecurityEmailBaseUrl(...args),
  mapSecurityEmailUrlError: (error: unknown) => {
    if (error instanceof Error && error.message === 'APP_URL missing') {
      return { status: 500, body: { error: 'Self-service onboarding is not configured.' } }
    }
    return null
  },
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({ createOrUpdateRequest })),
}))

jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  User: class User {},
}))

import { POST } from '../modules/onboarding/api/post/onboarding'

const EXISTING_EMAIL = 'has-account@example.com'
const NEW_EMAIL = 'no-account@example.com'
const BASE_URL = 'https://app.example.com'

type ProbeResult = { status: number; body: unknown }

function submission(email: string) {
  return {
    email,
    firstName: 'Mallory',
    lastName: 'Prober',
    organizationName: 'Probe Industries',
    password: 'Str0ng!Passw0rd',
    confirmPassword: 'Str0ng!Passw0rd',
    termsAccepted: true,
    marketingConsent: false,
  }
}

async function probe(email: string): Promise<ProbeResult> {
  const response = await POST(new Request(`${BASE_URL}/api/onboarding/onboarding`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission(email)),
  }))
  return { status: response.status, body: await response.json() }
}

function collectStrings(node: any, into: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return into
  if (typeof node === 'string' || typeof node === 'number') {
    into.push(String(node))
    return into
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, into)
    return into
  }
  if (typeof node === 'object' && node.props) {
    if (typeof node.props.href === 'string') into.push(node.props.href)
    collectStrings(node.props.children, into)
  }
  return into
}

function noticeEmailCall() {
  return sendEmail.mock.calls.find((call) => call[0]?.subject === 'About your Open Mercato account')
}

function verificationEmailCall() {
  return sendEmail.mock.calls.find((call) => call[0]?.subject === 'Confirm your email to finish onboarding')
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'
  getSecurityEmailBaseUrl.mockReturnValue(BASE_URL)
  sendEmail.mockResolvedValue(undefined)
  consume.mockResolvedValue({ allowed: true, remainingPoints: 0, msBeforeNext: 0, consumedPoints: 1 })
  deleteRateLimitKey.mockResolvedValue(undefined)
  resolveRateLimiterService.mockReturnValue({ consume, delete: deleteRateLimitKey })
  findOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: any) => {
    const probed = where?.$or?.[0]?.email
    return probed === EXISTING_EMAIL ? { id: 'user-1', email: EXISTING_EMAIL } : null
  })
  createOrUpdateRequest.mockImplementation(async (input: any) => ({
    request: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      organizationName: input.organizationName,
      marketingConsent: false,
      lastEmailSentAt: new Date(),
    },
    token: 'verification-token',
  }))
})

afterAll(() => {
  if (originalSelfServiceOnboardingEnabled === undefined) {
    delete process.env.SELF_SERVICE_ONBOARDING_ENABLED
  } else {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = originalSelfServiceOnboardingEnabled
  }
})

describe('onboarding start does not disclose whether an email already has an account', () => {
  it('answers identically for an address with an account and one without', async () => {
    const existing = await probe(EXISTING_EMAIL)
    const fresh = await probe(NEW_EMAIL)

    expect(existing.status).toBe(200)
    expect(existing.body).toEqual({ ok: true, email: EXISTING_EMAIL })
    expect(fresh.status).toBe(existing.status)
    expect(fresh.body).toEqual({ ok: true, email: NEW_EMAIL })
  })

  it('answers identically inside the pending-verification window', async () => {
    createOrUpdateRequest.mockRejectedValueOnce(new Error('PENDING_REQUEST:7'))

    const throttled = await probe(NEW_EMAIL)

    expect(throttled.status).toBe(200)
    expect(throttled.body).toEqual({ ok: true, email: NEW_EMAIL })
  })

  it('answers identically when the outbound email fails on either branch', async () => {
    sendEmail.mockRejectedValue(new Error('smtp down'))

    const existing = await probe(EXISTING_EMAIL)
    const fresh = await probe(NEW_EMAIL)

    expect(existing.status).toBe(502)
    expect(fresh.status).toBe(502)
    expect(existing.body).toEqual(fresh.body)
  })

  it('answers identically when the base URL is misconfigured on either branch', async () => {
    getSecurityEmailBaseUrl.mockImplementation(() => {
      throw new Error('APP_URL missing')
    })

    const existing = await probe(EXISTING_EMAIL)
    const fresh = await probe(NEW_EMAIL)

    expect(existing.status).toBe(500)
    expect(fresh.status).toBe(500)
    expect(existing.body).toEqual(fresh.body)
  })
})

describe('onboarding start handles the existing account out of band', () => {
  it('emails the address owner a neutral notice instead of a verification link', async () => {
    await probe(EXISTING_EMAIL)

    expect(verificationEmailCall()).toBeUndefined()
    expect(createOrUpdateRequest).not.toHaveBeenCalled()

    const notice = noticeEmailCall()
    expect(notice?.[0].to).toBe(EXISTING_EMAIL)

    const rendered = collectStrings(notice?.[0].react)
    expect(rendered).toContain(`${BASE_URL}/login`)
    expect(rendered).toContain('You already have an account')
    for (const submitterSupplied of ['Mallory', 'Prober', 'Probe Industries']) {
      expect(rendered.some((text) => text.includes(submitterSupplied))).toBe(false)
    }
  })

  it('sends the verification email for an address without an account', async () => {
    await probe(NEW_EMAIL)

    expect(noticeEmailCall()).toBeUndefined()
    expect(verificationEmailCall()?.[0].to).toBe(NEW_EMAIL)
  })

  it('throttles the notice per address and still returns the accepted response', async () => {
    consume.mockResolvedValueOnce({ allowed: false, remainingPoints: 0, msBeforeNext: 60_000, consumedPoints: 2 })

    const throttled = await probe(EXISTING_EMAIL)

    expect(consume).toHaveBeenCalledWith(`hash:${EXISTING_EMAIL}`, expect.objectContaining({ points: 1, duration: 600 }))
    expect(noticeEmailCall()).toBeUndefined()
    expect(throttled.status).toBe(200)
    expect(throttled.body).toEqual({ ok: true, email: EXISTING_EMAIL })
  })

  it('releases the notice window when the send fails so a retry behaves like the other branch', async () => {
    sendEmail.mockRejectedValueOnce(new Error('smtp down'))

    await probe(EXISTING_EMAIL)

    expect(deleteRateLimitKey).toHaveBeenCalledWith(`hash:${EXISTING_EMAIL}`, expect.objectContaining({ points: 1, duration: 600 }))
  })

  it('sends the notice when no rate limiter is registered', async () => {
    resolveRateLimiterService.mockImplementation(() => {
      throw new Error('[internal] rateLimiterService is not registered')
    })

    const existing = await probe(EXISTING_EMAIL)

    expect(noticeEmailCall()?.[0].to).toBe(EXISTING_EMAIL)
    expect(existing.status).toBe(200)
  })
})
