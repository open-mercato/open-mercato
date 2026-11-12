/** @jest-environment node */
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { invokeAgentConfigSchema } from '@open-mercato/core/modules/workflows/data/activity-config-schemas'
import { resolveAgentOutcomeHandling } from '@open-mercato/core/modules/workflows/lib/outcome-routing'
import { buildNdaReviewCorrelationKey, buildNdaReviewWorkflowSeed } from '../lib/ndaReviewWorkflow'
import { mergeNdaReviewCommandIds } from '../lib/seeds'
import {
  DOCUMENT_FINDING_INGEST_COMMAND_ID,
  LEGAL_MATTER_RELEASE_COMMAND_ID,
  NDA_REVIEWER_AGENT_ID,
} from '../lib/constants'

type ActivityLike = { activityType: string; config: Record<string, unknown> }
type TransitionLike = { transitionId: string; activities?: ActivityLike[] }

describe('NDA review workflow definition', () => {
  const seed = buildNdaReviewWorkflowSeed()

  it('passes the workflows definition schema', () => {
    const parsed = workflowDefinitionDataSchema.safeParse(seed.definition)
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2))
    expect(parsed.success).toBe(true)
  })

  it('invokes the NDA reviewer and maps its data into context.review', () => {
    const step = seed.definition.steps.find((candidate) => candidate.stepId === 'ai_review')
    const activity = step?.activities?.[0]
    expect(activity?.activityType).toBe('INVOKE_AGENT')
    const config = invokeAgentConfigSchema.parse(activity?.config)
    expect(config.agentId).toBe(NDA_REVIEWER_AGENT_ID)
    expect(config.outputMapping).toEqual({ review: 'data' })
  })

  it('ingests the whole findings array as one template value', () => {
    const transition = (seed.definition.transitions as TransitionLike[]).find(
      (candidate) => candidate.transitionId === 'review-researched',
    )
    const ingest = transition?.activities?.[0]
    expect(ingest?.config.commandId).toBe(DOCUMENT_FINDING_INGEST_COMMAND_ID)
    expect((ingest?.config.input as Record<string, unknown>).findings).toBe('{{context.review.findings}}')
  })

  it('routes researcher, error and guardrail outcomes explicitly', () => {
    const researcher = resolveAgentOutcomeHandling(seed.definition, 'ai_review', 'researcher')
    const failed = resolveAgentOutcomeHandling(seed.definition, 'ai_review', 'error')
    const blocked = resolveAgentOutcomeHandling(seed.definition, 'ai_review', 'guardrailBlocked')
    expect(researcher.kind === 'route' && researcher.transition.toStepId).toBe('await_clearance')
    expect(failed.kind === 'route' && failed.transition.toStepId).toBe('manual_review')
    expect(blocked.kind === 'route' && blocked.transition.toStepId).toBe('manual_review')
  })

  it('releases the matter through the workflow-safe release command', () => {
    const step = seed.definition.steps.find((candidate) => candidate.stepId === 'release')
    const activity = step?.activities?.[0] as ActivityLike | undefined
    expect(activity?.activityType).toBe('UPDATE_ENTITY')
    expect(activity?.config.commandId).toBe(LEGAL_MATTER_RELEASE_COMMAND_ID)
  })

  it('uses a per-document correlation key', () => {
    expect(buildNdaReviewCorrelationKey('doc-1')).toBe('legal_review:doc-1')
  })
})

describe('NDA review command enablement', () => {
  it('keeps the grandfathered commands when the tenant never saved the setting', () => {
    expect(mergeNdaReviewCommandIds(null, ['sales.orders.update'])).toEqual([
      'sales.orders.update',
      DOCUMENT_FINDING_INGEST_COMMAND_ID,
      LEGAL_MATTER_RELEASE_COMMAND_ID,
    ])
  })

  it('keeps the tenant choices and adds the missing commands once', () => {
    expect(mergeNdaReviewCommandIds([DOCUMENT_FINDING_INGEST_COMMAND_ID, 'customers.deals.update'], ['sales.orders.update'])).toEqual([
      DOCUMENT_FINDING_INGEST_COMMAND_ID,
      'customers.deals.update',
      LEGAL_MATTER_RELEASE_COMMAND_ID,
    ])
  })
})
