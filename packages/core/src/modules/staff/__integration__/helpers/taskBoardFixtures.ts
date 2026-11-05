import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, createRoleFixture, createUserFixture, deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestTimeProject } from '../fixtures'

export const TASKS_PATH = '/api/staff/timesheets/tasks'
export const STATUSES_PATH = '/api/staff/timesheets/task-statuses'
const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const MEMBERS_PATH = '/api/staff/team-members'

export type BoardFixture = {
  request: APIRequestContext
  token: string
  adminToken: string
  tenantId: string
  organizationId: string
  memberId: string
  memberName: string
  projectId: string
  projectName: string
  defaultStatusId: string
  chosenStatusId: string
  secondProject: { id: string; name: string; defaultStatusId: string } | null
  seedTaskTitle: string
  cleanup: () => Promise<void>
}

export async function createBoardFixture(provisionRequest: APIRequestContext, persona: 'manager' | 'employee', options: { secondProject?: boolean } = {}): Promise<BoardFixture> {
  const cleanupSteps: Array<() => Promise<unknown>> = []
  let scopedRequest: APIRequestContext | null = null
  const cleanup = async () => {
    const failures: unknown[] = []
    for (const step of cleanupSteps.reverse()) {
      try { await step() } catch (error) { failures.push(error) }
    }
    cleanupSteps.length = 0
    await scopedRequest?.dispose()
    scopedRequest = null
    expect(failures, 'Every owned board fixture should be cleaned up').toEqual([])
  }
  try {
    const adminToken = await getAuthToken(provisionRequest, 'superadmin')
    const { tenantId, organizationId: bootstrapOrganizationId } = getTokenContext(adminToken)
    expect(tenantId, 'The bootstrap actor must have an owned tenant').not.toBe('')
    expect(bootstrapOrganizationId, 'The bootstrap actor must have an owned organization').not.toBe('')
    const stamp = randomUUID().slice(0, 8)
    const organizationId = await createOrganizationFixture(provisionRequest, adminToken, { name: `Board scope ${stamp}`, tenantId })
    cleanupSteps.push(() => deleteOrganizationIfExists(provisionRequest, adminToken, organizationId))
    const request = await playwrightRequest.newContext({
      baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
      extraHTTPHeaders: { Cookie: `om_selected_org=${organizationId}; om_selected_tenant=${tenantId}` },
    })
    scopedRequest = request
    const memberName = `Board ${persona} ${stamp}`
    const password = `QA-${randomUUID()}!aA1`
    const email = `board-${persona}-${stamp}@example.com`
    const roleId = await createRoleFixture(request, adminToken, { name: `board-${persona}-${stamp}`, tenantId })
    cleanupSteps.push(() => deleteRoleIfExists(request, adminToken, roleId))
    await setRoleAclFeatures(request, adminToken, {
      roleId, organizations: [organizationId],
      features: [
        'staff.leave_requests.send',
        'staff.timesheets.view', 'staff.timesheets.projects.view', 'staff.timesheets.tasks.view',
        'staff.timesheets.tasks.manage', 'staff.timesheets.manage_own',
        ...(persona === 'manager' ? ['staff.view', 'staff.timesheets.projects.manage'] : []),
      ],
    })
    const userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId], name: memberName })
    cleanupSteps.push(() => deleteUserIfExists(request, adminToken, userId))
    const createRecord = async (path: string, data: Record<string, unknown>) => {
      const response = await apiRequest(request, 'POST', path, { token: adminToken, data })
      const body = await readJsonSafe<{ id?: string; error?: string; fieldErrors?: Record<string, unknown> }>(response)
      expect(response.status(), `POST ${path} should create its owned fixture: ${JSON.stringify({ error: body?.error, fieldErrors: body?.fieldErrors })}`).toBe(201)
      const id = expectId(body?.id, `POST ${path} should return its owned fixture id`)
      cleanupSteps.push(async () => {
        const response = await apiRequest(request, 'DELETE', `${path}?id=${id}`, { token: adminToken })
        expect(response.ok() || response.status() === 404, `DELETE ${path} should clean up its owned fixture`).toBe(true)
      })
      return id
    }
    const memberId = await createRecord(MEMBERS_PATH, { displayName: memberName, userId })
    const projects = []
    for (const suffix of options.secondProject ? ['A', 'B'] : ['A']) {
      const project = await createTestTimeProject(request, adminToken, { name: `Board ${suffix} ${stamp}`, code: `B${suffix}-${stamp}` })
      cleanupSteps.push(project.cleanup)
      const assignment = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${project.id}/employees`, {
        token: adminToken, data: { staffMemberId: memberId, status: 'active', assignedStartDate: '2020-01-01' },
      })
      expect(assignment.ok(), 'The scoped employee must have real project membership').toBe(true)
      const assignmentId = expectId((await readJsonSafe<{ id?: string }>(assignment))?.id, 'The owned project membership should have an id')
      cleanupSteps.push(async () => {
        const response = await apiRequest(request, 'DELETE', `${PROJECTS_PATH}/${project.id}/employees?id=${assignmentId}`, { token: adminToken })
        expect(response.ok(), 'The owned membership should be removed').toBe(true)
      })
      const defaultStatusId = await createRecord(STATUSES_PATH, { timeProjectId: project.id, name: `Ready ${suffix}`, slug: `ready-${suffix.toLowerCase()}`, isDefault: true, position: 500 })
      const chosenStatusId = await createRecord(STATUSES_PATH, { timeProjectId: project.id, name: `Working ${suffix}`, slug: `working-${suffix.toLowerCase()}`, position: 1500 })
      projects.push({ ...project, defaultStatusId, chosenStatusId })
      cleanupSteps.push(async () => {
        const response = await apiRequest(request, 'GET', `${TASKS_PATH}?timeProjectId=${project.id}&pageSize=100`, { token: adminToken })
        expect(response.ok()).toBe(true)
        const body = await readJsonSafe<{ items: Array<{ id: string }> }>(response)
        for (const task of body?.items ?? []) {
          const deletion = await apiRequest(request, 'DELETE', `${TASKS_PATH}?id=${task.id}`, { token: adminToken })
          expect(deletion.ok(), 'The owned task should be removed').toBe(true)
        }
      })
    }
    const token = await withCredentialIsolatedRequest((actorRequest) => getAuthToken(actorRequest, email, password))
    const featureResponse = await apiRequest(request, 'POST', '/api/auth/feature-check', { token, data: { features: ['staff.view'] } })
    expect(featureResponse.ok()).toBe(true)
    const featureBody = await readJsonSafe<{ granted: string[] }>(featureResponse)
    expect(featureBody?.granted.includes('staff.view')).toBe(persona === 'manager')
    const seedTaskTitle = `Assigned baseline ${stamp}`
    const baseline = await apiRequest(request, 'POST', TASKS_PATH, {
      token: adminToken,
      data: { title: seedTaskTitle, timeProjectId: projects[0].id, taskStatusId: projects[0].defaultStatusId, assigneeStaffMemberId: memberId },
    })
    expect(baseline.status(), 'The permission regression needs an assigned task on the initial board').toBe(201)
    const directory = await apiRequest(request, 'GET', `${MEMBERS_PATH}?ids=${memberId}`, { token })
    expect(directory.status(), 'The real staff.view guard must remain unchanged').toBe(persona === 'manager' ? 200 : 403)
    return {
      request, token, adminToken, tenantId, organizationId, memberId, memberName,
      projectId: projects[0].id, projectName: projects[0].name,
      defaultStatusId: projects[0].defaultStatusId, chosenStatusId: projects[0].chosenStatusId,
      secondProject: projects[1] ? { id: projects[1].id, name: projects[1].name, defaultStatusId: projects[1].defaultStatusId } : null,
      seedTaskTitle, cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
