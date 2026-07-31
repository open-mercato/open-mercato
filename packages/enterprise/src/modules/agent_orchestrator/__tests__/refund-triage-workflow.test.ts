import * as fs from 'fs'
import * as path from 'path'
import {
  invokeAgentConfigSchema,
  workflowDefinitionDataSchema,
} from '@open-mercato/core/modules/workflows/data/validators'
import { AGENT_OUTCOME_KINDS } from '@open-mercato/core/modules/workflows/lib/outcome-routing'

// Validates the refund-triage seed workflow (enterprise-only, INVOKE_AGENT):
//  - the whole definition parses against the engine's workflowDefinitionDataSchema;
//  - the INVOKE_AGENT activity lives on the AUTOMATED `assess` STEP with a valid
//    config (retry policy + human-review SLA + auto-approve threshold);
//  - `assess` parks/resumes on agent_orchestrator.proposal.ready and falls back to
//    the failure queue on a genuine agent error;
//  - the three business/governance branches are wired as spec §7.2 OUTCOME routes
//    (approved / rejected / guardrailBlocked), each a distinct, known outcome kind.
const workflowJson = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'examples', 'refund-triage-workflow.json'),
    'utf8',
  ),
) as {
  workflowId: string
  definition: {
    steps: Array<Record<string, any>>
    transitions: Array<Record<string, any>>
  }
}

const stepById = (id: string) =>
  workflowJson.definition.steps.find((step) => step.stepId === id)
const transitionById = (id: string) =>
  workflowJson.definition.transitions.find((transition) => transition.transitionId === id)

describe('refund-triage seed workflow definition', () => {
  it('stamps the stable workflowId', () => {
    expect(workflowJson.workflowId).toBe('agent_orchestrator_refund_triage_v1')
  })

  it('parses cleanly against workflowDefinitionDataSchema', () => {
    const parsed = workflowDefinitionDataSchema.safeParse(workflowJson.definition)
    if (!parsed.success) {
      throw new Error(
        `definition failed schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      )
    }
    expect(parsed.success).toBe(true)
  })

  it('puts a valid INVOKE_AGENT activity (retry + review) on the AUTOMATED assess step', () => {
    const assess = stepById('assess')
    expect(assess?.stepType).toBe('AUTOMATED')
    const invoke = (assess?.activities ?? []).find(
      (activity: Record<string, any>) => activity.activityType === 'INVOKE_AGENT',
    )
    expect(invoke).toBeTruthy()
    expect(invoke.retryPolicy?.maxAttempts).toBe(3)

    const parsed = invokeAgentConfigSchema.safeParse(invoke.config)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.agentId).toBe('support.refund_assessor')
      expect(parsed.data.onResult).toEqual({ autoApproveThreshold: 0.85 })
      expect(parsed.data.review?.assignedToRoles).toEqual(['support_lead'])
      expect(parsed.data.review?.onBreach).toEqual({ action: 'reassign', reassignTo: 'refund_manager' })
    }
  })

  it('parks/resumes on proposal.ready and falls back to the failure queue on error', () => {
    const assess = stepById('assess')
    expect(assess?.signalConfig?.signalName).toBe('agent_orchestrator.proposal.ready')
    expect(assess?.errorDirective).toEqual({ mode: 'failureQueue' })
  })

  it('wires approved / rejected / guardrailBlocked as distinct §7.2 outcome routes', () => {
    const routes = [
      { id: 't_approved', outcome: 'approved', to: 'issue_refund' },
      { id: 't_rejected', outcome: 'rejected', to: 'notify_declined' },
      { id: 't_guardrail', outcome: 'guardrailBlocked', to: 'compliance_review' },
    ]
    for (const route of routes) {
      const transition = transitionById(route.id)
      expect(transition?.fromStepId).toBe('assess')
      expect(transition?.toStepId).toBe(route.to)
      expect(transition?.kind).toBe('outcome')
      expect(transition?.outcomeKind).toBe(route.outcome)
      expect(AGENT_OUTCOME_KINDS).toContain(transition?.outcomeKind)
    }
    const outcomeKinds = workflowJson.definition.transitions
      .filter((transition) => transition.kind === 'outcome')
      .map((transition) => transition.outcomeKind)
    expect(new Set(outcomeKinds).size).toBe(outcomeKinds.length)
  })

  it('sends the guardrail-blocked path to a human compliance task', () => {
    const review = stepById('compliance_review')
    expect(review?.stepType).toBe('USER_TASK')
    expect(review?.userTaskConfig?.assignedToRoles).toEqual(['compliance'])
  })
})
