import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['configs', 'customers'] }

/**
 * TC-CONF-010: module-owned upgrade actions through the banner API
 * Spec: .ai/specs/2026-11-23-module-owned-upgrade-actions.md
 *
 * The catalog now comes from each module's `upgrades.ts`. The banner contract —
 * oldest pending action first, translated labels, `{ status }` on apply — and the
 * `(version, action_id, organization_id, tenant_id)` completion ledger must be
 * unchanged. Every row this test writes lives in a fixture organization and is
 * removed in `finally`.
 */

const ACTION_ID = 'customers.seed-interaction-statuses'

type ListedAction = { id: string; version: string; message: string; ctaLabel: string; successMessage: string; loadingLabel: string }
type UpgradeActionsList = { version?: string; actions?: ListedAction[] }

async function listFor(request: APIRequestContext, token: string, organizationId: string): Promise<UpgradeActionsList> {
  const response = await apiRequestWithSelectedOrg(request, 'GET', '/api/configs/upgrade-actions', { token, selectedOrgId: organizationId })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<UpgradeActionsList>(response)) ?? {}
}

async function ledgerRows(tenantId: string, actionId: string): Promise<Array<{ organization_id: string; version: string }>> {
  return withClient(async (client) => {
    const result = await client.query<{ organization_id: string; version: string }>(
      'select organization_id, version from upgrade_action_runs where tenant_id = $1 and action_id = $2 order by organization_id',
      [tenantId, actionId],
    )
    return result.rows
  })
}

async function cleanupOrganization(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  await withClient(async (client) => {
    await client.query('delete from upgrade_action_runs where organization_id = $1', [organizationId])
    await client.query('delete from dictionary_entries where organization_id = $1', [organizationId])
    await client.query('delete from dictionaries where organization_id = $1', [organizationId])
  })
  await deleteOrganizationInDb(organizationId)
}

async function upgradeActionsEnabled(request: APIRequestContext, token: string): Promise<boolean> {
  const probe = await apiRequest(request, 'POST', '/api/configs/upgrade-actions', { token, data: { actionId: 'qa.probe' } })
  return probe.status() !== 403
}

test.describe('TC-CONF-010: module-owned upgrade actions via the banner API', () => {
  test('keeps the disabled contract when UPGRADE_ACTIONS_ENABLED is off', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    test.skip(await upgradeActionsEnabled(request, token), 'Upgrade actions are enabled on this instance')

    const list = await apiRequest(request, 'GET', '/api/configs/upgrade-actions', { token })
    expect(list.status()).toBe(200)
    const body = await readJsonSafe<UpgradeActionsList>(list)
    expect(typeof body?.version).toBe('string')
    expect(body?.actions).toEqual([])

    const apply = await apiRequest(request, 'POST', '/api/configs/upgrade-actions', { token, data: { actionId: ACTION_ID } })
    expect(apply.status()).toBe(403)
  })

  test('applies a module-owned action once per organization through the same ledger', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    test.skip(!(await upgradeActionsEnabled(request, token)), 'Upgrade actions are disabled (UPGRADE_ACTIONS_ENABLED is off)')
    const { tenantId, organizationId: homeOrganizationId } = getTokenContext(token)

    let fixtureOrganizationId: string | null = null
    try {
      fixtureOrganizationId = await createOrganizationInDb({ name: `QA upgrade actions ${Date.now()}`, tenantId })
      const otherOrganizationRowsBefore = (await ledgerRows(tenantId, ACTION_ID)).filter(
        (row) => row.organization_id !== fixtureOrganizationId,
      )

      const pending = await listFor(request, token, fixtureOrganizationId)
      const first = pending.actions?.[0]
      expect(first, 'a fresh organization has at least one pending action').toBeDefined()
      expect(first?.message.length).toBeGreaterThan(0)
      expect(first?.message).not.toContain('.upgradeActions.')
      expect(first?.ctaLabel).not.toContain('.upgradeActions.')

      const apply = await apiRequestWithSelectedOrg(request, 'POST', '/api/configs/upgrade-actions', {
        token,
        selectedOrgId: fixtureOrganizationId,
        data: { actionId: ACTION_ID },
      })
      expect(apply.status()).toBe(200)
      const applied = await readJsonSafe<{ status?: string; message?: string; version?: string }>(apply)
      expect(applied?.status).toBe('completed')
      expect(applied?.message?.length).toBeGreaterThan(0)

      const again = await apiRequestWithSelectedOrg(request, 'POST', '/api/configs/upgrade-actions', {
        token,
        selectedOrgId: fixtureOrganizationId,
        data: { actionId: ACTION_ID },
      })
      expect(again.status()).toBe(200)
      expect((await readJsonSafe<{ status?: string }>(again))?.status).toBe('already_completed')

      const rows = await ledgerRows(tenantId, ACTION_ID)
      expect(rows.filter((row) => row.organization_id === fixtureOrganizationId)).toHaveLength(1)
      expect(rows.filter((row) => row.organization_id !== fixtureOrganizationId)).toEqual(otherOrganizationRowsBefore)

      const refreshed = await listFor(request, token, fixtureOrganizationId)
      expect((refreshed.actions ?? []).map((action) => action.id)).not.toContain(ACTION_ID)

      const next = refreshed.actions?.[0]
      if (next) {
        await withClient(async (client) => {
          await client.query(
            `insert into upgrade_action_runs (id, version, action_id, organization_id, tenant_id, completed_at, created_at)
             values (gen_random_uuid(), $1, $2, $3, $4, now(), now())`,
            [next.version, next.id, fixtureOrganizationId, tenantId],
          )
        })
        const suppressed = await listFor(request, token, fixtureOrganizationId)
        expect((suppressed.actions ?? []).map((action) => action.id)).not.toContain(next.id)
      }

      expect(homeOrganizationId).not.toBe(fixtureOrganizationId)
    } finally {
      await cleanupOrganization(fixtureOrganizationId)
    }
  })

  test('still rejects an unknown action and denies callers without configs.manage', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const denied = await apiRequest(request, 'GET', '/api/configs/upgrade-actions', { token: employeeToken })
    expect(denied.ok()).toBe(false)
    expect([401, 403]).toContain(denied.status())

    const token = await getAuthToken(request, 'superadmin')
    test.skip(!(await upgradeActionsEnabled(request, token)), 'Upgrade actions are disabled (UPGRADE_ACTIONS_ENABLED is off)')
    const unknown = await apiRequest(request, 'POST', '/api/configs/upgrade-actions', {
      token,
      data: { actionId: `qa.unknown-${Date.now()}` },
    })
    expect(unknown.status()).toBe(500)
    expect((await readJsonSafe<{ details?: string }>(unknown))?.details).toBe('UPGRADE_ACTION_NOT_AVAILABLE')
  })
})
