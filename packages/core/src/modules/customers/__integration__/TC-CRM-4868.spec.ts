import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-4868: the customer task aggregate includes tasks written by the standard
 * Person/Company task dialog while unified interactions are disabled (issue #4868).
 *
 * The dialog POSTs a canonical interaction with `interactionType: 'task'` and no
 * `source`, which persists as `source = NULL`. Before the fix the compatibility
 * branch of `/api/customers/interactions/tasks` narrowed its canonical read to
 * `source = 'adapter:todo'`, so those tasks were visible on the customer record but
 * absent from `/backend/customer-tasks`, which reads the aggregate.
 *
 * `customers.interactions.unified` defaults to `false`, so this test exercises the
 * defective compatibility branch without touching any feature-toggle override.
 * `all=true` is used so the assertion never depends on where the fixtures land
 * inside the aggregate's bounded merged-read window.
 */
test.describe('TC-CRM-4868: customer task aggregate includes source-less canonical tasks (#4868)', () => {
  test('tasks created for a person and a company appear in the aggregate exactly once', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let personId: string | null = null
    let companyTaskId: string | null = null
    let personTaskId: string | null = null
    const stamp = `${Date.now()}`
    const companyTaskTitle = `QA TC-CRM-4868 company task ${stamp}`
    const personTaskTitle = `QA TC-CRM-4868 person task ${stamp}`

    const createTask = async (authToken: string, entityId: string, title: string): Promise<string> => {
      const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token: authToken,
        data: {
          entityId,
          interactionType: 'task',
          title,
          body: 'QA TC-CRM-4868 task description',
          status: 'planned',
          occurredAt: new Date().toISOString(),
        },
      })
      expect(
        response.ok(),
        `POST /api/customers/interactions returned ${response.status()}`,
      ).toBeTruthy()
      const payload = (await readJsonSafe(response)) as { id?: string } | null
      const id = payload?.id ?? null
      expect(id, 'POST /api/customers/interactions returned no id').toBeTruthy()
      return id as string
    }

    const listAggregateTasks = async (
      authToken: string,
    ): Promise<Array<{ todoId: string; todoTitle: string | null }>> => {
      const response = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions/tasks?all=true&search=${encodeURIComponent(stamp)}`,
        { token: authToken },
      )
      expect(
        response.ok(),
        `GET /api/customers/interactions/tasks returned ${response.status()}`,
      ).toBeTruthy()
      const payload = (await readJsonSafe(response)) as {
        items?: Array<{ todoId: string; todoTitle: string | null }>
      } | null
      return payload?.items ?? []
    }

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-4868 Co ${stamp}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'Casey',
        lastName: `TC-CRM-4868-${stamp}`,
        displayName: `QA TC-CRM-4868 Person ${stamp}`,
      })

      companyTaskId = await createTask(token, companyId, companyTaskTitle)
      personTaskId = await createTask(token, personId, personTaskTitle)

      // The canonical endpoint has no source restriction and must see both tasks
      // with `source: null` — this is the write-path side of the contract.
      const canonicalRes = await apiRequest(
        request,
        'GET',
        '/api/customers/interactions?interactionType=task&limit=100',
        { token },
      )
      expect(
        canonicalRes.ok(),
        `GET /api/customers/interactions returned ${canonicalRes.status()}`,
      ).toBeTruthy()
      const canonicalPayload = (await readJsonSafe(canonicalRes)) as {
        items?: Array<{ id: string; source?: string | null }>
      } | null
      const canonicalItems = canonicalPayload?.items ?? []
      const canonicalById = new Map(canonicalItems.map((item) => [item.id, item]))
      expect(canonicalById.has(companyTaskId)).toBeTruthy()
      expect(canonicalById.has(personTaskId)).toBeTruthy()
      expect(canonicalById.get(companyTaskId)?.source ?? null).toBeNull()
      expect(canonicalById.get(personTaskId)?.source ?? null).toBeNull()

      // The aggregate the global Customer tasks page reads must agree with it.
      const aggregateItems = await listAggregateTasks(token)
      const aggregateIds = aggregateItems.map((item) => item.todoId)
      expect(aggregateIds).toContain(companyTaskId)
      expect(aggregateIds).toContain(personTaskId)
      expect(aggregateIds.filter((id) => id === companyTaskId)).toHaveLength(1)
      expect(aggregateIds.filter((id) => id === personTaskId)).toHaveLength(1)
      expect(aggregateItems.map((item) => item.todoTitle)).toEqual(
        expect.arrayContaining([companyTaskTitle, personTaskTitle]),
      )

      // Deleting a task removes it from the aggregate; the other one stays.
      await deleteEntityIfExists(request, token, '/api/customers/interactions', personTaskId)
      const remainingIds = (await listAggregateTasks(token)).map((item) => item.todoId)
      expect(remainingIds).not.toContain(personTaskId)
      expect(remainingIds).toContain(companyTaskId)
      personTaskId = null
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', personTaskId)
      await deleteEntityIfExists(request, token, '/api/customers/interactions', companyTaskId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
