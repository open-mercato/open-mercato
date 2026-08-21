import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AgentModelUsage } from '../../data/entities'

const logger = createLogger('agent_orchestrator').child({ component: 'model-usage' })

const providerComplianceSchema = z.record(
  z.string(),
  z.object({
    location: z.string().min(1).max(200).optional(),
    retention: z.string().min(1).max(500).optional(),
  }),
)

export type AgentModelUsageRecordInput = {
  tenantId: string
  organizationId: string
  agentRunId: string
  agentId: string
  runtime: string
  providerId: string
  modelId: string
}

export type AgentModelUsageRegistryItem = {
  providerId: string
  modelId: string
  dataLocation: string
  retentionPolicy: string
  runCount: number
  firstUsedAt: string
  lastUsedAt: string
}

type RegistryRow = {
  providerId: string
  modelId: string
  dataLocation: string | null
  retentionPolicy: string | null
  runCount: number | string
  firstUsedAt: Date | string
  lastUsedAt: Date | string
}

export function resolveProviderComplianceMetadata(
  providerId: string,
  rawConfig = process.env.OM_AI_PROVIDER_COMPLIANCE_JSON,
): { dataLocation: string | null; retentionPolicy: string | null } {
  if (!rawConfig?.trim()) return { dataLocation: null, retentionPolicy: null }
  try {
    const parsed = providerComplianceSchema.safeParse(JSON.parse(rawConfig))
    if (!parsed.success) {
      logger.warn('provider compliance metadata failed validation')
      return { dataLocation: null, retentionPolicy: null }
    }
    const metadata = parsed.data[providerId]
    return {
      dataLocation: metadata?.location ?? null,
      retentionPolicy: metadata?.retention ?? null,
    }
  } catch {
    logger.warn('provider compliance metadata is not valid JSON')
    return { dataLocation: null, retentionPolicy: null }
  }
}

export class AgentModelUsageService {
  constructor(private readonly em: EntityManager) {}

  async record(input: AgentModelUsageRecordInput): Promise<void> {
    const em = this.em.fork()
    const existing = await em.findOne(AgentModelUsage, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      agentRunId: input.agentRunId,
      providerId: input.providerId,
      modelId: input.modelId,
    })
    if (existing) return
    const metadata = resolveProviderComplianceMetadata(input.providerId)
    em.persist(em.create(AgentModelUsage, {
      ...input,
      dataLocation: metadata.dataLocation,
      retentionPolicy: metadata.retentionPolicy,
    }))
    await em.flush()
  }

  async registry(scope: { tenantId: string; organizationId: string }): Promise<AgentModelUsageRegistryItem[]> {
    const rows = await this.em.getConnection().execute<RegistryRow[]>(
      `select
        provider_id as "providerId",
        model_id as "modelId",
        data_location as "dataLocation",
        retention_policy as "retentionPolicy",
        count(*)::int as "runCount",
        min(created_at) as "firstUsedAt",
        max(created_at) as "lastUsedAt"
      from agent_model_usages
      where tenant_id = ? and organization_id = ?
      group by provider_id, model_id, data_location, retention_policy
      order by max(created_at) desc, provider_id asc, model_id asc`,
      [scope.tenantId, scope.organizationId],
    )
    return rows.map((row) => ({
      providerId: row.providerId,
      modelId: row.modelId,
      dataLocation: row.dataLocation ?? 'not_configured',
      retentionPolicy: row.retentionPolicy ?? 'not_configured',
      runCount: Number(row.runCount),
      firstUsedAt: new Date(row.firstUsedAt).toISOString(),
      lastUsedAt: new Date(row.lastUsedAt).toISOString(),
    }))
  }
}
