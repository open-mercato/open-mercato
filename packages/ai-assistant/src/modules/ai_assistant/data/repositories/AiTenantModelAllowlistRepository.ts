import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { AiTenantModelAllowlist } from '../entities'

export interface AiTenantModelAllowlistContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface AiTenantModelAllowlistInput {
  /**
   * Tenant-permitted provider ids. `null` means "inherit env" (no tenant
   * restriction beyond what `OM_AI_AVAILABLE_PROVIDERS` imposes). An empty
   * array means "no providers permitted" — the runtime will fall through to
   * env-default behaviour but the settings UI will surface zero options.
   */
  allowedProviders?: string[] | null
  /**
   * Per-provider allowed model lists. A missing key means "inherit env" for
   * that provider; an empty array means "no models permitted for this
   * provider" (effectively disabling it for tenant-side picks).
   */
  allowedModelsByProvider?: Record<string, string[]>
}

export interface AiTenantModelAllowlistSnapshot {
  allowedProviders: string[] | null
  allowedModelsByProvider: Record<string, string[]>
}

/**
 * Repository for the per-tenant provider/model allowlist (Phase 1780-6 of spec
 * `2026-04-27-ai-agents-provider-model-baseurl-overrides`).
 *
 * Reads always filter by `tenant_id`. The tenant allowlist clips runtime
 * choices within the env-driven outer constraint — the route layer is
 * responsible for rejecting writes that escape `OM_AI_AVAILABLE_*`. This
 * repository does not consult the env directly; it stores whatever the route
 * has already validated.
 */
export class AiTenantModelAllowlistRepository {
  constructor(private readonly em: EntityManager) {}

  async getForTenant(ctx: {
    tenantId: string
    organizationId?: string | null
  }): Promise<AiTenantModelAllowlist | null> {
    if (!ctx?.tenantId) return null
    const orgFilter = ctx.organizationId ?? null
    const row = await this.em.findOne(AiTenantModelAllowlist, {
      tenantId: ctx.tenantId,
      organizationId: orgFilter,
      deletedAt: null,
    } satisfies FilterQuery<AiTenantModelAllowlist>)
    return row ?? null
  }

  async getSnapshot(ctx: {
    tenantId: string
    organizationId?: string | null
  }): Promise<AiTenantModelAllowlistSnapshot | null> {
    const row = await this.getForTenant(ctx)
    if (!row) return null
    return {
      allowedProviders: row.allowedProviders ?? null,
      allowedModelsByProvider: row.allowedModelsByProvider ?? {},
    }
  }

  async upsert(
    input: AiTenantModelAllowlistInput,
    ctx: AiTenantModelAllowlistContext,
  ): Promise<AiTenantModelAllowlist> {
    if (!ctx?.tenantId) {
      throw new Error('AiTenantModelAllowlistRepository.upsert requires tenantId')
    }

    const orgFilter = ctx.organizationId ?? null
    const providers = input.allowedProviders === undefined
      ? null
      : input.allowedProviders
    const models = input.allowedModelsByProvider ?? {}

    return this.em.transactional(async (tx) => {
      const existing = await tx.findOne(AiTenantModelAllowlist, {
        tenantId: ctx.tenantId,
        organizationId: orgFilter,
        deletedAt: null,
      } satisfies FilterQuery<AiTenantModelAllowlist>)

      if (existing) {
        existing.allowedProviders = providers
        existing.allowedModelsByProvider = models
        existing.updatedByUserId = ctx.userId ?? null
        existing.updatedAt = new Date()
        await tx.persist(existing).flush()
        return existing
      }

      const row = tx.create(AiTenantModelAllowlist, {
        tenantId: ctx.tenantId,
        organizationId: orgFilter,
        allowedProviders: providers,
        allowedModelsByProvider: models,
        updatedByUserId: ctx.userId ?? null,
      } as unknown as AiTenantModelAllowlist)
      await tx.persist(row).flush()
      return row
    })
  }

  async clear(ctx: {
    tenantId: string
    organizationId?: string | null
  }): Promise<boolean> {
    if (!ctx?.tenantId) return false
    const orgFilter = ctx.organizationId ?? null
    return this.em.transactional(async (tx) => {
      const existing = await tx.findOne(AiTenantModelAllowlist, {
        tenantId: ctx.tenantId,
        organizationId: orgFilter,
        deletedAt: null,
      } satisfies FilterQuery<AiTenantModelAllowlist>)
      if (!existing) return false
      existing.deletedAt = new Date()
      await tx.persist(existing).flush()
      return true
    })
  }
}

export default AiTenantModelAllowlistRepository
