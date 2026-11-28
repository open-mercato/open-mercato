import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createStaffTeamRoleFixture } from '@open-mercato/core/helpers/integration/staffFixtures'

const membersPath = '/api/staff/team-members'
const rolesPath = '/api/staff/team-roles'

test('TC-STAFF-8315: selecting either team role returns only its member', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const marker = randomUUID()
  const roleIds: string[] = []
  const memberIds: string[] = []

  try {
    for (const suffix of ['A', 'B']) {
      const roleId = await createStaffTeamRoleFixture(request, token, { name: `QA role ${suffix} ${marker}` })
      roleIds.push(roleId)
      const response = await apiRequest(request, 'POST', membersPath, {
        token,
        data: { displayName: `QA member ${suffix} ${marker}`, roleIds: [roleId] },
      })
      await expect(response).toBeOK()
      const body = await readJsonSafe<{ id: string }>(response)
      memberIds.push(expectId(body?.id, 'POST team-members should return a fixture id'))
    }

    const listIds = async (roleId?: string) => {
      const query = new URLSearchParams({ ids: memberIds.join(',') })
      if (roleId) query.set('roleId', roleId)
      const response = await apiRequest(request, 'GET', `${membersPath}?${query}`, { token })
      await expect(response).toBeOK()
      const body = await readJsonSafe<{ items: { id: string }[] }>(response)
      expect(body?.items).toBeInstanceOf(Array)
      return body?.items.map(({ id }) => id) ?? []
    }

    expect((await listIds()).sort()).toEqual([...memberIds].sort())
    expect(await listIds(roleIds[0])).toEqual([memberIds[0]])
    expect(await listIds(roleIds[1])).toEqual([memberIds[1]])
  } finally {
    const deleteFixtures = (path: string, ids: string[]) => Promise.allSettled(ids.map((id) =>
      apiRequest(request, 'DELETE', `${path}?id=${id}`, { token }),
    ))
    const deletedMembers = await deleteFixtures(membersPath, memberIds)
    const deletedRoles = await deleteFixtures(rolesPath, roleIds)
    for (const result of [...deletedMembers, ...deletedRoles]) {
      if (result.status === 'rejected') throw result.reason
      await expect(result.value).toBeOK()
    }
  }
})
