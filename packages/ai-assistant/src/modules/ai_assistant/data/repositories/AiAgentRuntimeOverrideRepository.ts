import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { canonicalProviderId } from '../../lib/model-allowlist'
import { AiAgentRuntimeOverride } from '../entities'
import type { AiAgentLoopStopCondition } from '../../lib/ai-agent-definition'

export interface AiAgentRuntimeOverrideContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface AiAgentRuntimeOverrideLoopInput {
  /** Kill switch — when true, runtime forces stepCountIs(1). */
  loopDisabled?: boolean | null
  /** Override loop.maxSteps. */
  loopMaxSteps?: number | null
  /** Override loop.budget.maxToolCalls. */
  loopMaxToolCalls?: number | null
  /** Override loop.budget.maxWallClockMs. */
  loopMaxWallClockMs?: number | null
  /** Override loop.budget.maxTokens. */
  loopMaxTokens?: number | null
  /** Override loop.stopWhen — JSON-safe variants only (stepCount, hasToolCall). */
  loopStopWhenJson?: AiAgentLoopStopCondition[] | null
  /** Override loop.activeTools — must be a subset of agent.allowedTools. */
  loopActiveToolsJson?: string[] | null
}

export interface AiAgentRuntimeOverrideInput extends AiAgentRuntimeOverrideLoopInput {
  /** null means tenant-wide default (no agent pinning). */
  agentId?: string | null
  providerId?: string | null
  modelId?: string | null
  baseURL?: string | null
  allowedOverrideProviders?: string[] | null
  allowedOverrideModelsByProvider?: Record<string, string[]>
  /**
   * Optional: the agent's declared allowedTools. When provided, loopActiveToolsJson
   * is validated to be a subset. When omitted, allowlist validation is skipped
   * (write-time defense only; the runtime re-validates at read time).
   */
  agentAllowedTools?: string[]
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
      } satisfies FilterQuery<AiAgentRuntimeOverride>)
      if (agentRow) return agentRow
    }

    // Fall back to tenant-wide row (agentId = null).
    const tenantRow = await this.em.findOne(AiAgentRuntimeOverride, {
      tenantId: ctx.tenantId,
      organizationId: orgFilter,
      agentId: null,
      deletedAt: null,
    } satisfies FilterQuery<AiAgentRuntimeOverride>)
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
    } satisfies FilterQuery<AiAgentRuntimeOverride>)
    return row ?? null
  }

  /**
   * Validates and normalizes the loop override fields from an input object.
   * Throws `AiAgentRuntimeOverrideValidationError` with code
   * `invalid_loop_override` for any validation failure.
   *
   * Validation rules (Phase 3 — R5 mitigation):
   * - `loopStopWhenJson`: all items must have kind `stepCount` or `hasToolCall`.
   *   Items with kind `custom` are rejected — they cannot be stored as JSON.
   * - `loopActiveToolsJson`: when `agentAllowedTools` is provided, every entry
   *   must be in that allowlist.
   */
  private validateLoopInput(input: AiAgentRuntimeOverrideInput): void {
    if (input.loopStopWhenJson != null) {
      if (!Array.isArray(input.loopStopWhenJson)) {
        throw new AiAgentRuntimeOverrideValidationError(
          'loopStopWhenJson must be an array of stop condition objects.',
          'invalid_loop_override',
        )
      }
      for (const item of input.loopStopWhenJson) {
        if (!item || typeof item !== 'object' || !('kind' in item)) {
          throw new AiAgentRuntimeOverrideValidationError(
            'loopStopWhenJson items must have a "kind" field.',
            'invalid_loop_override',
          )
        }
        const kind = (item as AiAgentLoopStopCondition).kind
        if (kind === 'custom') {
          throw new AiAgentRuntimeOverrideValidationError(
            'loopStopWhenJson does not support kind "custom" — only "stepCount" and "hasToolCall" are JSON-safe and storable.',
            'invalid_loop_override',
          )
        }
        if (kind !== 'stepCount' && kind !== 'hasToolCall') {
          throw new AiAgentRuntimeOverrideValidationError(
            `loopStopWhenJson contains unknown kind "${String(kind)}". Allowed: "stepCount", "hasToolCall".`,
            'invalid_loop_override',
          )
        }
        if (kind === 'stepCount' && typeof (item as { count?: unknown }).count !== 'number') {
          throw new AiAgentRuntimeOverrideValidationError(
            'loopStopWhenJson stepCount item must have a numeric "count" field.',
            'invalid_loop_override',
          )
        }
        if (kind === 'hasToolCall' && typeof (item as { toolName?: unknown }).toolName !== 'string') {
          throw new AiAgentRuntimeOverrideValidationError(
            'loopStopWhenJson hasToolCall item must have a string "toolName" field.',
            'invalid_loop_override',
          )
        }
      }
    }

    if (input.loopActiveToolsJson != null) {
      if (!Array.isArray(input.loopActiveToolsJson)) {
        throw new AiAgentRuntimeOverrideValidationError(
          'loopActiveToolsJson must be an array of tool name strings.',
          'invalid_loop_override',
        )
      }
      for (const name of input.loopActiveToolsJson) {
        if (typeof name !== 'string' || name.length === 0) {
          throw new AiAgentRuntimeOverrideValidationError(
            'loopActiveToolsJson entries must be non-empty strings.',
            'invalid_loop_override',
          )
        }
      }
      if (input.agentAllowedTools && input.agentAllowedTools.length > 0) {
        const outsideAllowlist = input.loopActiveToolsJson.filter(
          (name) => !input.agentAllowedTools!.includes(name),
        )
        if (outsideAllowlist.length > 0) {
          throw new AiAgentRuntimeOverrideValidationError(
            `loopActiveToolsJson contains tools outside the agent's allowedTools: ${outsideAllowlist.join(', ')}.`,
            'invalid_loop_override',
          )
        }
      }
    }
  }

  /**
   * Inserts or updates the runtime override for the given context.
   *
   * Validates `providerId` against the registry at write time so an admin
   * cannot save a typo (Phase 1.4 contract re-applied per spec §Data Models).
   * An unknown provider id throws a typed error.
   *
   * Also validates loop override fields (R5 mitigation — Phase 3):
   * - `loopStopWhenJson` items must use only JSON-safe kinds.
   * - `loopActiveToolsJson` items must be a subset of `agentAllowedTools`
   *   when that is provided.
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

    this.validateLoopInput(input)

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
      } satisfies FilterQuery<AiAgentRuntimeOverride>)

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
        if ('loopDisabled' in input) existing.loopDisabled = input.loopDisabled ?? null
        if ('loopMaxSteps' in input) existing.loopMaxSteps = input.loopMaxSteps ?? null
        if ('loopMaxToolCalls' in input) existing.loopMaxToolCalls = input.loopMaxToolCalls ?? null
        if ('loopMaxWallClockMs' in input) existing.loopMaxWallClockMs = input.loopMaxWallClockMs ?? null
        if ('loopMaxTokens' in input) existing.loopMaxTokens = input.loopMaxTokens ?? null
        if ('loopStopWhenJson' in input) existing.loopStopWhenJson = input.loopStopWhenJson ?? null
        if ('loopActiveToolsJson' in input) existing.loopActiveToolsJson = input.loopActiveToolsJson ?? null
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
        loopDisabled: input.loopDisabled ?? null,
        loopMaxSteps: input.loopMaxSteps ?? null,
        loopMaxToolCalls: input.loopMaxToolCalls ?? null,
        loopMaxWallClockMs: input.loopMaxWallClockMs ?? null,
        loopMaxTokens: input.loopMaxTokens ?? null,
        loopStopWhenJson: input.loopStopWhenJson ?? null,
        loopActiveToolsJson: input.loopActiveToolsJson ?? null,
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
      } satisfies FilterQuery<AiAgentRuntimeOverride>)
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
 * Thrown by `upsertDefault` when validation fails (unknown provider id,
 * invalid loop override JSON).
 */
export class AiAgentRuntimeOverrideValidationError extends Error {
  readonly code: string

  constructor(message: string, code = 'invalid_override') {
    super(message)
    this.name = 'AiAgentRuntimeOverrideValidationError'
    this.code = code
  }
}

export default AiAgentRuntimeOverrideRepository
