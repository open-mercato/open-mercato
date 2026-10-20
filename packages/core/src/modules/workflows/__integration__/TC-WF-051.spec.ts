import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
  buildAgentOutcomeDefinitionPayload,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-051 [P0] (API): an agent step routes by DISPOSITION OUTCOME, not by a
 * condition matching a context string.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §7.2 — the spec's own
 * required integration path is "outcome-route dispatch per disposition kind".
 *
 * Surfaces under test:
 * - POST /api/workflows/definitions  (`kind: 'outcome'` + `outcomeKind` persist)
 * - GET  /api/workflows/definitions/[id]  (they survive the read back)
 * - POST /api/workflows/instances/[id]/signal  (the resume that carries the
 *   disposition — the path every dispositioned proposal takes, whether the
 *   activity worker or a human dispose sent it)
 *
 * WHY THE FIXTURE PARKS ON A SIGNAL RATHER THAN RUNNING AN AGENT: the agent
 * runtime lives in `agent_orchestrator`, an OPTIONAL enterprise peer, and
 * `executeInvokeAgent` refuses outright when it is absent. The step under test
 * therefore parks on its signal like a real parked agent step and DECLARES the
 * INVOKE_AGENT activity, which is exactly what the engine keys outcome routing
 * off (`signal-handler`'s `isInvokeAgentStep`). What is asserted here is the
 * ROUTING contract — the part this change owns — on the same code path a real
 * disposition takes. The runtime half is unit-covered in
 * `lib/__tests__/guardrail-routing.test.ts`.
 */

const SIGNAL_NAME = 'agent_orchestrator.proposal.ready'

test.describe('TC-WF-051: agent steps route by disposition outcome', () => {
  test('outcome routes persist through the definition API and dispatch per disposition', async ({ request }) => {
    test.setTimeout(90_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let approvedInstanceId: string | null = null
    let rejectedInstanceId: string | null = null

    try {
      const payload = buildAgentOutcomeDefinitionPayload(stamp, SIGNAL_NAME)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      // 1. The contract survives the round trip. An engine that dropped
      //    `outcomeKind` would leave every route claiming `approved`.
      const readBack = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token },
      )
      expect(readBack.status(), 'the definition reads back').toBe(200)
      const readBody = await readJsonSafe<{
        data?: { definition?: { transitions?: Array<Record<string, unknown>> } }
      }>(readBack)
      const persistedRoutes = (readBody?.data?.definition?.transitions ?? []).filter(
        (transition) => transition.kind === 'outcome',
      )
      expect(persistedRoutes.map((route) => route.outcomeKind).sort()).toEqual([
        'guardrailBlocked',
        'rejected',
      ])

      // 2. A REJECTED disposition takes its own route, not the happy path.
      rejectedInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        correlationKey: `qa-outcome-rejected-${stamp}`,
      })
      const rejectedParked = await pollWorkflowInstance(
        request,
        token,
        rejectedInstanceId,
        (instance) => instance.status === 'PAUSED' && instance.currentStepId === 'agent',
      )
      expect(rejectedParked?.currentStepId, 'the agent step parks awaiting a disposition').toBe('agent')

      const rejectSignal = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(rejectedInstanceId)}/signal`,
        { token, data: { signalName: SIGNAL_NAME, payload: { disposition: 'rejected' } } },
      )
      expect(rejectSignal.status(), 'the disposition signal is accepted').toBe(200)

      const rejectedFinal = await pollWorkflowInstance(
        request,
        token,
        rejectedInstanceId,
        (instance) => instance.status === 'COMPLETED',
      )
      expect(
        rejectedFinal?.currentStepId,
        'a rejected proposal lands on the rejected route target, never on the apply step',
      ).toBe('rejected_end')

      // 3. An APPROVED disposition stays on the node's ordinary output — §7.2
      //    renders `approved` unconditionally precisely because it IS that.
      approvedInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        correlationKey: `qa-outcome-approved-${stamp}`,
      })
      await pollWorkflowInstance(
        request,
        token,
        approvedInstanceId,
        (instance) => instance.status === 'PAUSED' && instance.currentStepId === 'agent',
      )

      const approveSignal = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(approvedInstanceId)}/signal`,
        { token, data: { signalName: SIGNAL_NAME, payload: { disposition: 'auto_approved' } } },
      )
      expect(approveSignal.status(), 'the approval signal is accepted').toBe(200)

      const approvedFinal = await pollWorkflowInstance(
        request,
        token,
        approvedInstanceId,
        (instance) => instance.status === 'COMPLETED',
      )
      expect(
        approvedFinal?.currentStepId,
        'an approved proposal follows the default route through apply',
      ).toBe('end')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, approvedInstanceId)
      await cancelWorkflowInstanceIfExists(request, token, rejectedInstanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
