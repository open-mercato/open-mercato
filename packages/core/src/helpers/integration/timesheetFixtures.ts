import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from './api'
import { deleteStaffEntityIfExists } from './staffFixtures'

/**
 * `customerId` is a required parameter, not an optional one: US-B1 makes a customer
 * mandatory on project create, so a call without it fails validation at runtime.
 * Keeping it required means TypeScript catches the mistake at the call site instead
 * of a spec discovering it as a 422 (see T2.10 — six specs regressed exactly that way).
 * Pass an id from `customers.customer_entities`; `createCompanyFixture` returns one.
 */
export async function createTimeProjectFixture(
  request: APIRequestContext,
  token: string,
  input: { customerId: string; name?: string; code?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/staff/timesheets/time-projects', {
    token,
    data: {
      name: input.name ?? `QA Project ${Date.now()}`,
      code: input.code ?? `QA-${Date.now()}`,
      customerId: input.customerId,
      projectType: 'internal',
      status: 'active',
    },
  })
  expect(response.ok(), `Failed to create time project fixture: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

export async function assignEmployeeToProjectFixture(
  request: APIRequestContext,
  token: string,
  projectId: string,
  staffMemberId: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
    token,
    data: { staffMemberId, status: 'active', assignedStartDate: new Date().toISOString().slice(0, 10) },
  })
  expect(response.ok(), `Failed to assign employee to project: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  return body.id ?? ''
}

export async function createTimeEntryFixture(
  request: APIRequestContext,
  token: string,
  input: { staffMemberId: string; timeProjectId: string; date: string; durationMinutes: number },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
    token,
    data: {
      staffMemberId: input.staffMemberId,
      timeProjectId: input.timeProjectId,
      date: input.date,
      durationMinutes: input.durationMinutes,
      source: 'manual',
    },
  })
  expect(response.ok(), `Failed to create time entry fixture: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

export { deleteStaffEntityIfExists }
