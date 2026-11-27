import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  cancelWorkflowInstanceIfExists,
  deleteWorkflowDefinitionIfExists,
  getWorkflowInstanceSnapshot,
  listWorkflowInstanceSteps,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  AGENT_RUN_FEATURE,
  GATED_AGENT_ID,
  GATED_AGENT_INPUT,
  INVOKE_DENIED_CODE,
  uniqueStamp,
} from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-ACC-008: a workflow `INVOKE_AGENT` step is denied when the workflow's acting identity may not invoke the agent.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (§A invoker table; Integration: process execution → `INVOKE_AGENT` — a workflow
 * grant lacking the agent feature fails the step with `agent_invoke_denied`).
 *
 * The definition declares `grantedFeatures: ['agent_orchestrator.agents.run']`,
 * so every run acts as the definition's own execution principal — even when the
 * admin starts it — and that principal lacks `agent_orchestrator.agents.view`,
 * which `support.ticket_triage` requires. No model needed: the runtime denies
 * before admission, the invoke-agent job fail-stops the step, and the step
 * records `errorData.code = 'agent_invoke_denied'`. Saving the definition also
 * returns the additive authoring warning `agent_invoke_not_covered`.
 *
 * The invoke-agent job runs on the `workflow-invoke-agent` queue; the spec drains
 * it in-process like the TC-WF agent specs, so it needs the app's DATABASE_URL and
 * queue settings in the runner environment.
 *
 * Model-dependent (not covered): the allowed branch (a covering grant binds the
 * run to the agent principal) executes the agent.
 *
 * Self-contained: creates its own definition and instance; cancels and deletes them in `finally`.
 */

const INVOKE_AGENT_QUEUE = 'workflow-invoke-agent'
const INVOKE_AGENT_SIGNAL = 'agent_orchestrator.proposal.ready'
const AGENT_STEP_ID = 'triage'

type DefinitionCreateBody = {
  data?: { id?: string }
  warnings?: Array<{ code?: string; stepId?: string; agentId?: string }>
}

function buildDeniedInvokeDefinition(stamp: string) {
  const id = `qa-agent-acc-008-${stamp}`
  return {
    workflowId: id,
    workflowName: `QA agent invoke denial ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    grantedFeatures: [AGENT_RUN_FEATURE],
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: AGENT_STEP_ID,
          stepName: 'Triage',
          stepType: 'AUTOMATED',
          signalConfig: { signalName: INVOKE_AGENT_SIGNAL },
          activities: [
            {
              activityId: 'invoke_agent',
              activityName: 'Invoke Agent',
              activityType: 'INVOKE_AGENT',
              config: { agentId: GATED_AGENT_ID, input: GATED_AGENT_INPUT, onResult: { alwaysAsk: true } },
            },
          ],
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-triage', fromStepId: 'start', toStepId: AGENT_STEP_ID, trigger: 'auto' },
        { transitionId: 'triage-to-end', fromStepId: AGENT_STEP_ID, toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  }
}

test.describe('TC-AGENT-ACC-008: workflow INVOKE_AGENT honours the agent invoke permission', () => {
  test('a definition grant lacking the agent feature fails the step with agent_invoke_denied', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      const payload = buildDeniedInvokeDefinition(uniqueStamp())
      const created = await apiRequest(request, 'POST', '/api/workflows/definitions', { token: adminToken, data: payload })
      const createdBody = await readJsonSafe<DefinitionCreateBody>(created)
      expect(created.status(), JSON.stringify(createdBody)).toBe(201)
      definitionId = createdBody?.data?.id ?? null
      expect(definitionId).toBeTruthy()
      expect(createdBody?.warnings).toEqual([
        { code: 'agent_invoke_not_covered', stepId: AGENT_STEP_ID, agentId: GATED_AGENT_ID },
      ])

      instanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: payload.workflowId,
        correlationKey: `qa-agent-acc-008-${Date.now()}`,
      })
      const startedInstanceId = instanceId

      await expect
        .poll(
          async () => {
            await drainIntegrationQueue(INVOKE_AGENT_QUEUE)
            return (await getWorkflowInstanceSnapshot(request, adminToken, startedInstanceId))?.status ?? null
          },
          { timeout: 90_000, intervals: [1_000, 2_000, 3_000], message: 'the denied INVOKE_AGENT step fails the instance' },
        )
        .toBe('FAILED')

      const steps = await listWorkflowInstanceSteps(request, adminToken, startedInstanceId)
      const agentStep = steps.find((step) => step.stepId === AGENT_STEP_ID)
      expect(agentStep?.status).toBe('FAILED')
      expect(agentStep?.errorData?.code).toBe(INVOKE_DENIED_CODE)
      expect(agentStep?.errorData?.agentId).toBe(GATED_AGENT_ID)
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
    }
  })
})
