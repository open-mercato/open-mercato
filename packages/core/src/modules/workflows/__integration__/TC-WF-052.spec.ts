import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  buildAgentOutcomeDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-052 [P0] (API): a guardrail block takes the guardrail route instead of
 * hard-failing the instance.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §7.3 — "a guardrail
 * `block` routes the `guardrail blocked` handle … `agent_orchestrator.guardrail.tripped`
 * finally gets a governed landing path". Before this change the activity
 * worker's catch treated a block as an infra failure and FAILED the run.
 *
 * Surfaces under test:
 * - POST /api/workflows/instances/[id]/signal (the resume carrying the block)
 * - GET  /api/workflows/instances/[id]        (where the run actually landed)
 *
 * The fixture parks on the proposal-ready signal for the reason spelled out in
 * TC-WF-051: the agent runtime is an optional enterprise peer, so this asserts
 * the ROUTING half — which is what this change owns — on the real code path. The
 * runtime half (recognising `AgentGuardrailBlockedError` structurally, and
 * resuming rather than fail-stopping only when a guardrail route is wired) is
 * unit-covered in `lib/__tests__/guardrail-routing.test.ts`.
 */

const SIGNAL_NAME = 'agent_orchestrator.proposal.ready'

test.describe('TC-WF-052: a guardrail block takes the guardrail route', () => {
  test('a blocked run lands on the guardrail target instead of FAILED', async ({ request }) => {
    test.setTimeout(90_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildAgentOutcomeDefinitionPayload(stamp, SIGNAL_NAME)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        correlationKey: `qa-guardrail-${stamp}`,
      })

      const parked = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'PAUSED' && instance.currentStepId === 'agent',
      )
      expect(parked?.currentStepId, 'the agent step parks awaiting a disposition').toBe('agent')

      const blockSignal = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`,
        { token, data: { signalName: SIGNAL_NAME, payload: { disposition: 'guardrail_blocked' } } },
      )
      expect(blockSignal.status(), 'the guardrail-block resume is accepted').toBe(200)

      const final = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
      )

      expect(final?.status, 'a guardrail block is a governed outcome, not a failure').toBe('COMPLETED')
      expect(
        final?.currentStepId,
        'the block lands on the guardrail route target, not on the happy path',
      ).toBe('guardrail_end')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
