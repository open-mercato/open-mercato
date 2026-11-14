import { OnboardingRequest } from '../modules/onboarding/data/entities'
import {
  PROVISIONING_LEASE_HEARTBEAT_MS,
  PROVISIONING_LEASE_STALE_MS,
} from '../modules/onboarding/lib/provisioning-lease'

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
type SeedModule = { id: string; setup: { seedDefaults: () => Promise<void> } }

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
let leaseRenewals = 0
let leaseRenewalsAtCompletion: number | null = null
const detachedRequestIds: string[] = []
let detachedRequestIdsAtSetup: string[] | null = null

const blockingSeedModule: SeedModule = {
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
}
let seedModules: SeedModule[] = [blockingSeedModule]

function holdsLease(request: OnboardingRequest, heldSince: Date | null | undefined) {
  if (row.id !== request.id || row.status !== 'processing') return false
  return (row.processingStartedAt?.getTime() ?? null) === (heldSince?.getTime() ?? null)
}

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

  async renewProcessing(requestId: string, heldSince: Date, renewedAt: Date) {
    leaseRenewals += 1
    if (row.id !== requestId || row.status !== 'processing') return false
    if (row.processingStartedAt?.getTime() !== heldSince.getTime()) return false
    row.processingStartedAt = renewedAt
    return true
  }

  async resetProcessing(request: OnboardingRequest, heldSince = request.processingStartedAt ?? null) {
    if (!holdsLease(request, heldSince)) return false
    events.push('resetProcessing')
    row.status = 'pending'
    row.processingStartedAt = null
    request.status = 'pending'
    request.processingStartedAt = null
    return true
  }

  async updateProvisioningIds(request: OnboardingRequest, data: ProvisioningIds) {
    if (!holdsLease(request, request.processingStartedAt)) return null
    const refreshed = { ...data, processingStartedAt: new Date() }
    Object.assign(request, refreshed)
    Object.assign(row, refreshed)
    return refreshed.processingStartedAt
  }

  async markCompleted(request: OnboardingRequest, data: ProvisioningIds, heldSince = request.processingStartedAt ?? null) {
    if (!holdsLease(request, heldSince)) {
      events.push('markCompleted:rejected')
      return false
    }
    events.push('markCompleted')
    leaseRenewalsAtCompletion = leaseRenewals
    const completed = {
      ...data,
      status: 'completed' as const,
      completedAt: new Date(),
      processingStartedAt: null,
      passwordHash: null,
    }
    Object.assign(request, completed)
    Object.assign(row, completed)
    return true
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
  const em = {
    fork: () => em,
    getUnitOfWork: () => ({
      unsetIdentity: (entity: { id: string }) => {
        detachedRequestIds.push(entity.id)
      },
    }),
  }
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
  setupInitialTenant: jest.fn(async () => {
    detachedRequestIdsAtSetup = [...detachedRequestIds]
    return {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      users: [{ user: { id: USER_ID, email: 'owner@example.com' } }],
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => seedModules,
}))

import { GET } from '../modules/onboarding/api/get/onboarding/verify'

function verifyRequest() {
  return new Request(`https://app.example.com/api/onboarding/onboarding/verify?token=${TOKEN}`)
}

describe('onboarding verify provisioning lease', () => {
  const originalSelfServiceOnboardingEnabled = process.env.SELF_SERVICE_ONBOARDING_ENABLED

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true })
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'
    events.length = 0
    leaseRenewals = 0
    leaseRenewalsAtCompletion = null
    detachedRequestIds.length = 0
    detachedRequestIdsAtSetup = null
    seedModules = [blockingSeedModule]
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
    jest.clearAllTimers()
    jest.useRealTimers()
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

  it('detaches the claimed request from the request EM before provisioning can flush it', async () => {
    seedModules = []

    const response = await GET(verifyRequest())

    expect(response.headers.get('location')).toBe(
      `https://app.example.com/onboarding/preparing?tenant=${TENANT_ID}`,
    )
    expect(detachedRequestIdsAtSetup).toEqual(['req-1'])
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

  it('keeps the lease alive while a seedDefaults loop outlasts the stale window, and stops renewing once completed', async () => {
    const seedDefaultsStepMs = 10_000
    seedModules = Array.from({ length: 12 }, (_, index) => ({
      id: `defaults_${index}`,
      setup: {
        seedDefaults: () => new Promise<void>((resolve) => {
          setTimeout(resolve, seedDefaultsStepMs)
        }),
      },
    }))
    const original = GET(verifyRequest())

    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_STALE_MS + seedDefaultsStepMs)
    const duplicate = await GET(verifyRequest())

    expect(duplicate.headers.get('location')).toBe(
      `https://app.example.com/onboarding/preparing?tenant=${TENANT_ID}`,
    )
    expect(row.status).toBe('processing')
    expect(events).toEqual([])

    await jest.advanceTimersByTimeAsync(seedModules.length * seedDefaultsStepMs)
    await original

    expect(events).toEqual(['markCompleted', 'runDeferredProvisioning'])
    expect(row.status).toBe('completed')
    expect(leaseRenewalsAtCompletion).toBeGreaterThan(0)

    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_STALE_MS)

    expect(leaseRenewals).toBe(leaseRenewalsAtCompletion)
    expect(row.processingStartedAt).toBeNull()
  })

  it('stops a verify whose lease renewal fails after the request was moved back to pending', async () => {
    seedModules = [blockingSeedModule, {
      id: 'later_defaults',
      setup: {
        seedDefaults: async () => {
          events.push('laterDefaults')
        },
      },
    }]
    const original = GET(verifyRequest())
    await seedDefaultsEntered
    Object.assign(row, { status: 'pending', processingStartedAt: null })

    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS)
    releaseSeedDefaults()
    const response = await original

    expect(response.headers.get('location')).toBe('https://app.example.com/onboarding?status=error')
    expect(events).toEqual(['seedDefaults:start', 'seedDefaults:end'])
    expect(row.status).toBe('pending')
    expect(row.completedAt).toBeNull()
    expect(row.passwordHash).toBe('hashed')
  })

  it('does not let a verify that lost its lease complete or reset a newer run of the same request', async () => {
    const original = GET(verifyRequest())
    await seedDefaultsEntered
    const newerLease = new Date(Date.now() + 1000)
    const newerIds = {
      tenantId: '44444444-4444-4444-8444-444444444444',
      organizationId: '55555555-5555-4555-8555-555555555555',
      userId: '66666666-6666-4666-8666-666666666666',
    }
    Object.assign(row, { status: 'processing', processingStartedAt: newerLease, ...newerIds })

    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS)
    releaseSeedDefaults()
    const response = await original

    expect(response.headers.get('location')).toBe('https://app.example.com/onboarding?status=error')
    expect(events).toEqual(['seedDefaults:start', 'seedDefaults:end'])
    expect(row).toMatchObject({ status: 'processing', processingStartedAt: newerLease, completedAt: null, ...newerIds })
  })

  it('does not complete the request when the lease was lost between the last renewal and completion', async () => {
    const original = GET(verifyRequest())
    await seedDefaultsEntered
    const newerLease = new Date(Date.now() + 1000)
    Object.assign(row, { processingStartedAt: newerLease })

    releaseSeedDefaults()
    const response = await original

    expect(response.headers.get('location')).toBe('https://app.example.com/onboarding?status=error')
    expect(events).toEqual(['seedDefaults:start', 'seedDefaults:end', 'markCompleted:rejected'])
    expect(row).toMatchObject({ status: 'processing', processingStartedAt: newerLease, completedAt: null })
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
