import { randomUUID } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import { deleteProcessExecutionsByProcessDefinitionIds } from './agentPerfFixtures'

type ReconnectTask = {
  id: string
  name: string
  token: string
  tenantId: string
  organizationId: string
}

export const test = base.extend<{ reconnectTask: ReconnectTask }>({
  reconnectTask: async ({ request }, use, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    const name = `TC-AGENT-UXC-008 ${randomUUID()}`
    const workflow = buildMinimalDefinitionPayload(Date.now(), `-${randomUUID()}`)
    const definitionId = await createWorkflowDefinitionFixture(request, token, workflow)
    let processId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/agent_orchestrator/processes', {
        token,
        data: {
          name,
          workflowMode: 'workflow',
          workflowId: workflow.workflowId,
          triggers: [{ kind: 'manual' }],
          enabled: true,
        },
      })
      const body = await readJsonSafe<{ id?: string }>(created)
      processId = body?.id ?? null
      expect(created.ok(), 'manual task fixture is created through the API').toBe(true)
      await use({ id: expectId(processId, 'task id'), name, token, ...scope })
    } finally {
      try {
        if (processId) {
          const deleted = await apiRequest(
            request, 'DELETE', `/api/agent_orchestrator/processes?id=${processId}`, { token },
          )
          expect(deleted.ok(), 'owned task is deleted').toBe(true)
          await drainIntegrationQueue('agent-process-executions')
        }
      } finally {
        if (processId) await deleteProcessExecutionsByProcessDefinitionIds([processId])
        await withClient(async (client) => {
          const instances = await client.query<{ id: string }>(
            'select id from workflow_instances where definition_id = $1 and tenant_id = $2 and organization_id = $3',
            [definitionId, scope.tenantId, scope.organizationId],
          )
          const instanceIds = instances.rows.map((instance) => instance.id)
          for (const table of ['workflow_events', 'step_instances', 'process_instances']) {
            await client.query(
              `delete from ${table} where workflow_instance_id = any($1::uuid[]) and tenant_id = $2 and organization_id = $3`,
              [instanceIds, scope.tenantId, scope.organizationId],
            )
          }
          await client.query(
            'delete from workflow_instances where id = any($1::uuid[]) and tenant_id = $2 and organization_id = $3',
            [instanceIds, scope.tenantId, scope.organizationId],
          )
          const remaining = await client.query<{ count: string }>(
            `select count(*) from process_instances
             where (process_definition_id = $1 or workflow_instance_id = any($2::uuid[]))
             and tenant_id = $3 and organization_id = $4`,
            [processId, instanceIds, scope.tenantId, scope.organizationId],
          )
          expect(remaining.rows[0]?.count, 'owned execution projections are removed').toBe('0')
        })
        const deleted = await apiRequest(
          request, 'DELETE', `/api/workflows/definitions/${definitionId}`, { token },
        )
        expect(deleted.ok(), 'owned workflow definition is deleted').toBe(true)
        if (processId) {
          const listed = await apiRequest(
            request, 'GET', `/api/agent_orchestrator/processes?id=${processId}`, { token },
          )
          expect(listed.ok()).toBe(true)
          expect((await readJsonSafe<{ items: unknown[] }>(listed))?.items).toEqual([])
        }
        await testInfo.attach('fixture-cleanup', {
          body: JSON.stringify({ processId, definitionId, executionsRemoved: true, definitionsDeleted: true }),
          contentType: 'application/json',
        })
      }
    }
  },
})
