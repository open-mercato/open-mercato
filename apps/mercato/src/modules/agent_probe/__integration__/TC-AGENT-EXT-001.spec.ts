import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  createWorkflowDefinitionFixture,
  startWorkflowInstanceFixture,
  getWorkflowInstanceSnapshot,
  deleteWorkflowDefinitionIfExists,
  cancelWorkflowInstanceIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  advanceQueue,
  PROBE_AGENT_ID,
  PROBE_UNAVAILABLE_REASON,
  probeCallbackUrl,
  probeConnectorAvailable,
  postSignedCallback,
  readProbeStarts,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-001: an external agent parks a workflow step, a signed callback
 * settles it, and the instance resumes carrying the AUTHOR'S mapped context keys.
 *
 * This is the whole feature. Every other spec in this folder covers one edge of
 * it; this is the claim itself, and it is what the unit suites structurally
 * cannot establish — each of them mocks at least one of the four processes this
 * path crosses: the web request that starts the instance, the queue worker that
 * reaches the connector, the UNAUTHENTICATED callback the provider makes, and the
 * signal that wakes the parked step.
 *
 * Verified-against-source contract:
 * - `INVOKE_AGENT` enqueues onto `workflow-invoke-agent` with a 1 s delay and the
 *   worker refuses to run until the instance is already PAUSED
 *   (`core/.../workflows/lib/activity-worker-handler.ts`), so the drain runs in a
 *   poll loop rather than once;
 * - the park signal is `agent_orchestrator.proposal.ready`
 *   (`INVOKE_AGENT_SIGNAL_NAME`), which `EXTERNAL_RUN_RESUME_SIGNAL` matches byte
 *   for byte — nothing typechecks across that boundary, so a drift there is only
 *   ever caught by a test like this one;
 * - `outputMapping` travels bridge ctx → `agent_external_runs.output_mapping` and
 *   is applied by `completeExternalRun` at RESUME time, read from the ROW rather
 *   than projected by the caller (tracker T2.11) — so `{ call: 'data.answer' }`
 *   must land as `context.call` even though the callback process knows nothing
 *   about the workflow definition.
 *
 * The provider run id is PINNED through the node input, so the test addresses the
 * parked run without going through the runs list — whose query index may lag
 * behind the write and would make this spec flaky for a reason unrelated to what
 * it proves.
 */

const SIGNAL_NAME = 'agent_orchestrator.proposal.ready'
const MAPPED_KEY = 'call'
const ANSWER = 'the owner confirmed the appointment'

test.describe('TC-AGENT-EXT-001: external agent suspend → callback → resume', () => {
  test.setTimeout(180_000)

  let scope: Scoped
  let available = false

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test('parks the step, settles from a signed callback, and resumes with the mapped context key', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const workflowId = `qa-wf-ext-${stamp}`
    const externalRunId = `probe_wf_${randomUUID()}`
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, scope.token, {
        workflowId,
        workflowName: `QA External Agent Workflow ${stamp}`,
        version: 1,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            {
              stepId: 'call_owner',
              stepName: 'Call the owner',
              stepType: 'AUTOMATED',
              signalConfig: { signalName: SIGNAL_NAME },
              activities: [
                {
                  activityId: 'call_owner_agent',
                  activityName: 'Call owner agent',
                  activityType: 'INVOKE_AGENT',
                  config: {
                    agentId: PROBE_AGENT_ID,
                    input: { brief: 'Ask the owner to confirm', forceExternalRunId: externalRunId },
                    onResult: { alwaysAsk: true },
                    // The driving use case: the NEXT node reads {{context.call}}.
                    outputMapping: { [MAPPED_KEY]: 'data.answer' },
                  },
                },
              ],
            },
            { stepId: 'apply', stepName: 'Apply', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
            { stepId: 'error_end', stepName: 'Failed', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 'start-to-call', fromStepId: 'start', toStepId: 'call_owner', trigger: 'auto' },
            { transitionId: 'call-to-apply', fromStepId: 'call_owner', toStepId: 'apply', trigger: 'auto' },
            { transitionId: 'apply-to-end', fromStepId: 'apply', toStepId: 'end', trigger: 'auto' },
            {
              transitionId: 'call-error',
              fromStepId: 'call_owner',
              toStepId: 'error_end',
              trigger: 'auto',
              kind: 'error',
            },
          ],
        },
      })

      instanceId = await startWorkflowInstanceFixture(request, scope.token, { workflowId, version: 1 })

      const parked = await poll(async () => {
        await advanceQueue('workflow-invoke-agent')
        const snapshot = await getWorkflowInstanceSnapshot(request, scope.token, instanceId as string)
        if (!snapshot || snapshot.status !== 'PAUSED' || snapshot.currentStepId !== 'call_owner') return null
        const starts = await readProbeStarts(request, scope, externalRunId)
        return starts.length > 0 ? starts[0] : null
      })

      expect(
        parked,
        'the step should be PAUSED on call_owner with the connector already started — no worker slot is held while an external agent thinks',
      ).not.toBeNull()

      const callbackUrl = await probeCallbackUrl(request, scope, externalRunId)
      expect(callbackUrl, 'the runner mints a single-use per-run callback URL').toContain(
        '/api/agent_orchestrator/external-runs/',
      )

      const settled = await postSignedCallback(request, callbackUrl, {
        body: { answer: ANSWER },
        signWithOrganizationId: scope.organizationId,
      })
      expect(settled.status(), 'a correctly signed callback should be accepted').toBe(200)
      expect(await settled.json()).toMatchObject({ ok: true, status: 'completed' })

      const resumed = await poll(async () => {
        const snapshot = await getWorkflowInstanceSnapshot(request, scope.token, instanceId as string)
        return snapshot && snapshot.status !== 'PAUSED' ? snapshot : null
      })

      expect(resumed, 'the callback should have woken the parked step').not.toBeNull()
      const context = (resumed?.context ?? {}) as Record<string, unknown>
      expect(
        context[MAPPED_KEY],
        'the author-declared outputMapping must land on the instance context at resume time',
      ).toBe(ANSWER)
      expect(
        resumed?.currentStepId,
        'the run succeeded, so the instance must not have taken the error route',
      ).not.toBe('error_end')
    } finally {
      await cancelWorkflowInstanceIfExists(request, scope.token, instanceId).catch(() => undefined)
      await deleteWorkflowDefinitionIfExists(request, scope.token, definitionId).catch(() => undefined)
    }
  })
})

async function poll<T>(read: () => Promise<T | null>, timeoutMs = 90_000, intervalMs = 1_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}
