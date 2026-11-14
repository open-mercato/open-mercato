import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createTestCustomer, type TestCustomerFixture } from '../fixtures'

const ROOT = '/api/staff/timesheets'

type OwnedRecord = { path: string; id: string }

export async function createReportContainmentFixtures(request: APIRequestContext, token: string) {
  const stamp = randomUUID().slice(0, 8)
  const projectName = `Containment ${stamp} consulting delivery with a deliberately long project label`
  const memberName = `Containment ${stamp} consultant with a deliberately long display name`
  const taskName = `Containment ${stamp} implementation and verification with a deliberately long task label`
  const { tenantId, organizationId } = getTokenContext(token)
  const records: OwnedRecord[] = []
  let projectId: string | null = null
  const closedReports = new Set<string>()
  let customer: TestCustomerFixture | null = null

  const create = async (path: string, data: Record<string, unknown>) => {
    const response = await apiRequest(request, 'POST', path, { token, data })
    const body = await readJsonSafe<{ id?: string }>(response)
    expect(response.status(), `Create owned fixture at ${path}: ${JSON.stringify(body)}`).toBe(201)
    const id = expectId(body?.id, `${path} fixture id`)
    records.push({ path, id })
    return id
  }

  const cleanup = async () => {
    const failures: string[] = []
    for (const id of closedReports) {
      try {
        const response = await apiRequest(request, 'POST', `${ROOT}/reports/${id}/unlock`, {
          token, data: { reason: `Containment fixture cleanup ${stamp}` },
        })
        if (!response.ok()) failures.push(`unlock ${id}: ${response.status()}`)
      } catch (error) {
        failures.push(String(error))
      }
    }
    for (const { path, id } of [...records].reverse()) {
      try {
        const response = await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
        if (!response.ok() && response.status() !== 404) failures.push(`delete ${path}/${id}: ${response.status()}`)
      } catch (error) {
        failures.push(String(error))
      }
    }
    if (projectId) {
      try {
        expect(process.env.DATABASE_URL, 'Cleanup must use the repository runner database').toBeTruthy()
        await withClient(async (client) => {
          await client.query(
            `update staff_time_task_statuses set deleted_at = now(), updated_at = now()
             where time_project_id = $1 and tenant_id = $2 and organization_id = $3
             and exists (select 1 from staff_time_projects where id = $1 and deleted_at is not null)`,
            [projectId, tenantId, organizationId],
          )
        })
      } catch (error) {
        failures.push(String(error))
      }
    }
    expect(failures, 'Every owned report, entry, task, project and member should be removed').toEqual([])
  }

  try {
    customer = await createTestCustomer(request, token, { displayName: `Containment customer ${stamp}` })
    records.push({ path: '/api/customers/companies', id: customer.id })
    const memberId = await create('/api/staff/team-members', { displayName: memberName })
    projectId = await create(`${ROOT}/time-projects`, {
      name: projectName, code: `CT-${stamp}`, customerId: customer.id, status: 'active',
      hourlyRate: 120, currencyCode: 'EUR', billableByDefault: true,
    })
    await create(`${ROOT}/time-projects/${projectId}/employees`, {
      staffMemberId: memberId, status: 'active', assignedStartDate: '2026-03-01',
    })
    const taskId = await create(`${ROOT}/tasks`, {
      timeProjectId: projectId, title: taskName, assigneeStaffMemberId: memberId,
    })
    for (let index = 0; index < 6; index += 1) {
      await create(`${ROOT}/time-entries`, {
        staffMemberId: memberId, timeProjectId: projectId, taskId,
        date: `2026-03-${10 + index}`, durationMinutes: 60, source: 'manual', isBillable: true,
        description: `Containment row ${index + 1} ${stamp}`,
      })
    }
    const createReport = async (title: string, periodFrom: string, periodTo: string) => create(`${ROOT}/reports`, {
      customerId: customer?.id, title, periodKind: 'custom', periodFrom, periodTo,
      timeProjectIds: [projectId], showRates: true,
    })
    const closedTitle = `Closed containment ${stamp}`
    const closedId = await createReport(closedTitle, '2026-03-01', '2026-03-31')
    const close = await apiRequest(request, 'POST', `${ROOT}/reports/${closedId}/close`, { token, data: {} })
    expect(close.ok(), 'Close and freeze the six owned entries').toBe(true)
    closedReports.add(closedId)
    await create(`${ROOT}/time-entries`, {
      staffMemberId: memberId, timeProjectId: projectId, taskId, date: '2026-03-20',
      durationMinutes: 60, source: 'manual', isBillable: true, description: `Containment draft ${stamp}`,
    })
    const draftTitle = `Draft containment ${stamp}`
    const draftId = await createReport(draftTitle, '2026-03-01', '2026-03-31')
    const emptyTitle = `Empty containment ${stamp}`
    const emptyId = await createReport(emptyTitle, '2026-04-01', '2026-04-30')
    return { closedId, closedTitle, draftId, draftTitle, emptyId, emptyTitle, projectName, memberName, taskName, cleanup }
  } catch (error) {
    try { await cleanup() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '[internal] Fixture setup and cleanup failed')
    }
    throw error
  }
}
