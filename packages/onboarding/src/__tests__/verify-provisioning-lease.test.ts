import { OnboardingRequest } from '../modules/onboarding/data/entities'

type RequestRow = Pick<
  OnboardingRequest,
  | 'id'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'organizationName'
  | 'marketingConsent'
  | 'passwordHash'
  | 'status'
  | 'processingStartedAt'
  | 'expiresAt'
  | 'completedAt'
  | 'tenantId'
  | 'organizationId'
  | 'userId'
  | 'preparationCompletedAt'
  | 'readyEmailSentAt'
>

type ProvisioningIds = { tenantId: string; organizationId: string; userId: string }

const TOKEN = 'a'.repeat(64)
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

const events: string[] = []
let row: RequestRow
let staleTokenLookup: RequestRow | null = null
let releaseSeedDefaults: () => void = () => {}
let seedDefaultsEntered: Promise<void> = Promise.resolve()
let markSeedDefaultsEntered: () => void = () => {}

function toEntity(source: RequestRow): OnboardingRequest {
  return Object.assign(new OnboardingRequest(), { ...source })
}

class InMemoryOnboardingService {
  async findByToken(token: string) {
    if (token !== TOKEN) return null
    return toEntity(staleTokenLookup ?? row)
  }

  async findById(id: string) {
    return id === row.id ? toEntity(row) : null
  }

  async startProcessing(request: OnboardingRequest, startedAt: Date) {
    if (row.id !== request.id || row.status !== 'pending') return false
    row.status = 'processing'
    row.processingStartedAt = startedAt
    request.status = 'processing'
    request.processingStartedAt = startedAt
    return true
  }

  async renewProcessing(request: OnboardingRequest, renewedAt: Date) {
    if (row.id !== request.id || row.status !== 'processing') return false
    row.processingStartedAt = renewedAt
    request.processingStartedAt = renewedAt
    return true
  }

  async resetProcessing(request: OnboardingRequest) {
    if (row.id !== request.id || row.status !== 'processing') return false
    row.status = 'pending'
    row.processingStartedAt = null
    request.status = 'pending'
    request.processingStartedAt = null
    return true
  }

  async updateProvisioningIds(request: OnboardingRequest, data: ProvisioningIds) {
    const refreshed = { ...data, processingStartedAt: new Date() }
    Object.assign(request, refreshed)
    Object.assign(row, refreshed)
  }

  async markCompleted(request: OnboardingRequest, data: ProvisioningIds) {
    events.push('markCompleted')
    const completed = {
      ...data,
      status: 'completed' as const,
      completedAt: new Date(),
      processingStartedAt: null,
      passwordHash: null,
    }
    Object.assign(request, completed)
    Object.assign(row, completed)
  }
}

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server')
  return {
    ...actual,
    after: (callback: () => unknown) => {
      void callback()
    },
  }
})

jest.mock('@open-mercato/shared/lib/di/container', () => {
  const em = { fork: () => em }
  return {
    createRequestContainer: jest.fn(async () => ({
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`unexpected resolve(${name})`)
      },
    })),
  }
})

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => new InMemoryOnboardingService()),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/verify-base-url', () => ({
  resolveVerifyRedirectBaseUrl: () => ({ ok: true, baseUrl: 'https://app.example.com' }),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email', () => ({
  sendWorkspaceReadyEmail: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/consentClientIp', () => ({
  resolveConsentClientIp: jest.fn(() => null),
}))

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning', () => {
  const actual = jest.requireActual('@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning')
  return {
    resolveProvisioningIds: actual.resolveProvisioningIds,
    runDeferredProvisioning: jest.fn(async () => {
      events.push('runDeferredProvisioning')
    }),
  }
})

jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  setupInitialTenant: jest.fn(async () => ({
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    users: [{ user: { id: USER_ID, email: 'owner@example.com' } }],
  })),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => [
    {
      id: 'slow_defaults',
      setup: {
        seedDefaults: async () => {
          events.push('seedDefaults:start')
          markSeedDefaultsEntered()
          await new Promise<void>((resolve) => {
            releaseSeedDefaults = resolve
          })
          events.push('seedDefaults:end')
        },
      },
    },
  ],
}))

import { GET } from '../modules/onboarding/api/get/onboarding/verify'

function verifyRequest() {
  return new Request(`https://app.example.com/api/onboarding/onboarding/verify?token=${TOKEN}`)
}

describe('onboarding verify provisioning lease', () => {
  const originalSelfServiceOnboardingEnabled = process.env.SELF_SERVICE_ONBOARDING_ENABLED

  beforeEach(() => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'
    events.length = 0
    staleTokenLookup = null
    seedDefaultsEntered = new Promise<void>((resolve) => {
      markSeedDefaultsEntered = resolve
    })
    row = {
      id: 'req-1',
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'Example',
      organizationName: 'Example Org',
      marketingConsent: false,
      passwordHash: 'hashed',
      status: 'pending',
      processingStartedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      completedAt: null,
      tenantId: null,
      organizationId: null,
      userId: null,
      preparationCompletedAt: null,
      readyEmailSentAt: null,
    }
  })

  afterEach(() => {
    releaseSeedDefaults()
  })

  afterAll(() => {
    if (originalSelfServiceOnboardingEnabled === undefined) {
      delete process.env.SELF_SERVICE_ONBOARDING_ENABLED
    } else {
      process.env.SELF_SERVICE_ONBOARDING_ENABLED = originalSelfServiceOnboardingEnabled
    }
  })

  it('does not let a duplicate verify complete the request while the original seedDefaults loop is running', async () => {
    const original = GET(verifyRequest())
    await seedDefaultsEntered

    const duplicate = await GET(verifyRequest())

    expect(duplicate.status).toBe(307)
    expect(duplicate.headers.get('location')).toBe(
      `https://app.example.com/onboarding/preparing?tenant=${TENANT_ID}`,
    )
    expect(row.status).toBe('processing')
    expect(events).toEqual(['seedDefaults:start'])

    releaseSeedDefaults()
    const response = await original

    expect(response.headers.get('location')).toBe(
      `https://app.example.com/onboarding/preparing?tenant=${TENANT_ID}`,
    )
    expect(events).toEqual([
      'seedDefaults:start',
      'seedDefaults:end',
      'markCompleted',
      'runDeferredProvisioning',
    ])
    expect(row.status).toBe('completed')
  })

  it('does not let a verify that lost the processing claim complete the live request', async () => {
    const pendingSnapshot = { ...row }
    const original = GET(verifyRequest())
    await seedDefaultsEntered
    staleTokenLookup = pendingSnapshot

    const duplicate = await GET(verifyRequest())

    expect(duplicate.headers.get('location')).toBe(
      `https://app.example.com/onboarding/preparing?tenant=${TENANT_ID}`,
    )
    expect(row.status).toBe('processing')
    expect(events).toEqual(['seedDefaults:start'])

    staleTokenLookup = null
    releaseSeedDefaults()
    await original

    expect(events).toEqual([
      'seedDefaults:start',
      'seedDefaults:end',
      'markCompleted',
      'runDeferredProvisioning',
    ])
  })

  it.each([
    ['inside the processing lock window', 2 * 60 * 1000],
    ['past the processing lock window', 20 * 60 * 1000],
  ])('still recovers a processing request with provisioned ids once its lease has gone stale (%s)', async (_label, leaseAgeMs) => {
    Object.assign(row, {
      status: 'processing',
      processingStartedAt: new Date(Date.now() - leaseAgeMs),
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
    })

    const response = await GET(verifyRequest())

    expect(response.headers.get('location')).toBe(
      `https://app.example.com/onboarding/preparing?tenant=${TENANT_ID}`,
    )
    expect(events).toEqual(['markCompleted', 'runDeferredProvisioning'])
    expect(row.status).toBe('completed')
  })
})
