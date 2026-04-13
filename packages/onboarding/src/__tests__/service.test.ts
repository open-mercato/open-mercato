import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { OnboardingRequest } from '../modules/onboarding/data/entities'
import { OnboardingService } from '../modules/onboarding/lib/service'

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
}))

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return Object.assign(new OnboardingRequest(), {
    id: 'req-1',
    email: 'user@example.com',
    tokenHash: hashToken('some-token'),
    status: 'pending',
    firstName: 'Jane',
    lastName: 'Doe',
    organizationName: 'Acme Corp',
    locale: 'en',
    termsAccepted: true,
    marketingConsent: false,
    passwordHash: 'hashed',
    expiresAt: new Date(Date.now() + 86400000),
    completedAt: null,
    processingStartedAt: null,
    tenantId: null,
    organizationId: null,
    userId: null,
    lastEmailSentAt: null,
    preparationCompletedAt: null,
    readyEmailSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  })
}

function makeStartInput(overrides: Record<string, unknown> = {}) {
  return {
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    organizationName: 'Acme Corp',
    password: 'Secret1!',
    confirmPassword: 'Secret1!',
    termsAccepted: true as const,
    marketingConsent: false,
    ...overrides,
  }
}

function createMockEm(overrides: Record<string, unknown> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => data),
    persistAndFlush: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EntityManager
}

describe('OnboardingService', () => {
  describe('createOrUpdateRequest', () => {
    it('creates a new pending request when no existing email found', async () => {
      const em = createMockEm()
      const service = new OnboardingService(em)
      const result = await service.createOrUpdateRequest(makeStartInput())
      expect(em.create).toHaveBeenCalledTimes(1)
      expect(em.persistAndFlush).toHaveBeenCalledTimes(1)
      expect(result.request).toBeDefined()
      expect(result.token).toBeDefined()
      expect(result.token.length).toBe(64)
    })

    it('sets status to pending on new request', async () => {
      const em = createMockEm()
      const service = new OnboardingService(em)
      const result = await service.createOrUpdateRequest(makeStartInput())
      const createArgs = em.create.mock.calls[0][1]
      expect(createArgs.status).toBe('pending')
    })

    it('throws PENDING_REQUEST when within cooldown', async () => {
      const existing = makeRequest({ status: 'pending', lastEmailSentAt: new Date(Date.now() - 2 * 60 * 1000) })
      const em = createMockEm({ findOne: jest.fn().mockResolvedValue(existing) })
      const service = new OnboardingService(em)
      await expect(service.createOrUpdateRequest(makeStartInput())).rejects.toThrow(/^PENDING_REQUEST:\d+$/)
    })
  })

  describe('findPendingByToken', () => {
    it('queries with hashed token', async () => {
      const em = createMockEm()
      const service = new OnboardingService(em)
      await service.findPendingByToken('abc123def456')
      const args = em.findOne.mock.calls[0]
      expect(args[1]).toMatchObject({ tokenHash: hashToken('abc123def456'), status: 'pending' })
    })
  })

  describe('markCompleted', () => {
    it('sets status to completed and clears passwordHash', async () => {
      const request = makeRequest({ passwordHash: 'secret' })
      const em = createMockEm()
      const service = new OnboardingService(em)
      await service.markCompleted(request, { tenantId: 't', organizationId: 'o', userId: 'u' })
      expect(request.status).toBe('completed')
      expect(request.passwordHash).toBeNull()
      expect(em.flush).toHaveBeenCalled()
    })
  })
})
