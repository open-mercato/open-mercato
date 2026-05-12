import type { EntityManager } from '@mikro-orm/postgresql'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { canonicalProviderId } from '../../lib/model-allowlist'
import { AiAgentRuntimeOverride } from '../entities'

export interface AiAgentRuntimeOverrideContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface AiAgentRuntimeOverrideInput {
  /** null means tenant-wide default (no agent pinning). */
  agentId?: string | null
  providerId?: string | null
  modelId?: string | null
  baseURL?: string | null
  allowedOverrideProviders?: string[] | null
  allowedOverrideModelsByProvider?: Record<string, string[]>
}

/**
 * Repository for per-tenant AI runtime overrides (Phase 4a of spec
 * `2026-04-27-ai-agents-provider-model-baseurl-overrides`).
 *
 * All reads MUST filter by `tenant_id` first. The three public methods follow
 * the same fail-safe pattern as sibling repositories: `getDefault` returns
 * null on missing tenant context; `upsertDefault` validates provider id at
 * write time; `clearDefault` soft-deletes via `deleted_at`.
 *
 * Resolution precedence returned by `getDefault`:
 *   1. Agent-specific row (non-null `agent_id`) when `agentId` is provided.
 *   2. Tenant-wide row (`agent_id IS NULL`) for the same `(tenant_id, org_id)`.
 * Both rows are always scoped to the caller's `tenant_id` — cross-tenant
 * reads are impossible because every query filters `WHERE tenant_id = ?`.
 */
export class AiAgentRuntimeOverrideRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Returns the most-specific active runtime override for the given context.
   *
   * When `agentId` is provided, an agent-specific row takes precedence over a
   * tenant-wide null-agent row. Returns null when neither exists.
   *
   * Never returns a row with `deleted_at IS NOT NULL`.
   */
  async getDefault(ctx: {
    tenantId: string
    organizationId?: string | null
    agentId?: string | null
  }): Promise<AiAgentRuntimeOverride | null> {
    if (!ctx?.tenantId) return null

    const orgFilter = ctx.organizationId ?? null

    // Try agent-specific first when caller provided an agentId.
    if (ctx.agentId) {
      const agentRow = await this.em.findOne(AiAgentRuntimeOverride, {
        tenantId: ctx.tenantId,
        organizationId: orgFilter,
        agentId: ctx.agentId,
        deletedAt: null,
      } as any)
      if (agentRow) return agentRow
    }

    // Fall back to tenant-wide row (agentId = null).
    const tenantRow = await this.em.findOne(AiAgentRuntimeOverride, {
      tenantId: ctx.tenantId,
      organizationId: orgFilter,
      agentId: null,
      deletedAt: null,
    } as any)
    return tenantRow ?? null
  }

  async getExact(ctx: {
    tenantId: string
    organizationId?: string | null
    agentId?: string | null
  }): Promise<AiAgentRuntimeOverride | null> {
    if (!ctx?.tenantId) return null
    const row = await this.em.findOne(AiAgentRuntimeOverride, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
      agentId: ctx.agentId ?? null,
      deletedAt: null,
    } as any)
    return row ?? null
  }

  /**
   * Inserts or updates the runtime override for the given context.
   *
   * Validates `providerId` against the registry at write time so an admin
   * cannot save a typo (Phase 1.4 contract re-applied per spec §Data Models).
   * An unknown provider id throws a typed error.
   *
   * The R6 base-URL allowlist check is intentionally NOT performed here —
   * that enforcement lives at the HTTP layer (PUT settings route). The
   * repository trusts that callers have already validated the value.
   */
  async upsertDefault(
    input: AiAgentRuntimeOverrideInput,
    ctx: AiAgentRuntimeOverrideContext,
  ): Promise<AiAgentRuntimeOverride> {
    if (!ctx?.tenantId) {
      throw new Error('AiAgentRuntimeOverrideRepository.upsertDefault requires tenantId')
    }

    const normalizedProviderId = input.providerId
      ? canonicalProviderId(input.providerId, llmProviderRegistry.list().map((p) => p.id))
      : null
    if (input.providerId) {
      const knownProvider = normalizedProviderId ? llmProviderRegistry.get(normalizedProviderId) : null
      if (!knownProvider) {
        throw new AiAgentRuntimeOverrideValidationError(
          `Unknown provider id "${input.providerId}". Registered provider ids: ${llmProviderRegistry.list().map((p) => p.id).join(', ')}.`,
        )
      }
    }

    const orgFilter = ctx.organizationId ?? null
    const agentIdFilter = input.agentId ?? null
    const hasProviderId = Object.prototype.hasOwnProperty.call(input, 'providerId')
    const hasModelId = Object.prototype.hasOwnProperty.call(input, 'modelId')
    const hasBaseURL = Object.prototype.hasOwnProperty.call(input, 'baseURL')
    const hasAllowedOverrideProviders = Object.prototype.hasOwnProperty.call(input, 'allowedOverrideProviders')
    const hasAllowedOverrideModels = Object.prototype.hasOwnProperty.call(input, 'allowedOverrideModelsByProvider')

    return this.em.transactional(async (tx) => {
      const existing = await tx.findOne(AiAgentRuntimeOverride, {
        tenantId: ctx.tenantId,
        organizationId: orgFilter,
        agentId: agentIdFilter,
        deletedAt: null,
      } as any)

      if (existing) {
        if (hasProviderId) existing.providerId = normalizedProviderId
        if (hasModelId) existing.modelId = input.modelId ?? null
        if (hasBaseURL) existing.baseUrl = input.baseURL ?? null
        if (hasAllowedOverrideProviders) {
          existing.allowedOverrideProviders = input.allowedOverrideProviders ?? null
        }
        if (hasAllowedOverrideModels) {
          existing.allowedOverrideModelsByProvider = input.allowedOverrideModelsByProvider ?? {}
        }
        existing.updatedByUserId = ctx.userId ?? null
        existing.updatedAt = new Date()
        await tx.persist(existing).flush()
        return existing
      }

      const row = tx.create(AiAgentRuntimeOverride, {
        tenantId: ctx.tenantId,
        organizationId: orgFilter,
        agentId: agentIdFilter,
        providerId: hasProviderId ? normalizedProviderId : null,
        modelId: hasModelId ? (input.modelId ?? null) : null,
        baseUrl: hasBaseURL ? (input.baseURL ?? null) : null,
        allowedOverrideProviders: hasAllowedOverrideProviders
          ? (input.allowedOverrideProviders ?? null)
          : null,
        allowedOverrideModelsByProvider: hasAllowedOverrideModels
          ? (input.allowedOverrideModelsByProvider ?? {})
          : {},
        updatedByUserId: ctx.userId ?? null,
      } as unknown as AiAgentRuntimeOverride)
      await tx.persist(row).flush()
      return row
    })
  }

  /**
   * Soft-deletes the active override matching the given context by setting
   * `deleted_at = now()`. Returns true when a row was found and cleared,
   * false when no active row existed.
   */
  async clearDefault(ctx: {
    tenantId: string
    organizationId?: string | null
    agentId?: string | null
  }): Promise<boolean> {
    if (!ctx?.tenantId) return false

    const orgFilter = ctx.organizationId ?? null
    const agentIdFilter = ctx.agentId ?? null

    return this.em.transactional(async (tx) => {
      const existing = await tx.findOne(AiAgentRuntimeOverride, {
        tenantId: ctx.tenantId,
        organizationId: orgFilter,
        agentId: agentIdFilter,
        deletedAt: null,
      } as any)
      if (!existing) return false
      if (
        existing.allowedOverrideProviders != null ||
        Object.keys(existing.allowedOverrideModelsByProvider ?? {}).length > 0
      ) {
        existing.providerId = null
        existing.modelId = null
        existing.baseUrl = null
        existing.updatedAt = new Date()
        await tx.persist(existing).flush()
        return true
      }
      existing.deletedAt = new Date()
      await tx.persist(existing).flush()
      return true
    })
  }
}

/**
 * Thrown by `upsertDefault` when an unknown provider id is submitted.
 */
export class AiAgentRuntimeOverrideValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiAgentRuntimeOverrideValidationError'
  }
}

export default AiAgentRuntimeOverrideRepository
