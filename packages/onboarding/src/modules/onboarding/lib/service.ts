import { randomBytes, createHash } from 'node:crypto'
import { hash } from 'bcryptjs'
import { EntityManager } from '@mikro-orm/postgresql'
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

    const existing = await this.em.findOne(OnboardingRequest, { email: input.email })
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
      existing.passwordHash = passwordHash
      existing.expiresAt = expiresAt
      existing.completedAt = null
      existing.processingStartedAt = null
      existing.tenantId = null
      existing.organizationId = null
      existing.userId = null
      existing.lastEmailSentAt = now
      await this.em.flush()
      return { request: existing, token }
    }

    const request = this.em.create(OnboardingRequest, {
      email: input.email,
      tokenHash,
      status: 'pending',
      firstName: input.firstName,
      lastName: input.lastName,
      organizationName: input.organizationName,
      locale: input.locale ?? 'en',
      termsAccepted: true,
      passwordHash,
      expiresAt,
      processingStartedAt: null,
      lastEmailSentAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await this.em.persistAndFlush(request)
    return { request, token }
  }

  async findPendingByToken(token: string) {
    const tokenHash = hashToken(token)
    const now = new Date()
    return this.em.findOne(OnboardingRequest, {
      tokenHash,
      status: 'pending',
      expiresAt: { $gt: now } as any,
    })
  }

  async findByToken(token: string) {
    const tokenHash = hashToken(token)
    return this.em.findOne(OnboardingRequest, { tokenHash })
  }

  async startProcessing(request: OnboardingRequest, startedAt: Date) {
    request.status = 'processing'
    request.processingStartedAt = startedAt
    await this.em.flush()
  }

  async resetProcessing(request: OnboardingRequest) {
    request.status = 'pending'
    request.processingStartedAt = null
    await this.em.flush()
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
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
