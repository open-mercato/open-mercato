import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = {
  dependsOnModules: [
    'example',
    'search',
    'query_index',
    'integrations',
    'payment_gateways',
    'shipping_carriers',
    'currencies',
    'workflows',
    'events',
  ],
}

const TODOS_API = '/api/example/todos'
const WORKFLOW_ID = 'example.todo-created-reference'

type WorkflowInstance = {
  id: string
  status: string
  organizationId?: string
  metadata?: { entityId?: string; entityType?: string }
}

type SearchResponse = {
  results?: Array<{ entityId?: unknown; recordId?: unknown }>
}


async function readWorkflowInstances(
  request: APIRequestContext,
  token: string,
  todoId: string,
  selectedOrgId?: string,
): Promise<WorkflowInstance[]> {
  const query = new URLSearchParams({
    workflowId: WORKFLOW_ID,
    entityType: 'example:todo',
    entityId: todoId,
    limit: '10',
  })
  const requestPath = `/api/workflows/instances?${query.toString()}`
  const response = selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'GET', requestPath, { token, selectedOrgId })
    : await apiRequest(request, 'GET', requestPath, { token })
  expect(response.ok(), `workflow list failed: ${response.status()}`).toBeTruthy()
  return ((await response.json()) as { data?: WorkflowInstance[] }).data ?? []
}

async function searchTodoIds(
  request: APIRequestContext,
  token: string,
  query: string,
  selectedOrgId?: string,
): Promise<string[]> {
  const search = new URLSearchParams({
    q: query,
    limit: '20',
    strategies: 'tokens',
    entityTypes: 'example:todo',
  })
  const requestPath = `/api/search/search?${search.toString()}`
  const response = selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'GET', requestPath, { token, selectedOrgId })
    : await apiRequest(request, 'GET', requestPath, { token })
  expect(response.ok(), `Todo search failed: ${response.status()}`).toBeTruthy()
  const body = await response.json() as SearchResponse
  return (body.results ?? [])
    .filter((result) => result.entityId === 'example:todo')
    .map((result) => String(result.recordId))
}

async function deleteWorkflowInstances(instanceIds: string[]): Promise<void> {
  if (instanceIds.length === 0) return
  await withClient(async (client) => {
    await client.query(
      'DELETE FROM workflow_events WHERE workflow_instance_id = ANY($1::uuid[])',
      [instanceIds],
    )
    await client.query(
      'DELETE FROM step_instances WHERE workflow_instance_id = ANY($1::uuid[])',
      [instanceIds],
    )
    await client.query(
      'DELETE FROM workflow_branch_instances WHERE workflow_instance_id = ANY($1::uuid[])',
      [instanceIds],
    )
    await client.query(
      'DELETE FROM workflow_instances WHERE id = ANY($1::uuid[])',
      [instanceIds],
    )
  })
}

test.describe('TC-EXAMPLE-015: the nine specialized registries have real local callers', () => {
  test('token search indexes a real Todo and preserves organization scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let todoId: string | null = null
    let foreignOrgId: string | null = null
    let foreignTodoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: {
          title: `TC-EXAMPLE-015 vector ${suffix}`,
          notes: `private-${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(created.ok()).toBeTruthy()
      todoId = ((await created.json()) as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      foreignOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-015 vector org ${suffix}`,
        tenantId,
      })
      const foreign = await apiRequestWithSelectedOrg(request, 'POST', TODOS_API, {
        token,
        selectedOrgId: foreignOrgId,
        data: {
          title: `TC-EXAMPLE-015 foreign vector ${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(foreign.ok()).toBeTruthy()
      foreignTodoId = ((await foreign.json()) as { id?: string }).id ?? null
      expect(foreignTodoId).toBeTruthy()

      await expect.poll(
        () => searchTodoIds(request, token, `TC-EXAMPLE-015 vector ${suffix}`),
        { timeout: 20_000 },
      ).toContain(todoId)
      await expect.poll(
        () => searchTodoIds(request, token, `TC-EXAMPLE-015 foreign vector ${suffix}`, foreignOrgId!),
        { timeout: 20_000 },
      ).toContain(foreignTodoId)
      expect(await searchTodoIds(request, token, `TC-EXAMPLE-015 foreign vector ${suffix}`))
        .not.toContain(foreignTodoId)

    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
      if (foreignOrgId && foreignTodoId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', TODOS_API, {
          token,
          selectedOrgId: foreignOrgId,
          data: { id: foreignTodoId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, foreignOrgId)
    }
  })

  test('one scoped Todo event starts exactly one workflow instance in its organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let homeTodoId: string | null = null
    let foreignTodoId: string | null = null
    let foreignOrgId: string | null = null
    const workflowInstanceIds = new Set<string>()

    try {
      const home = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: {
          title: `TC-EXAMPLE-015 workflow home ${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(home.ok()).toBeTruthy()
      homeTodoId = ((await home.json()) as { id?: string }).id ?? null
      expect(homeTodoId).toBeTruthy()

      await expect.poll(async () => {
        const instances = await readWorkflowInstances(request, token, homeTodoId!)
        instances.forEach((instance) => workflowInstanceIds.add(instance.id))
        return instances.map((instance) => instance.status)
      }, { timeout: 30_000 }).toEqual(['COMPLETED'])
      expect(await readWorkflowInstances(request, token, homeTodoId!)).toHaveLength(1)

      foreignOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-015 workflow org ${suffix}`,
        tenantId,
      })
      const foreign = await apiRequestWithSelectedOrg(request, 'POST', TODOS_API, {
        token,
        selectedOrgId: foreignOrgId,
        data: {
          title: `TC-EXAMPLE-015 workflow foreign ${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(foreign.ok()).toBeTruthy()
      foreignTodoId = ((await foreign.json()) as { id?: string }).id ?? null
      expect(foreignTodoId).toBeTruthy()

      await expect.poll(async () => {
        const instances = await readWorkflowInstances(request, token, foreignTodoId!, foreignOrgId!)
        instances.forEach((instance) => workflowInstanceIds.add(instance.id))
        return instances.map((instance) => instance.status)
      }, { timeout: 30_000 }).toEqual(['COMPLETED'])

      expect(await readWorkflowInstances(request, token, foreignTodoId!)).toEqual([])
      expect(await readWorkflowInstances(request, token, foreignTodoId!, foreignOrgId!)).toHaveLength(1)
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, homeTodoId)
      if (foreignOrgId && foreignTodoId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', TODOS_API, {
          token,
          selectedOrgId: foreignOrgId,
          data: { id: foreignTodoId },
        }).catch(() => undefined)
      }
      await deleteWorkflowInstances([...workflowInstanceIds])
      await deleteOrganizationIfExists(request, token, foreignOrgId)
    }
  })
})
