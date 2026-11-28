import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceSteps,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

export const integrationMeta = { dependsOnModules: ['workflows', 'customers'] }

test('TC-WF-076: a retired Deal binding fails the step before creating a task', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(token)
  const timestamp = Date.now()
  let dealId: string | null = null
  let definitionId: string | null = null
  let instanceId: string | null = null

  try {
    dealId = await createDealFixture(request, token, { title: `QA workflow Deal ${timestamp}` })
    const deletion = await apiRequest(request, 'DELETE', `/api/customers/deals?id=${encodeURIComponent(dealId)}`, { token })
    expect(deletion.ok()).toBe(true)

    const definition = buildInspectorUserTaskDefinitionPayload(timestamp, {
      suffix: '-retired-deal',
      userTaskConfig: {
        assignedToRoles: ['admin'],
        entityBindings: [{ entityType: 'customers:customer_deal', idPath: 'context.dealId' }],
      },
    })
    definitionId = await createWorkflowDefinitionFixture(request, token, definition)
    const startedId = await startWorkflowInstanceFixture(request, token, {
      workflowId: definition.workflowId,
      initialContext: { dealId },
    })
    instanceId = startedId

    const instance = await pollWorkflowInstance(request, token, startedId,
      (candidate) => candidate.status === 'FAILED' || candidate.status === 'PAUSED')
    expect(instance?.status).toBe('FAILED')

    const steps = await listWorkflowInstanceSteps(request, token, startedId)
    expect(steps).toContainEqual(expect.objectContaining({
      stepId: 'review',
      status: 'FAILED',
      errorData: expect.objectContaining({ error: '[internal] Task creation requires a live Deal binding' }),
    }))

    await withClient(async (client) => {
      const tasks = await client.query(
        'select id from user_tasks where workflow_instance_id = $1 and tenant_id = $2 and organization_id = $3',
        [startedId, tenantId, organizationId],
      )
      expect(tasks.rows).toEqual([])
    })
  } finally {
    await cancelWorkflowInstanceIfExists(request, token, instanceId)
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
  }
})
