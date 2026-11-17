import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

export const integrationMeta = { dependsOnModules: ['auth', 'audit_logs'] }

for (const canUndo of [false, true]) {
  test(`last-operation banner respects undo permission: ${canUndo}`, async ({ page, request, baseURL }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = randomUUID()
    const email = `undo-banner-${stamp}@example.com`
    const password = `Aa1!${randomUUID()}`
    let actorRoleId: string | null = null
    let actorUserId: string | null = null
    let createdRoleId: string | null = null
    try {
      actorRoleId = await createRoleFixture(request, adminToken, { name: `undo-banner-actor-${stamp}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId: actorRoleId,
        features: ['auth.roles.list', 'auth.roles.manage', ...(canUndo ? ['audit_logs.undo_self'] : [])],
      })
      actorUserId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [actorRoleId] })
      const actorToken = await getAuthToken(request, email, password)
      await page.context().addCookies([{ name: 'auth_token', value: actorToken, url: baseURL! }])
      await acknowledgeGlobalNotices(page)
      const response = await apiRequest(request, 'POST', '/api/auth/roles', {
        token: actorToken,
        data: { name: `undo-banner-created-${stamp}` },
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      createdRoleId = body?.id ?? null
      expect(response.status()).toBe(201)
      expect(createdRoleId).toBeTruthy()
      const operation = deserializeOperationMetadata(response.headers()['x-om-operation'])
      expect(operation).not.toBeNull()
      await page.addInitScript((entry) => {
        window.localStorage.setItem('om:last-operations:v1', JSON.stringify({
          stack: [{ ...entry, receivedAt: Date.now() }],
          undone: [],
        }))
      }, operation)
      const chromeResponse = page.waitForResponse((candidate) => candidate.url().includes('/api/auth/admin/nav') && candidate.request().method() === 'GET')
      await page.goto('/backend/roles')
      await chromeResponse
      await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
      const undo = page.getByRole('button', { name: /^(Undo|Cofnij)$/ })
      if (canUndo) {
        await expect(undo).toBeVisible()
      } else {
        await expect(undo).toHaveCount(0)
        const denied = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
          token: actorToken,
          data: { undoToken: operation!.undoToken },
        })
        expect(denied.status()).toBe(403)
      }
    } finally {
      await deleteRoleIfExists(request, adminToken, createdRoleId)
      await deleteUserIfExists(request, adminToken, actorUserId)
      await deleteRoleIfExists(request, adminToken, actorRoleId)
    }
  })
}
