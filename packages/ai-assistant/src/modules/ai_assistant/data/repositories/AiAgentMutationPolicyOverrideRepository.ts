import type { EntityManager } from '@mikro-orm/postgresql'
import {
  findOneWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { AiAgentMutationPolicyOverride } from '../entities'
import type { AiAgentMutationPolicy } from '../../lib/ai-agent-definition'

export interface AiAgentMutationPolicyOverrideContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface AiAgentMutationPolicyOverrideInput {
  agentId: string
  mutationPolicy: AiAgentMutationPolicy
  notes?: string | null
}

/**
 * Single-value mutation-policy override repository (Step 5.4).
 *
 * Unlike the versioned prompt override, there is ONE current mutation-policy
 * override per `(tenantId, organizationId, agentId)`. `set()` replaces the
 * existing row (or inserts a new one) inside a transaction so concurrent
 * writers cannot produce ghost rows. `clear()` deletes the row so the runtime
 * falls back to the code-declared policy.
 *
 * Reads always go through `findOneWithDecryption` to stay consistent with the
 * rest of the module even though `mutation_policy` isn't encrypted today.
 */
export class AiAgentMutationPolicyOverrideRepository {
  constructor(private readonly em: EntityManager) {}

  async get(
    agentId: string,
    ctx: AiAgentMutationPolicyOverrideContext,
  ): Promise<AiAgentMutationPolicyOverride | null> {
    if (!agentId || !ctx?.tenantId) return null
    const row = await findOneWithDecryption<AiAgentMutationPolicyOverride>(
      this.em,
      AiAgentMutationPolicyOverride,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId,
      } as any,
      {},
      { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
    )
    return row ?? null
  }

  async set(
    input: AiAgentMutationPolicyOverrideInput,
    ctx: AiAgentMutationPolicyOverrideContext,
  ): Promise<AiAgentMutationPolicyOverride> {
    if (!ctx?.tenantId) {
      throw new Error('AiAgentMutationPolicyOverrideRepository.set requires tenantId')
    }
    if (!input?.agentId) {
      throw new Error('AiAgentMutationPolicyOverrideRepository.set requires agentId')
    }
    const normalized = normalizeNotes(input.notes)
    return this.em.transactional(async (tx) => {
      const existing = await findOneWithDecryption<AiAgentMutationPolicyOverride>(
        tx as unknown as EntityManager,
        AiAgentMutationPolicyOverride,
        {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
          agentId: input.agentId,
        } as any,
        {},
        { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
      )
      if (existing) {
        existing.mutationPolicy = input.mutationPolicy
        existing.notes = normalized
        existing.createdByUserId = ctx.userId ?? existing.createdByUserId ?? null
        existing.updatedAt = new Date()
        await tx.persist(existing).flush()
        return existing
      }
      const row = tx.create(AiAgentMutationPolicyOverride, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId: input.agentId,
        mutationPolicy: input.mutationPolicy,
        notes: normalized,
        createdByUserId: ctx.userId ?? null,
      } as unknown as AiAgentMutationPolicyOverride)
      await tx.persist(row).flush()
      return row
    })
  }

  async clear(
    agentId: string,
    ctx: AiAgentMutationPolicyOverrideContext,
  ): Promise<boolean> {
    if (!agentId || !ctx?.tenantId) return false
    return this.em.transactional(async (tx) => {
      const existing = await findOneWithDecryption<AiAgentMutationPolicyOverride>(
        tx as unknown as EntityManager,
        AiAgentMutationPolicyOverride,
        {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
          agentId,
        } as any,
        {},
        { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
      )
      if (!existing) return false
      await tx.remove(existing).flush()
      return true
    })
  }
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (typeof notes !== 'string') return null
  const trimmed = notes.trim()
  if (!trimmed) return null
  return notes
}

export default AiAgentMutationPolicyOverrideRepository
