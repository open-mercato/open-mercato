import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-072: CALL_API sends its one-time API key only to APP_URL's origin and
 * `/api/` surface (#7235).
 *
 * An absolute endpoint on APP_URL's origin but outside `/api/` used to be sent
 * with the key; it must now fail the run with the path-guard error. The
 * documented `{{env.APP_URL}}/api/...` form must keep completing.
 */

type InstanceDetail = { status?: string; errorMessage?: string | null }

async function runCallApi(
  request: APIRequestContext,
  token: string,
  label: string,
  endpoint: string,
): Promise<InstanceDetail> {
  const timestamp = Date.now()
  const workflowId = `qa-wf-072-${label}-${timestamp}`
  let definitionId: string | null = null
  let instanceId: string | null = null
  try {
    definitionId = await createWorkflowDefinitionFixture(request, token, {
      workflowId,
      workflowName: `QA TC-WF-072 ${label} ${timestamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          {
            transitionId: 'start-to-end',
            fromStepId: 'start',
            toStepId: 'end',
            trigger: 'auto',
            activities: [
              {
                activityId: 'call_api',
                activityName: 'Call API',
                activityType: 'CALL_API',
                config: { endpoint, method: 'GET' },
                retryPolicy: { maxAttempts: 1, initialIntervalMs: 0, backoffCoefficient: 1, maxIntervalMs: 0 },
              },
            ],
          },
        ],
      },
    })
    instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

    await pollWorkflowInstance(
      request,
      token,
      instanceId,
      (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
      { timeoutMs: 30_000 },
    )
    const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ data?: InstanceDetail }>(response)
    return body?.data ?? {}
  } finally {
    await cancelWorkflowInstanceIfExists(request, token, instanceId)
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
  }
}

test.describe('TC-WF-072: CALL_API endpoint origin and path guard', () => {
  test('refuses an APP_URL endpoint outside /api/ and still runs {{env.APP_URL}}/api/ endpoints', async ({ request }) => {
    test.setTimeout(90_000)
    const token = await getAuthToken(request, 'admin')

    const refused = await runCallApi(request, token, 'backend', '{{env.APP_URL}}/backend/workflows')
    expect(refused.status, 'a non-/api/ absolute endpoint fails the run').toBe('FAILED')
    expect(refused.errorMessage ?? '').toContain('CALL_API only supports /api/* paths')

    const allowed = await runCallApi(request, token, 'api', '{{env.APP_URL}}/api/workflows/definitions?pageSize=1')
    expect(allowed.status, `a same-origin /api/ endpoint completes (error=${allowed.errorMessage ?? 'none'})`).toBe('COMPLETED')
  })
})
