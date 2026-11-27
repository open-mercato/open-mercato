import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { resolveIntegrationDatabaseUrl, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoByLogId, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['eudr', 'audit_logs', 'customers'] }

test('TC-EUDR-021: redo waits for a competing edit and consistently refuses to overwrite it', async ({ request }) => {
  skipIfUndoTestsDisabled()
  const token = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(token)
  const holder = new Client({ connectionString: resolveIntegrationDatabaseUrl() })
  let connected = false
  let supplierId: string | null = null
  let plotId: string | null = null
  let pendingRedo: Promise<APIResponse> | null = null

  try {
    supplierId = await createCompanyFixture(request, token, `TC-EUDR-021 supplier ${randomUUID()}`)
    const create = await apiRequest(request, 'POST', '/api/eudr/plots', {
      token,
      data: { supplierEntityId: supplierId, name: 'Original plot', originCountry: 'CI', geometry: { type: 'Point', coordinates: [-5.3, 6.8] }, areaHa: 1 },
    })
    expect(create.status()).toBe(201)
    plotId = expectId((await readJsonSafe<{ id?: string }>(create))?.id, 'Plot fixture')
    const update = await apiRequest(request, 'PUT', '/api/eudr/plots', { token, data: { id: plotId, name: 'My update' } })
    expect(update.status()).toBe(200)
    const operation = expectOperation(update, 'plot update')
    await undoOk(request, token, operation.undoToken, 'plot update')

    await holder.connect()
    connected = true
    const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
    await holder.query('begin')
    const changed = await holder.query(
      'update eudr_plots set name = $1, updated_at = clock_timestamp() where id = $2 and tenant_id = $3 and organization_id = $4 returning id',
      ['Competing committed update', plotId, tenantId, organizationId],
    )
    expect(changed.rowCount).toBe(1)

    pendingRedo = redoByLogId(request, token, operation.logId)
    await expect.poll(() => withClient(async (observer) => {
      const waiting = await observer.query<{ count: number }>(
        `select count(*)::int as count from pg_stat_activity
          where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))
          and query ilike '%eudr_plots%' and query ilike '%for update%'`,
        [holderPid],
      )
      return waiting.rows[0].count
    }), { message: 'redo must wait while refreshing the row under its pessimistic lock' }).toBeGreaterThan(0)

    await holder.query('commit')
    const redo = await pendingRedo
    expect(redo.status()).toBe(409)
    expect((await readJsonSafe<{ code?: string }>(redo))?.code).toBe('eudr.errors.redoConflict')

    const retry = await redoByLogId(request, token, operation.logId)
    expect(retry.status()).toBe(409)
    expect((await readJsonSafe<{ code?: string }>(retry))?.code).toBe('eudr.errors.redoConflict')
    const read = await apiRequest(request, 'GET', `/api/eudr/plots?id=${encodeURIComponent(plotId)}`, { token })
    expect(read.status()).toBe(200)
    const body = await readJsonSafe<{ items?: Array<{ id: string; name: string }> }>(read)
    expect(body?.items?.find((plot) => plot.id === plotId)?.name).toBe('Competing committed update')
  } finally {
    if (connected) {
      await holder.query('rollback').catch(() => undefined)
      if (pendingRedo) await pendingRedo.catch(() => undefined)
      await holder.end()
    }
    if (plotId) await apiRequest(request, 'DELETE', `/api/eudr/plots?id=${encodeURIComponent(plotId)}`, { token })
    if (supplierId) await apiRequest(request, 'DELETE', `/api/customers/companies?id=${encodeURIComponent(supplierId)}`, { token })
  }
})
