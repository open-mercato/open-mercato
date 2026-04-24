import type { EntityManager } from '@mikro-orm/postgresql'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { AiAgentPromptOverride } from '../entities'

export interface AiAgentPromptOverrideContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface AiAgentPromptOverrideInput {
  agentId: string
  sections: Record<string, string>
  notes?: string | null
}

/**
 * Versioned prompt-override repository (Step 5.3).
 *
 * Every write produces a new row with a monotonically-increasing `version`
 * scoped to `(tenantId, organizationId, agentId)`. We allocate the next
 * version inside a transaction so two concurrent writers cannot collide on
 * the same version number.
 *
 * Reads ALWAYS go through `findOneWithDecryption` / `findWithDecryption` —
 * the `sections` column isn't encrypted today, but the repo sticks to the
 * shared encrypted-read helpers so future GDPR-flagged columns are handled
 * automatically.
 */
export class AiAgentPromptOverrideRepository {
  constructor(private readonly em: EntityManager) {}

  async getLatest(
    agentId: string,
    ctx: AiAgentPromptOverrideContext,
  ): Promise<AiAgentPromptOverride | null> {
    if (!agentId || !ctx?.tenantId) return null
    const row = await findOneWithDecryption<AiAgentPromptOverride>(
      this.em,
      AiAgentPromptOverride,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId,
      } as any,
      { orderBy: { version: 'desc' } as any },
      { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
    )
    return row ?? null
  }

  async listVersions(
    agentId: string,
    ctx: AiAgentPromptOverrideContext,
    limit: number = 10,
  ): Promise<AiAgentPromptOverride[]> {
    if (!agentId || !ctx?.tenantId) return []
    const capped = Math.max(1, Math.min(Math.floor(limit), 100))
    const rows = await findWithDecryption<AiAgentPromptOverride>(
      this.em,
      AiAgentPromptOverride,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId,
      } as any,
      {
        orderBy: { version: 'desc' } as any,
        limit: capped,
      },
      { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
    )
    return rows
  }

  async save(
    input: AiAgentPromptOverrideInput,
    ctx: AiAgentPromptOverrideContext,
  ): Promise<AiAgentPromptOverride> {
    if (!ctx?.tenantId) {
      throw new Error('AiAgentPromptOverrideRepository.save requires tenantId')
    }
    if (!input?.agentId) {
      throw new Error('AiAgentPromptOverrideRepository.save requires agentId')
    }
    const sanitizedSections = sanitizeSections(input.sections)
    return this.em.transactional(async (tx) => {
      const latest = await findOneWithDecryption<AiAgentPromptOverride>(
        tx as unknown as EntityManager,
        AiAgentPromptOverride,
        {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
          agentId: input.agentId,
        } as any,
        { orderBy: { version: 'desc' } as any },
        { tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null },
      )
      const nextVersion = (latest?.version ?? 0) + 1
      const row = tx.create(AiAgentPromptOverride, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId: input.agentId,
        version: nextVersion,
        sections: sanitizedSections,
        notes: input.notes ?? null,
        createdByUserId: ctx.userId ?? null,
      } as unknown as AiAgentPromptOverride)
      await tx.persist(row).flush()
      return row
    })
  }
}

function sanitizeSections(
  sections: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!sections || typeof sections !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(sections)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    out[key] = value
  }
  return out
}

export default AiAgentPromptOverrideRepository
