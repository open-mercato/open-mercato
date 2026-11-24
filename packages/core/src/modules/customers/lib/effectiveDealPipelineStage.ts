import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerPipelineStage, type CustomerDeal } from '../data/entities'

function normalizeStageLabel(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export async function resolveEffectivePipelineStage(
  em: EntityManager,
  deal: CustomerDeal,
  decryptionScope: { tenantId: string | null; organizationId: string | null },
): Promise<CustomerPipelineStage | null> {
  if (deal.pipelineStageId) {
    const exactStage = await findOneWithDecryption(
      em,
      CustomerPipelineStage,
      {
        id: deal.pipelineStageId,
        organizationId: deal.organizationId,
        tenantId: deal.tenantId,
      },
      {},
      decryptionScope,
    )
    if (exactStage) return exactStage
  }

  const normalizedStageLabel = normalizeStageLabel(deal.pipelineStage)
  if (!normalizedStageLabel) return null

  const scopedStages = await findWithDecryption(
    em,
    CustomerPipelineStage,
    {
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
      ...(deal.pipelineId ? { pipelineId: deal.pipelineId } : {}),
    },
    { orderBy: { order: 'ASC' } },
    decryptionScope,
  )

  const matchingStages = scopedStages.filter((stage) => normalizeStageLabel(stage.label) === normalizedStageLabel)
  if (matchingStages.length === 1) return matchingStages[0] ?? null
  if (matchingStages.length > 1) {
    const distinctPipelineIds = new Set(matchingStages.map((stage) => stage.pipelineId))
    if (distinctPipelineIds.size === 1) return matchingStages[0] ?? null
  }
  return null
}
