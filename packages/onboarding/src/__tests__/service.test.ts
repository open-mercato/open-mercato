import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { OnboardingRequest } from '../modules/onboarding/data/entities'
import { OnboardingService } from '../modules/onboarding/lib/service'
import { hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'

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

type MockEm = EntityManager & {
  findOne: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
}

function createMockEm(overrides: Record<string, unknown> = {}): MockEm {
  const flush = jest.fn().mockResolvedValue(undefined)
  const persist = jest.fn(function persist(this: unknown) {
    return { flush }
  })
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => data),
    persist,
    flush,
    ...overrides,
  } as unknown as MockEm
}

type DbRow = { id: string; status: string; processingStartedAt: Date | null }

// EntityManager mock backed by a single persisted row. `nativeUpdate` honours the
// status guard in its WHERE clause (so it returns 0 when the row has already moved
// on), while `flush` writes the tracked managed entity's scalars back to the row —
// reproducing MikroORM's last-write-wins behaviour for the unconditional code path.
function createRowBackedEm(dbRow: DbRow, trackedEntity?: OnboardingRequest): EntityManager {
  const flush = jest.fn(async () => {
    if (!trackedEntity) return
    dbRow.status = trackedEntity.status
    dbRow.processingStartedAt = trackedEntity.processingStartedAt ?? null
  })
  const nativeUpdate = jest.fn(
    async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      const matches = Object.entries(where).every(
        ([key, value]) => (dbRow as unknown as Record<string, unknown>)[key] === value,
      )
      if (!matches) return 0
      if ('status' in data) dbRow.status = data.status as string
      if ('processingStartedAt' in data) dbRow.processingStartedAt = (data.processingStartedAt as Date | null) ?? null
      return 1
    },
  )
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    persist: jest.fn(() => ({ flush })),
    flush,
    nativeUpdate,
  } as unknown as EntityManager
}

describe('OnboardingService', () => {
  describe('createOrUpdateRequest', () => {
    it('creates a new pending request when no existing email found', async () => {
      const em = createMockEm()
      const service = new OnboardingService(em)
      const result = await service.createOrUpdateRequest(makeStartInput())
      expect(em.create).toHaveBeenCalledTimes(1)
      expect(em.persist).toHaveBeenCalledTimes(1)
      expect(em.flush).toHaveBeenCalledTimes(1)
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
      expect(createArgs.emailHash).toBe(hashForLookup('user@example.com'))
    })

    it('looks up encrypted and legacy plaintext emails without querying ciphertext as plaintext', async () => {
      const em = createMockEm()
      const service = new OnboardingService(em)

      await service.createOrUpdateRequest(makeStartInput())

      expect(em.findOne).toHaveBeenCalledWith(OnboardingRequest, {
        $or: [
          { emailHash: { $in: lookupHashCandidates('user@example.com') } },
          { email: 'user@example.com', emailHash: null },
        ],
      }, undefined)
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

  // Regression coverage for #2742: two concurrent verify requests carrying the same
  // token must not corrupt the persisted state. The fix makes the pending→processing
  // transition an atomic claim and the processing→pending reset conditional, so a
  // request that lost the race can never clobber a sibling that already completed.
  describe('startProcessing (atomic claim, #2742)', () => {
    it('lets only one concurrent caller claim a pending request', async () => {
      const dbRow: DbRow = { id: 'req-1', status: 'pending', processingStartedAt: null }
      const em = createRowBackedEm(dbRow)
      const service = new OnboardingService(em)
      const requestA = makeRequest({ id: 'req-1', status: 'pending', processingStartedAt: null })
      const requestB = makeRequest({ id: 'req-1', status: 'pending', processingStartedAt: null })

      const claimedA = await service.startProcessing(requestA, new Date())
      const claimedB = await service.startProcessing(requestB, new Date())

      expect(claimedA).toBe(true)
      expect(claimedB).toBe(false)
      expect(dbRow.status).toBe('processing')
    })
  })

  describe('resetProcessing (conditional revert, #2742)', () => {
    it('does not revert a request a concurrent worker already completed', async () => {
      // A sibling worker already advanced the persisted row to 'completed'.
      const dbRow: DbRow = { id: 'req-1', status: 'completed', processingStartedAt: null }
      // This worker still holds an in-memory copy it believes is 'processing'.
      const staleRequest = makeRequest({ id: 'req-1', status: 'processing', processingStartedAt: new Date() })
      const em = createRowBackedEm(dbRow, staleRequest)
      const service = new OnboardingService(em)

      const reverted = await service.resetProcessing(staleRequest)

      expect(reverted).toBe(false)
      expect(dbRow.status).toBe('completed')
    })

    it('reverts a request that is still processing', async () => {
      const dbRow: DbRow = { id: 'req-1', status: 'processing', processingStartedAt: new Date() }
      const request = makeRequest({ id: 'req-1', status: 'processing', processingStartedAt: new Date() })
      const em = createRowBackedEm(dbRow, request)
      const service = new OnboardingService(em)

      const reverted = await service.resetProcessing(request)

      expect(reverted).toBe(true)
      expect(dbRow.status).toBe('pending')
      expect(dbRow.processingStartedAt).toBeNull()
    })
  })
})
