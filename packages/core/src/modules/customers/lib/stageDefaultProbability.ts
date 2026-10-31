import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerPipeline, CustomerPipelineStage } from '../data/entities'

/**
 * Effective default probability of a pipeline stage: the stage's `defaultProbability`
 * when its pipeline opted into `stageProbabilitiesEnabled`, otherwise `null`.
 * See `.ai/specs/2026-10-22-pipeline-stage-default-probabilities.md`.
 */
export async function resolveStageDefaultProbability(
  em: EntityManager,
  input: { stageId: string; tenantId: string; organizationId: string },
): Promise<number | null> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const stage = await findOneWithDecryption(em, CustomerPipelineStage, { id: input.stageId, ...scope }, {}, scope)
  if (!stage || stage.defaultProbability === null || stage.defaultProbability === undefined) return null
  const pipeline = await findOneWithDecryption(em, CustomerPipeline, { id: stage.pipelineId, ...scope }, {}, scope)
  if (!pipeline?.stageProbabilitiesEnabled) return null
  return stage.defaultProbability
}
