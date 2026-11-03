import { randomBytes, createHash } from 'node:crypto'
import { hash } from 'bcryptjs'
import { EntityManager } from '@mikro-orm/postgresql'
import { hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { OnboardingRequest } from '../data/entities'
import type { OnboardingStartInput } from '../data/validators'

type CreateRequestOptions = {
  expiresInHours?: number
}

export class OnboardingService {
  constructor(private readonly em: EntityManager) {}

  async createOrUpdateRequest(input: OnboardingStartInput, options: CreateRequestOptions = {}) {
    const expiresInHours = options.expiresInHours ?? 24
    const token = randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    const now = new Date()
    const passwordHash = await hash(input.password, 10)
    const emailHash = hashForLookup(input.email)

    const existing = await findOneWithDecryption(this.em, OnboardingRequest, {
      $or: [
        { emailHash: { $in: lookupHashCandidates(input.email) } },
        { email: input.email, emailHash: null },
      ],
    })
    if (existing) {
      const lastSentAt = existing.lastEmailSentAt ?? existing.updatedAt ?? existing.createdAt
      if (['pending', 'processing'].includes(existing.status) && lastSentAt && lastSentAt.getTime() > Date.now() - 10 * 60 * 1000) {
        const remainingMs = 10 * 60 * 1000 - (Date.now() - lastSentAt.getTime())
        const waitMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)))
        throw new Error(`PENDING_REQUEST:${waitMinutes}`)
      }
      existing.tokenHash = tokenHash
      existing.status = 'pending'
      existing.firstName = input.firstName
      existing.lastName = input.lastName
      existing.organizationName = input.organizationName
      existing.locale = input.locale ?? existing.locale ?? 'en'
      existing.termsAccepted = true
      existing.marketingConsent = input.marketingConsent ?? false
      existing.passwordHash = passwordHash
      existing.emailHash = emailHash
      existing.expiresAt = expiresAt
      existing.completedAt = null
      existing.processingStartedAt = null
      existing.tenantId = null
      existing.organizationId = null
      existing.userId = null
      existing.lastEmailSentAt = now
      existing.preparationStartedAt = null
      existing.preparationCompletedAt = null
      existing.readyEmailSentAt = null
      await this.em.flush()
      return { request: existing, token }
    }

    const request = this.em.create(OnboardingRequest, {
      email: input.email,
      emailHash,
      tokenHash,
      status: 'pending',
      firstName: input.firstName,
      lastName: input.lastName,
      organizationName: input.organizationName,
      locale: input.locale ?? 'en',
      termsAccepted: true,
      marketingConsent: input.marketingConsent ?? false,
      passwordHash,
      expiresAt,
      processingStartedAt: null,
      lastEmailSentAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await this.em.persist(request).flush()
    return { request, token }
  }

  async findPendingByToken(token: string) {
    const tokenHash = hashToken(token)
    const now = new Date()
    return findOneWithDecryption(this.em, OnboardingRequest, {
      tokenHash,
      status: 'pending',
      expiresAt: { $gt: now } as any,
    })
  }

  async findByToken(token: string) {
    const tokenHash = hashToken(token)
    return findOneWithDecryption(this.em, OnboardingRequest, { tokenHash })
  }

  async findById(id: string) {
    return findOneWithDecryption(this.em, OnboardingRequest, { id })
  }

  async findLatestByTenantId(tenantId: string) {
    return findOneWithDecryption(
      this.em,
      OnboardingRequest,
      { tenantId, deletedAt: null },
      { orderBy: { updatedAt: 'DESC', createdAt: 'DESC' } },
      { tenantId, organizationId: null },
    )
  }

  async startProcessing(request: OnboardingRequest, startedAt: Date): Promise<boolean> {
    const claimedRows = await this.em.nativeUpdate(
      OnboardingRequest,
      { id: request.id, status: 'pending' },
      { status: 'processing', processingStartedAt: startedAt, updatedAt: new Date() },
    )
    if (claimedRows === 0) return false
    request.status = 'processing'
    request.processingStartedAt = startedAt
    return true
  }

  async resetProcessing(request: OnboardingRequest): Promise<boolean> {
    const revertedRows = await this.em.nativeUpdate(
      OnboardingRequest,
      { id: request.id, status: 'processing' },
      { status: 'pending', processingStartedAt: null, updatedAt: new Date() },
    )
    if (revertedRows === 0) return false
    request.status = 'pending'
    request.processingStartedAt = null
    return true
  }

  async updateProvisioningIds(request: OnboardingRequest, data: { tenantId: string; organizationId: string; userId: string }) {
    request.tenantId = data.tenantId
    request.organizationId = data.organizationId
    request.userId = data.userId
    await this.em.flush()
  }

  async markCompleted(request: OnboardingRequest, data: { tenantId: string; organizationId: string; userId: string }) {
    request.status = 'completed'
    request.completedAt = new Date()
    request.tenantId = data.tenantId
    request.organizationId = data.organizationId
    request.userId = data.userId
    request.processingStartedAt = null
    request.passwordHash = null
    await this.em.flush()
  }

  async markReadyEmailSent(request: OnboardingRequest, sentAt: Date) {
    request.readyEmailSentAt = sentAt
    await this.em.flush()
  }

  async claimPreparation(requestId: string, claimedAt: Date, staleBefore: Date): Promise<boolean> {
    const claimedRows = await this.em.nativeUpdate(
      OnboardingRequest,
      {
        id: requestId,
        status: 'completed',
        preparationCompletedAt: null,
        $or: [
          { preparationStartedAt: null },
          { preparationStartedAt: { $lt: staleBefore } },
        ],
      },
      { preparationStartedAt: claimedAt, updatedAt: new Date() },
    )
    return claimedRows > 0
  }

  async renewPreparation(requestId: string, renewedAt: Date): Promise<boolean> {
    const renewedRows = await this.em.nativeUpdate(
      OnboardingRequest,
      {
        id: requestId,
        status: 'completed',
        preparationCompletedAt: null,
        preparationStartedAt: { $ne: null },
      },
      { preparationStartedAt: renewedAt, updatedAt: new Date() },
    )
    return renewedRows > 0
  }

  async markPreparationCompleted(request: OnboardingRequest, completedAt: Date) {
    request.preparationCompletedAt = completedAt
    request.preparationStartedAt = null
    await this.em.flush()
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
