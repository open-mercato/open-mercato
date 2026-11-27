import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['configs'] }

type UpgradeActionsList = { version?: unknown; actions?: Array<{ id?: unknown }> }
type UpgradeActionError = { error?: unknown; details?: unknown }

const OWNED_ACTIONS: Array<{ moduleId: string; actionId: string; probePath: string }> = [
  { moduleId: 'customers', actionId: 'customers.seed-interaction-statuses', probePath: '/api/customers/people?pageSize=1' },
  { moduleId: 'attachments', actionId: 'attachments.reconcile-organization', probePath: '/api/attachments/library?pageSize=1' },
]

async function isModuleEnabled(request: APIRequestContext, token: string, probePath: string): Promise<boolean> {
  const probe = await apiRequest(request, 'GET', probePath, { token })
  return probe.status() !== 404
}

async function listUpgradeActions(request: APIRequestContext, token: string): Promise<UpgradeActionsList> {
  const response = await apiRequest(request, 'GET', '/api/configs/upgrade-actions', { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<UpgradeActionsList>(response)
  expect(typeof body?.version).toBe('string')
  expect(Array.isArray(body?.actions)).toBe(true)
  return body ?? {}
}

test.describe('TC-CONF-9191: upgrade actions are gated on their owning modules', () => {
  test('the list answers 200 and an unknown action is rejected as not available', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    await listUpgradeActions(request, token)

    const unknown = await apiRequest(request, 'POST', '/api/configs/upgrade-actions', {
      token,
      data: { actionId: `qa.unknown-action-${Date.now()}` },
    })
    test.skip(unknown.status() === 403, 'Upgrade actions are disabled (UPGRADE_ACTIONS_ENABLED is off)')
    expect(unknown.status()).toBe(500)
    const body = await readJsonSafe<UpgradeActionError>(unknown)
    expect(body?.details).toBe('UPGRADE_ACTION_NOT_AVAILABLE')
  })

  for (const owned of OWNED_ACTIONS) {
    test(`${owned.actionId} is neither listed nor executable without ${owned.moduleId}`, async ({ request }) => {
      const token = await getAuthToken(request, 'superadmin')
      test.skip(
        await isModuleEnabled(request, token, owned.probePath),
        `Requires an app without the optional ${owned.moduleId} module`,
      )

      const list = await listUpgradeActions(request, token)
      const listedIds = (list.actions ?? []).map((action) => action.id)
      expect(listedIds).not.toContain(owned.actionId)

      const execute = await apiRequest(request, 'POST', '/api/configs/upgrade-actions', {
        token,
        data: { actionId: owned.actionId },
      })
      test.skip(execute.status() === 403, 'Upgrade actions are disabled (UPGRADE_ACTIONS_ENABLED is off)')
      expect(execute.status()).toBe(500)
      const body = await readJsonSafe<UpgradeActionError>(execute)
      expect(body?.details).toBe('UPGRADE_ACTION_NOT_AVAILABLE')
    })
  }
})
