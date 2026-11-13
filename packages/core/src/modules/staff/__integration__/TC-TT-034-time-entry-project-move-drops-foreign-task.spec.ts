import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = {
  dependsOnModules: ['customers', 'audit_logs'],
}

/**
 * TC-TT-034 — Moving a time entry to another project drops the old project's task (#ISSUE).
 *
 * A PUT that names only a new `timeProjectId` used to keep the stored `taskId`,
 * leaving the hours billed on one project while the task rollups counted them
 * on a task of another. The move now clears the task when it belongs to a
 * different project, and undo puts both the project and the task back.
 */

const CUSTOMERS_PATH = '/api/customers/companies'
const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const TASKS_PATH = '/api/staff/timesheets/tasks'
const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'
const TEAM_MEMBERS_PATH = '/api/staff/team-members'
const ENTRY_DATE = '2026-03-10'
const PERIOD_FROM = '2026-03-01'
const PERIOD_TO = '2026-03-31'

type World = {
  token: string
  customerId: string | null
  staffMemberId: string | null
  selfMemberCreated: boolean
  projectIds: string[]
  taskIds: string[]
  entryIds: string[]
}

type EntryRow = {
  id?: string
  task_id?: string | null
  taskId?: string | null
  time_project_id?: string | null
  timeProjectId?: string | null
}

async function readCreatedId(response: Awaited<ReturnType<typeof apiRequest>>, context: string): Promise<string> {
  expect(response.ok(), `${context} should succeed: ${response.status()}`).toBeTruthy()
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `${context} should return an id`)
}

async function ensureSelfStaffMember(request: APIRequestContext, world: World, displayName: string): Promise<void> {
  const read = async (): Promise<string | null> => {
    const response = await apiRequest(request, 'GET', SELF_MEMBER_PATH, { token: world.token })
    if (!response.ok()) return null
    const id = (await readJsonSafe<{ member?: { id?: string } | null }>(response))?.member?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  const existing = await read()
  if (existing) {
    world.staffMemberId = existing
    return
  }
  const response = await apiRequest(request, 'POST', SELF_MEMBER_PATH, { token: world.token, data: { displayName } })
  expect(response.ok(), `POST ${SELF_MEMBER_PATH} should create the staff profile: ${response.status()}`).toBeTruthy()
  world.selfMemberCreated = true
  world.staffMemberId = await read()
  expect(world.staffMemberId, 'The staff profile should be readable right after creation').toBeTruthy()
}

async function createProject(request: APIRequestContext, world: World, name: string, code: string): Promise<string> {
  const response = await apiRequest(request, 'POST', PROJECTS_PATH, {
    token: world.token,
    data: { name, code, customerId: world.customerId, projectType: 'internal', status: 'active' },
  })
  const projectId = await readCreatedId(response, `POST ${PROJECTS_PATH} (${name})`)
  world.projectIds.push(projectId)
  const assign = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectId}/employees`, {
    token: world.token,
    data: { staffMemberId: world.staffMemberId, status: 'active', assignedStartDate: PERIOD_FROM },
  })
  expect(assign.ok(), `Assigning the member to ${name} should succeed: ${assign.status()}`).toBeTruthy()
  return projectId
}

async function createTask(request: APIRequestContext, world: World, timeProjectId: string, title: string): Promise<string> {
  const response = await apiRequest(request, 'POST', TASKS_PATH, { token: world.token, data: { timeProjectId, title } })
  const taskId = await readCreatedId(response, `POST ${TASKS_PATH} (${title})`)
  world.taskIds.push(taskId)
  return taskId
}

async function createEntry(request: APIRequestContext, world: World, taskId: string, notes: string): Promise<string> {
  const response = await apiRequest(request, 'POST', ENTRIES_PATH, {
    token: world.token,
    data: { staffMemberId: world.staffMemberId, taskId, date: ENTRY_DATE, durationMinutes: 60, source: 'manual', notes },
  })
  const entryId = await readCreatedId(response, `POST ${ENTRIES_PATH} (${notes})`)
  world.entryIds.push(entryId)
  return entryId
}

async function readEntry(
  request: APIRequestContext,
  token: string,
  entryId: string,
): Promise<{ taskId: string | null; timeProjectId: string | null }> {
  const query = new URLSearchParams({ ids: entryId, from: PERIOD_FROM, to: PERIOD_TO })
  const response = await apiRequest(request, 'GET', `${ENTRIES_PATH}?${query.toString()}`, { token })
  expect(response.ok(), `GET ${ENTRIES_PATH} should succeed: ${response.status()}`).toBeTruthy()
  const row = (await readJsonSafe<{ items?: EntryRow[] }>(response))?.items?.find((item) => item.id === entryId)
  expect(row, `The entry ${entryId} should be listed`).toBeTruthy()
  return {
    taskId: row?.task_id ?? row?.taskId ?? null,
    timeProjectId: row?.time_project_id ?? row?.timeProjectId ?? null,
  }
}

async function moveEntryToProject(
  request: APIRequestContext,
  token: string,
  entryId: string,
  timeProjectId: string,
): Promise<string> {
  const response = await apiRequest(request, 'PUT', ENTRIES_PATH, { token, data: { id: entryId, timeProjectId } })
  expect(response.ok(), `PUT ${ENTRIES_PATH} should move the entry: ${response.status()}`).toBeTruthy()
  return expectOperation(response, 'move entry to another project').undoToken
}

async function cleanUp(request: APIRequestContext, world: World): Promise<void> {
  for (const entryId of world.entryIds) await deleteGeneralEntityIfExists(request, world.token, ENTRIES_PATH, entryId)
  for (const taskId of world.taskIds) await deleteGeneralEntityIfExists(request, world.token, TASKS_PATH, taskId)
  for (const projectId of world.projectIds) await deleteGeneralEntityIfExists(request, world.token, PROJECTS_PATH, projectId)
  await deleteGeneralEntityIfExists(request, world.token, CUSTOMERS_PATH, world.customerId)
  if (world.selfMemberCreated) {
    await deleteGeneralEntityIfExists(request, world.token, TEAM_MEMBERS_PATH, world.staffMemberId)
  }
}

function emptyWorld(token: string): World {
  return { token, customerId: null, staffMemberId: null, selfMemberCreated: false, projectIds: [], taskIds: [], entryIds: [] }
}

async function setUpEntryOnProjectA(
  request: APIRequestContext,
  world: World,
  stamp: string,
): Promise<{ projectA: string; projectB: string; taskOnA: string; entryId: string }> {
  await ensureSelfStaffMember(request, world, `QATT34 Member ${stamp}`)
  world.customerId = await readCreatedId(
    await apiRequest(request, 'POST', CUSTOMERS_PATH, { token: world.token, data: { displayName: `QATT34 Customer ${stamp}` } }),
    `POST ${CUSTOMERS_PATH}`,
  )
  const projectA = await createProject(request, world, `QATT34 Project A ${stamp}`, `QT34A-${stamp}`)
  const projectB = await createProject(request, world, `QATT34 Project B ${stamp}`, `QT34B-${stamp}`)
  const taskOnA = await createTask(request, world, projectA, `QATT34 Task A ${stamp}`)
  const entryId = await createEntry(request, world, taskOnA, `QATT34 entry ${stamp}`)
  expect(await readEntry(request, world.token, entryId)).toEqual({ taskId: taskOnA, timeProjectId: projectA })
  return { projectA, projectB, taskOnA, entryId }
}

test.describe('TC-TT-034: moving a time entry to another project drops the old project task', () => {
  test('a project-only PUT clears the task of the previous project', async ({ request }) => {
    const world = emptyWorld(await getAuthToken(request, 'admin'))
    try {
      const { projectB, entryId } = await setUpEntryOnProjectA(request, world, randomUUID().slice(0, 8))
      await moveEntryToProject(request, world.token, entryId, projectB)
      expect(
        await readEntry(request, world.token, entryId),
        'The task of project A must not stay on an entry billed under project B',
      ).toEqual({ taskId: null, timeProjectId: projectB })
    } finally {
      await cleanUp(request, world)
    }
  })

  test('undo of the project move restores both the project and the task', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const world = emptyWorld(await getAuthToken(request, 'admin'))
    try {
      const { projectA, projectB, taskOnA, entryId } = await setUpEntryOnProjectA(request, world, randomUUID().slice(0, 8))
      const undoToken = await moveEntryToProject(request, world.token, entryId, projectB)
      await undoOk(request, world.token, undoToken, 'undo the project move')
      expect(
        await readEntry(request, world.token, entryId),
        'Undo puts the entry back on project A with its task',
      ).toEqual({ taskId: taskOnA, timeProjectId: projectA })
    } finally {
      await cleanUp(request, world)
    }
  })
})
