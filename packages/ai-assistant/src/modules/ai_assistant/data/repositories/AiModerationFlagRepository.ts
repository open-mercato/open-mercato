import type { EntityManager } from '@mikro-orm/postgresql'
import { AiModerationFlag } from '../entities'
import type { ModerationCategoryResult } from '../../lib/moderation'

export interface CreateModerationFlagInput {
  tenantId: string
  organizationId?: string | null
  agentId: string
  userId: string
  providerId: string
  modelId: string
  categories: Record<string, ModerationCategoryResult>
}

export interface ListModerationFlagsFilter {
  tenantId: string
  organizationId?: string | null
  agentId?: string
  userId?: string
  /** Inclusive lower bound on `created_at`. */
  from?: Date
  /** Inclusive upper bound on `created_at`. */
  to?: Date
  page: number
  pageSize: number
}

export interface ModerationFlagListResult {
  items: AiModerationFlag[]
  total: number
}

/**
 * Repository for the append-only `ai_moderation_flags` audit table. Every read
 * is tenant-scoped — cross-tenant access is structurally impossible because
 * `tenantId` is always part of the filter.
 *
 * Spec `2026-06-04-ai-input-moderation-and-safety-identifiers`.
 */
export class AiModerationFlagRepository {
  constructor(private readonly em: EntityManager) {}

  async create(input: CreateModerationFlagInput): Promise<AiModerationFlag> {
    const flag = this.em.create(AiModerationFlag, {
      tenantId: input.tenantId,
      organizationId: input.organizationId ?? null,
      agentId: input.agentId,
      userId: input.userId,
      providerId: input.providerId,
      modelId: input.modelId,
      categories: input.categories,
    })
    this.em.persist(flag)
    await this.em.flush()
    return flag
  }

  async list(filter: ListModerationFlagsFilter): Promise<ModerationFlagListResult> {
    const where: Record<string, unknown> = { tenantId: filter.tenantId }
    if (filter.organizationId !== undefined && filter.organizationId !== null) {
      where.organizationId = filter.organizationId
    }
    if (filter.agentId) where.agentId = filter.agentId
    if (filter.userId) where.userId = filter.userId
    if (filter.from || filter.to) {
      const createdAt: Record<string, Date> = {}
      if (filter.from) createdAt.$gte = filter.from
      if (filter.to) createdAt.$lte = filter.to
      where.createdAt = createdAt
    }

    const [items, total] = await this.em.findAndCount(AiModerationFlag, where, {
      orderBy: { createdAt: 'desc' },
      limit: filter.pageSize,
      offset: (filter.page - 1) * filter.pageSize,
    })
    return { items, total }
  }
}
