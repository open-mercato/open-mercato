import { expect, type APIRequestContext, type Locator } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { Cleanup, addProjectMember, createProject, createStaffPerson, deleteTask } from '../support/fixtures'

export async function createIssue8204DrawerFixture(request: APIRequestContext, token: string, cleanup: Cleanup) {
  const project = await createProject(request, token, cleanup, 'issue8204')
  const actor = await createStaffPerson(request, token, cleanup, 'issue8204', ['admin'])
  await addProjectMember(request, token, project.id, actor.staffMemberId, { isAssigner: true })
  const title = `QA issue 8204 task ${Date.now()}`
  const response = await apiRequest(request, 'POST', '/api/staff/timesheets/tasks', {
    token,
    data: { timeProjectId: project.id, title },
  })
  expect(response.status()).toBe(201)
  const taskId = ((await response.json()) as { id: string }).id
  cleanup.add(() => deleteTask(request, token, taskId))
  const unassigned = await apiRequest(request, 'PUT', '/api/staff/timesheets/tasks', {
    token,
    data: { id: taskId, assigneeStaffMemberId: null },
  })
  expect(unassigned.ok()).toBeTruthy()
  return { project, actor, taskId, title }
}

export async function expectIssue8204NoticeInView(notice: Locator, drawer: Locator) {
  await expect(notice).toHaveAttribute('role', 'alert')
  await expect(notice).toBeFocused()
  await expect(notice).toBeInViewport({ ratio: 1 })
  await expect.poll(async () => (await notice.boundingBox())!.y).toBeGreaterThanOrEqual(0)
  const message = (await notice.boundingBox())!
  const container = (await drawer.locator('[data-slot="drawer-body"]').boundingBox())!
  expect(message.y).toBeGreaterThanOrEqual(container.y)
  expect(message.y + message.height).toBeLessThanOrEqual(container.y + container.height)
}
