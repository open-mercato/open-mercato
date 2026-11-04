import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerPipelineStage } from '../data/entities'
import { DEFAULT_DEAL_STATUS_VOCABULARY, getDealStatusAliases, canonicalDealStatus, isWonDealStatus, isLostDealStatus, type DealStatusVocabulary } from './dealStatus'

export type DealClosureOutcome = 'won' | 'lost'

export type PipelineStageSnapshot = {
  id: string
  pipelineId: string
  label: string
  order: number
}

// Stage labels that mark a pipeline as terminal for a given closure outcome. Matching is
// label-based because stages are tenant-configurable rows; see #5107.
export const TERMINAL_PIPELINE_STAGE_LABELS: Record<DealClosureOutcome, ReadonlySet<string>> = {
  won: new Set(['won', 'win', 'closed won', 'closed win']),
  lost: new Set(['lost', 'loose', 'closed lost', 'closed loose']),
}

/**
 * Map a deal status spelling (`win`/`lost`, the AI tool's `won`, or the pre-0.7.1
 * `loose`) to its closure
 * outcome. Case-insensitive because callers such as the AI tool pass free-form model
 * text through, while every persisted status is lower-case.
 */
export function dealClosureOutcomeFromStatus(
  status: string | null | undefined,
  vocabulary: DealStatusVocabulary | number = DEFAULT_DEAL_STATUS_VOCABULARY,
): DealClosureOutcome | null {
  const canonical = typeof status === 'string' ? canonicalDealStatus(status.trim(), vocabulary) : status
  if (isWonDealStatus(canonical, vocabulary)) return 'won'
  if (isLostDealStatus(canonical, vocabulary)) return 'lost'
  return null
}

export function normalizePipelineStageLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Resolve the terminal stage of the deal's pipeline for a closure outcome, so every
 * writer (command, AI tool preview) agrees on where a closed deal lands (#5107).
 */
export async function loadClosurePipelineStageSnapshot(
  em: EntityManager,
  input: {
    pipelineId: string | null
    closureOutcome: DealClosureOutcome
    tenantId: string
    organizationId: string
    vocabulary?: DealStatusVocabulary
  },
): Promise<PipelineStageSnapshot | null> {
  if (!input.pipelineId) return null

  const stages = await findWithDecryption(
    em,
    CustomerPipelineStage,
    {
      pipelineId: input.pipelineId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    { orderBy: { order: 'ASC' } },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  const aliases = new Set(getDealStatusAliases(input.vocabulary)[input.closureOutcome].map(normalizePipelineStageLabel).filter(Boolean))
  const stage = stages.find((candidate) => TERMINAL_PIPELINE_STAGE_LABELS[input.closureOutcome].has(normalizePipelineStageLabel(candidate.label)))
    ?? stages.find((candidate) => aliases.has(normalizePipelineStageLabel(candidate.label)))
  if (!stage) return null
  return {
    id: stage.id,
    pipelineId: stage.pipelineId,
    label: stage.label,
    order: stage.order,
  }
}
