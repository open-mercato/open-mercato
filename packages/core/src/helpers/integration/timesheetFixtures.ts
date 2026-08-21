import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from './api'
import { deleteStaffEntityIfExists } from './staffFixtures'

export type CreateTimeProjectFixtureInput = {
  /**
   * Required in practice: US-B1 makes a customer mandatory on project create, so a
   * call without it cannot succeed. Pass an id from `customers.customer_entities`;
   * `createCompanyFixture` returns one.
   *
   * It is typed optional only because this module is published as
   * `@open-mercato/core/helpers/integration/timesheetFixtures`, and tightening the
   * parameter would break every third-party spec at compile time with no
   * deprecation window. The check below turns the omission into a named error
   * instead of the 422 that six in-repo specs hit (T2.10).
   */
  customerId?: string
  name?: string
  code?: string
}

/**
 * Creates a time project. `input.customerId` must be supplied — see the type above
 * for why it is not enforced by the compiler.
 */
export async function createTimeProjectFixture(
  request: APIRequestContext,
  token: string,
  input?: CreateTimeProjectFixtureInput,
): Promise<string> {
  const customerId = input?.customerId
  if (!customerId) {
    throw new Error(
      '[internal] createTimeProjectFixture requires input.customerId: a customer is mandatory on ' +
        'POST /api/staff/timesheets/time-projects, and there is no safe default to fall back to. ' +
        'Create one first (e.g. createCompanyFixture from crmFixtures) and pass its id.',
    )
  }
  const response = await apiRequest(request, 'POST', '/api/staff/timesheets/time-projects', {
    token,
    data: {
      name: input?.name ?? `QA Project ${Date.now()}`,
      code: input?.code ?? `QA-${Date.now()}`,
      customerId,
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
