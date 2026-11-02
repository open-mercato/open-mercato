export type DealDuplicateSource = {
  pipelineId?: string | null
  pipelineStageId?: string | null
  valueAmount?: number | null
  valueCurrency?: string | null
  probability?: number | null
  expectedCloseAt?: string | null
  ownerUserId?: string | null
}

/**
 * Builds the `POST /api/customers/deals` body that creates a copy of an existing deal.
 *
 * Shared by the deals list row actions and the kanban card menu so both "Duplicate"
 * entry points copy the same fields. The copy always starts `open`; the unassigned kanban
 * lane sentinel is never forwarded as a stage id. `title` is supplied by the caller because
 * the page owns translation of the "(copy)" suffix.
 */
export function buildDealDuplicatePayload(
  source: DealDuplicateSource,
  title: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { title, status: 'open' }
  if (source.pipelineId) payload.pipelineId = source.pipelineId
  if (source.pipelineStageId && source.pipelineStageId !== '__unassigned') {
    payload.pipelineStageId = source.pipelineStageId
  }
  if (typeof source.valueAmount === 'number') payload.valueAmount = source.valueAmount
  if (source.valueCurrency) payload.valueCurrency = source.valueCurrency
  if (typeof source.probability === 'number') payload.probability = source.probability
  if (source.expectedCloseAt) payload.expectedCloseAt = source.expectedCloseAt
  if (source.ownerUserId) payload.ownerUserId = source.ownerUserId
  return payload
}
