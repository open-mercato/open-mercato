export type DealAssociation = {
  id: string
  label: string
  subtitle: string | null
  kind: 'person' | 'company'
  isPrimary?: boolean
}

export type PipelineStageInfo = {
  id: string
  label: string
  order: number
  color: string | null
  icon: string | null
}

export type StageTransitionInfo = {
  stageId: string
  stageLabel: string
  stageOrder: number
  transitionedAt: string
}

export type DealDetailPayload = {
  deal: {
    id: string
    title: string
    description: string | null
    status: string | null
    pipelineStage: string | null
    pipelineId: string | null
    pipelineStageId: string | null
    valueAmount: string | null
    valueCurrency: string | null
    probability: number | null
    expectedCloseAt: string | null
    ownerUserId: string | null
    source: string | null
    closureOutcome: 'won' | 'lost' | null
    lossReasonId: string | null
    lossNotes: string | null
    organizationId: string | null
    tenantId: string | null
    createdAt: string
    updatedAt: string
  }
  people: DealAssociation[]
  companies: DealAssociation[]
  linkedPersonIds: string[]
  linkedCompanyIds: string[]
  counts: {
    people: number
    companies: number
  }
  customFields: Record<string, unknown>
  viewer: {
    userId: string | null
    name: string | null
    email: string | null
  } | null
  pipelineStages: PipelineStageInfo[]
  pipelineName: string | null
  stageTransitions: StageTransitionInfo[]
  owner: { id: string; name: string; email: string } | null
}

export type DealStatsPayload = {
  dealValue: number | null
  dealCurrency: string | null
  closureOutcome: 'won' | 'lost'
  closedAt: string
  pipelineName: string | null
  dealsClosedThisPeriod: number
  salesCycleDays: number | null
  dealRankInQuarter: number | null
  lossReason: string | null
}

export type GuardedMutationRunner = <TResult>(
  operation: () => Promise<TResult>,
  mutationPayload?: Record<string, unknown>,
) => Promise<TResult>
