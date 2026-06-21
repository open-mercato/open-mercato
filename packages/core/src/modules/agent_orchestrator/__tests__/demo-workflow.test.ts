import * as fs from 'fs'
import * as path from 'path'
import { evaluateExpression } from '../../business_rules/lib/expression-evaluator'
import { invokeAgentConfigSchema } from '../../workflows/data/validators'

// Validates the demo workflow definition the runbook depends on:
//  - the INVOKE_AGENT activity lives on the AUTOMATED `assess` STEP (not a
//    transition) and matches the engine's INVOKE_AGENT config contract;
//  - `assess` carries signalConfig so the human path can park/resume on
//    agent_orchestrator.proposal.ready;
//  - the effector transition is GUARDED on the top-level `disposition` using the
//    real ConditionExpression format the workflows engine evaluates.
const workflowJson = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'examples', 'deals-health-check-workflow.json'),
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

describe('deals-health-check demo workflow definition', () => {
  it('stamps the stable workflowId', () => {
    expect(workflowJson.workflowId).toBe('agent_orchestrator_deals_health_check_v1')
  })

  it('puts the INVOKE_AGENT activity on the AUTOMATED assess step with a valid config', () => {
    const assess = stepById('assess')
    expect(assess?.stepType).toBe('AUTOMATED')
    const invoke = (assess?.activities ?? []).find(
      (activity: Record<string, any>) => activity.activityType === 'INVOKE_AGENT',
    )
    expect(invoke).toBeTruthy()
    const parsed = invokeAgentConfigSchema.safeParse(invoke.config)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.agentId).toBe('deals.health_check')
      expect(parsed.data.onResult).toEqual({ autoApproveThreshold: 0.8 })
    }
  })

  it('declares signalConfig on assess so the human path parks/resumes on proposal.ready', () => {
    expect(stepById('assess')?.signalConfig?.signalName).toBe(
      'agent_orchestrator.proposal.ready',
    )
  })

  it('routes approved/auto-approved/edited dispositions to the effector and rejected to end', () => {
    const apply = transitionById('t_assess_apply')
    const reject = transitionById('t_assess_reject')
    expect(apply?.toStepId).toBe('apply')
    expect(reject?.toStepId).toBe('end')

    const ctx = {}
    const passes = (disposition: string, condition: any) =>
      evaluateExpression(condition, { disposition }, ctx)

    // approve path (auto path sets `disposition` top-level via the step handler;
    // human path merges it via the resume signal payload).
    for (const disposition of ['auto_approved', 'approved', 'edited']) {
      expect(passes(disposition, apply!.condition)).toBe(true)
      expect(passes(disposition, reject!.condition)).toBe(false)
    }
    // reject path skips the effector.
    expect(passes('rejected', apply!.condition)).toBe(false)
    expect(passes('rejected', reject!.condition)).toBe(true)
  })

  it('applies the approved stage via the audited customers command (no raw write)', () => {
    const apply = stepById('apply')
    const effector = (apply?.activities ?? []).find(
      (activity: Record<string, any>) => activity.activityType === 'UPDATE_ENTITY',
    )
    expect(effector?.config?.commandId).toBe('customers.deals.update')
    expect(effector?.config?.input?.id).toBe('{{deal.id}}')
  })
})
