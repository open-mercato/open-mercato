import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

export const integrationMeta = { dependsOnModules: ['workflows'] }

/**
 * TC-WF-9217 (CALL_API): a CALL_API activity degrades cleanly when the optional
 * `api_keys` module is disabled (#9217).
 *
 * Normal path (api_keys enabled): a `{{env.APP_URL}}/api/...` CALL_API authenticates
 * with a one-time API key and the run COMPLETES.
 * Absent path (api_keys disabled): the step fails the run with the translated
 * `workflows.errors.callApi.apiKeysModuleDisabled` error ("CALL_API needs the
 * api_keys module…") instead of a MikroORM missing-metadata error for ApiKey.
 */

type InstanceDetail = { status?: string; errorMessage?: string | null }

async function isApiKeysModuleEnabled(request: APIRequestContext): Promise<boolean> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const probe = await apiRequest(request, 'GET', '/api/api_keys/keys?pageSize=1', { token: superadminToken })
  expect([200, 404], `api_keys probe answered ${probe.status()}`).toContain(probe.status())
  return probe.status() === 200
}

async function runCallApiWorkflow(request: APIRequestContext, token: string, label: string): Promise<InstanceDetail> {
  const timestamp = Date.now()
  const workflowId = `qa-wf-9217-callapi-${label}-${timestamp}`
  let definitionId: string | null = null
  let instanceId: string | null = null
  try {
    definitionId = await createWorkflowDefinitionFixture(request, token, {
      workflowId,
      workflowName: `QA TC-WF-9217 CALL_API ${label} ${timestamp}`,
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
                config: { endpoint: '{{env.APP_URL}}/api/workflows/definitions?pageSize=1', method: 'GET' },
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

test.describe('TC-WF-9217: CALL_API with and without the api_keys module', () => {
  test('CALL_API to an internal /api/ endpoint completes when api_keys is enabled', async ({ request }) => {
    test.setTimeout(90_000)

    const apiKeysEnabled = await isApiKeysModuleEnabled(request)
    const token = await getAuthToken(request, 'admin')
    const result = await runCallApiWorkflow(request, token, 'normal')

    expect(['COMPLETED', 'FAILED'], 'the run settles instead of hanging').toContain(result.status)
    if (apiKeysEnabled) {
      expect(result.status, `api_keys enabled: CALL_API completes (error=${result.errorMessage ?? 'none'})`).toBe('COMPLETED')
    }
  })

  test('without api_keys CALL_API fails the step with the translated apiKeysModuleDisabled error', async ({ request }) => {
    test.setTimeout(90_000)

    const apiKeysEnabled = await isApiKeysModuleEnabled(request)
    test.skip(apiKeysEnabled, 'Requires an app without the optional api_keys module')

    const token = await getAuthToken(request, 'admin')
    const result = await runCallApiWorkflow(request, token, 'absent')

    expect(result.status, 'api_keys disabled: CALL_API fails the run').toBe('FAILED')
    const errorMessage = result.errorMessage ?? ''
    expect(errorMessage, 'the failure names the missing module').toContain('api_keys')
    expect(errorMessage, 'no raw ORM metadata error leaks out').not.toMatch(/metadata/i)
  })
})
