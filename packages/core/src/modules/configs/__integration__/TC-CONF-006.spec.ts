import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

/**
 * TC-CONF-006: List pending upgrade actions
 * Source: issue #2465
 *
 * GET /api/configs/upgrade-actions returns the current app version and a (possibly
 * empty) list of pending upgrade actions; each action carries the expected
 * descriptor fields. Access requires configs.manage.
 */
test.describe('TC-CONF-006: Upgrade actions listing', () => {
  test('returns version and a well-formed actions array for an admin', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/configs/upgrade-actions', { token })
    expect(response.status(), 'admin should be allowed to list upgrade actions').toBe(200)

    const body = (await response.json()) as {
      version?: string
      actions?: Array<Record<string, unknown>>
    }
    expect(typeof body.version).toBe('string')
    expect((body.version as string).length).toBeGreaterThan(0)
    expect(Array.isArray(body.actions)).toBe(true)

    for (const action of body.actions as Array<Record<string, unknown>>) {
      expect(typeof action.id).toBe('string')
      expect(typeof action.version).toBe('string')
      expect(typeof action.message).toBe('string')
      expect(typeof action.ctaLabel).toBe('string')
      expect(typeof action.successMessage).toBe('string')
      expect(typeof action.loadingLabel).toBe('string')
    }
  })

  test('denies upgrade actions to a user without configs.manage', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'GET', '/api/configs/upgrade-actions', { token })
    expect(response.ok(), 'employee must not list upgrade actions').toBe(false)
    expect([400, 401, 403]).toContain(response.status())
  })

  test('reconciles existing CRM lookup maps once without overwriting custom field rules', async ({ request }) => {
    test.skip(
      parseBooleanToken(process.env.UPGRADE_ACTIONS_ENABLED ?? '') !== true,
      'The app must run with upgrade actions enabled.',
    )
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(token)
    const actionId = 'customers.seed-email-domain-hash-encryption-map'
    const path = '/api/configs/upgrade-actions'
    const organizationId = await createOrganizationFixture(request, token, {
      tenantId,
      name: `TC-CONF-006 ${randomUUID()}`,
    })
    const scope = { token, selectedOrgId: organizationId }
    const legacyMaps = [
      { entityId: 'customers:customer_company_profile', fields: [{ field: 'domain' }, { field: 'tax_id' }] },
      { entityId: 'customers:customer_deal', fields: [{ field: 'description' }] },
      { entityId: 'customers:customer_entity', fields: [{ field: 'primary_email' }, { field: 'description' }] },
    ]
    const readMaps = () => withClient(async (client) => {
      const result = await client.query<{
        entity_id: string
        fields_json: Array<{ field: string; hashField?: string }>
        is_active: boolean
        updated_at: Date
      }>(
        `select entity_id, fields_json, is_active, updated_at from encryption_maps
         where tenant_id = $1 and organization_id = $2 and entity_id = any($3::text[]) and deleted_at is null
         order by entity_id`,
        [tenantId, organizationId, legacyMaps.map(({ entityId }) => entityId)],
      )
      return result.rows
    })
    try {
      await withClient(async (client) => {
        for (const { entityId, fields } of legacyMaps) {
          await client.query(
            `insert into encryption_maps
               (entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at)
             values ($1, $2, $3, $4::jsonb, true, now(), now())
             on conflict (entity_id, tenant_id, organization_id) where deleted_at is null
             do update set fields_json = excluded.fields_json, is_active = true`,
            [entityId, tenantId, organizationId, JSON.stringify(fields)],
          )
        }
      })
      const before = await readMaps()
      const precedingActionIds = new Set<string>()
      while (true) {
        const response = await apiRequestWithSelectedOrg(request, 'GET', path, scope)
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ actions: Array<{ id: string; version: string; ctaLabel: string }> }>(response)
        const next = body?.actions[0]
        if (!next) throw new Error('[internal] CRM encryption map upgrade action was not offered')
        if (next.id === actionId) {
          expect(next.ctaLabel).toBeTruthy()
          break
        }
        expect(precedingActionIds.has(next.id)).toBe(false)
        precedingActionIds.add(next.id)
        await withClient(async (client) => {
          await client.query(
            `insert into upgrade_action_runs (action_id, version, tenant_id, organization_id, completed_at, created_at)
             values ($1, $2, $3, $4, now(), now())`,
            [next.id, next.version, tenantId, organizationId],
          )
        })
      }

      const run = () => apiRequestWithSelectedOrg(request, 'POST', path, { ...scope, data: { actionId } })
      const first = await run()
      expect(first.status()).toBe(200)
      expect(await readJsonSafe(first)).toMatchObject({ status: 'completed' })
      const after = await readMaps()
      expect(after).toEqual([
        expect.objectContaining({
          entity_id: 'customers:customer_company_profile',
          fields_json: [{ field: 'domain', hashField: 'domain_hash' }, { field: 'tax_id' }],
          is_active: true,
        }),
        before[1],
        expect.objectContaining({
          entity_id: 'customers:customer_entity',
          fields_json: [{ field: 'primary_email', hashField: 'primary_email_hash' }, { field: 'description' }],
          is_active: true,
        }),
      ])

      const second = await run()
      expect(second.status()).toBe(200)
      expect(await readJsonSafe(second)).toMatchObject({ status: 'already_completed' })
      expect(await readMaps()).toEqual(after)
    } finally {
      await withClient(async (client) => {
        await client.query('delete from upgrade_action_runs where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
        await client.query('delete from encryption_maps where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      })
      await deleteOrganizationIfExists(request, token, organizationId)
    }
  })
})
