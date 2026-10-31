import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  QUEUE_STATUS_TEST_QUEUE,
  cleanupTestJobs,
  createInspectorUser,
  openTestQueue,
  uniqueMarker,
} from './helpers/queueStatusFixtures'

type InspectorResponse = {
  crossTenant: boolean
  jobs: Array<{ id: string; state?: string; type?: string; tenantId: string | null; organizationId?: string | null; data: unknown }>
}

const INSPECTOR_PATH = '/api/configs/queues-status/jobs'

/**
 * TC-CONF-008: Job Inspector (Tier 2) — GET /api/configs/queues-status/jobs
 * Source: issue #3105
 *
 * Covers the dispatcher feature gate, own- vs foreign-tenant list and direct-id reads for a
 * tenant-scoped inspector (including the nested `scope` envelope of communication_channels
 * producers), the superadmin cross-tenant view, redaction and the access-log row (also while an
 * organization is selected). Jobs come from the real enqueue path of the strategy under test.
 */
test.describe('TC-CONF-008: Job Inspector (Tier 2)', () => {
  test('denies callers without configs.queues_status.inspect_payloads', async ({ request }) => {
    const anonymous = await request.fetch(`${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}`, { method: 'GET' })
    expect([401, 403]).toContain(anonymous.status())

    // `admin` holds `.view` but deliberately not the Tier 2 feature.
    const adminToken = await getAuthToken(request, 'admin')
    const denied = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}`, { token: adminToken })
    expect(denied.status()).toBe(403)
  })

  test('a tenant-scoped inspector sees own-tenant jobs (top-level and nested scope), never a foreign tenant, and gets redacted payloads', async ({ request }) => {
    const inspector = await createInspectorUser(request, 'tc-conf-008')
    const queue = openTestQueue()
    const foreignTenantId = randomUUID()
    const marker = uniqueMarker('tc-conf-008')
    const topLevelType = `${marker}-top`
    const nestedType = `${marker}-nested`
    const foreignType = `${marker}-foreign`
    try {
      const ownTopLevelId = await queue.enqueue({ tenantId: inspector.tenantId, organizationId: inspector.organizationId, jobType: topLevelType, apiKey: 'sk_live_topsecretvalue', note: 'visible-note' })
      const ownNestedId = await queue.enqueue(
        { scope: { tenantId: inspector.tenantId, organizationId: inspector.organizationId }, raw: { body: 'hello' } },
        { jobType: nestedType },
      )
      const foreignId = await queue.enqueue({ tenantId: foreignTenantId, jobType: foreignType, note: 'foreign-note' })

      const listing = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}&limit=100`, { token: inspector.token })
      expect(listing.status()).toBe(200)
      const list = (await readJsonSafe<InspectorResponse>(listing)) as InspectorResponse
      const ids = list.jobs.map((job) => job.id)
      expect(ids).toContain(ownTopLevelId)
      expect(ids, 'a nested scope.tenantId job belongs to its tenant, not to nobody').toContain(ownNestedId)
      expect(ids, 'a foreign tenant job never appears in a list read').not.toContain(foreignId)
      expect(list.crossTenant).toBe(false)
      expect(JSON.stringify(list)).not.toContain('sk_live_topsecretvalue')
      expect(JSON.stringify(list)).not.toContain('foreign-note')

      const topLevel = list.jobs.find((job) => job.id === ownTopLevelId)
      expect(topLevel?.tenantId).toBe(inspector.tenantId)
      expect(topLevel?.type).toBe(topLevelType)
      expect(JSON.stringify(topLevel?.data)).toContain('visible-note')

      const ownById = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}&id=${ownNestedId}`, { token: inspector.token })
      const own = (await readJsonSafe<InspectorResponse>(ownById)) as InspectorResponse
      expect(own.jobs.map((job) => job.id)).toEqual([ownNestedId])
      // A direct id resolves the job's actual state without a state query.
      expect(own.jobs[0].state).toMatch(/^(waiting|delayed|active)$/)
      expect(own.jobs[0].tenantId).toBe(inspector.tenantId)

      const foreignById = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}&id=${foreignId}`, { token: inspector.token })
      expect(foreignById.status()).toBe(200)
      expect(((await readJsonSafe<InspectorResponse>(foreignById)) as InspectorResponse).jobs, 'foreign direct id is fail-closed').toEqual([])
    } finally {
      await cleanupTestJobs(queue, [inspector.tenantId, foreignTenantId])
      await inspector.cleanup()
    }
  })

  test('a superadmin sees foreign-tenant jobs labelled with their tenant', async ({ request }) => {
    const queue = openTestQueue()
    const foreignTenantId = randomUUID()
    const type = uniqueMarker('tc-conf-008-root')
    try {
      const foreignId = await queue.enqueue({ scope: { tenantId: foreignTenantId, organizationId: null }, jobType: type })
      const superadminToken = await getAuthToken(request, 'superadmin')

      const response = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}&type=${encodeURIComponent(type)}`, { token: superadminToken })
      expect(response.status()).toBe(200)
      const body = (await readJsonSafe<InspectorResponse>(response)) as InspectorResponse

      expect(body.crossTenant).toBe(true)
      expect(body.jobs.map((job) => [job.id, job.tenantId])).toEqual([[foreignId, foreignTenantId]])
    } finally {
      await cleanupTestJobs(queue, [foreignTenantId])
    }
  })

  test('every inspector read is written to the access log, visible while an organization is selected', async ({ request }) => {
    const inspector = await createInspectorUser(request, 'tc-conf-008-audit')
    const queue = openTestQueue()
    const type = uniqueMarker('tc-conf-008-audit')
    try {
      await queue.enqueue({ tenantId: inspector.tenantId, organizationId: inspector.organizationId, jobType: type })

      const read = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}&type=${encodeURIComponent(type)}`, { token: inspector.token })
      expect(read.status()).toBe(200)

      const log = await apiRequestWithSelectedOrg(
        request,
        'GET',
        '/api/audit_logs/audit-logs/access?accessType=configs.queues_status.inspect_payloads&pageSize=50',
        { token: inspector.token, selectedOrgId: inspector.organizationId },
      )
      // The inspector holds no audit_logs feature; fall back to the superadmin's view of the same row.
      const viewerToken = log.status() === 200 ? inspector.token : await getAuthToken(request, 'superadmin')
      const viewer = log.status() === 200
        ? log
        : await apiRequestWithSelectedOrg(
          request,
          'GET',
          `/api/audit_logs/audit-logs/access?accessType=configs.queues_status.inspect_payloads&pageSize=50&organizationId=${inspector.organizationId}`,
          { token: viewerToken, selectedOrgId: getTokenContext(viewerToken).organizationId || inspector.organizationId },
        )
      expect(viewer.status()).toBe(200)
      const items = ((await readJsonSafe<{ items: Array<{ resourceKind: string; resourceId: string; organizationId: string | null }> }>(viewer))?.items) ?? []
      const row = items.find((item) => item.resourceKind === 'queue.job' && item.resourceId === QUEUE_STATUS_TEST_QUEUE)
      expect(row, 'the inspector read is audited').toBeDefined()
      expect(row?.organizationId, 'the row carries the actor organization so an org filter still matches it').toBe(inspector.organizationId)
    } finally {
      await cleanupTestJobs(queue, [inspector.tenantId])
      await inspector.cleanup()
    }
  })

  test('rejects invalid inspector queries with 400 and treats an unregistered queue as empty', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')

    const missingQueue = await apiRequest(request, 'GET', INSPECTOR_PATH, { token: superadminToken })
    expect(missingQueue.status()).toBe(400)

    const zeroLimit = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=${QUEUE_STATUS_TEST_QUEUE}&limit=0`, { token: superadminToken })
    expect(zeroLimit.status(), 'a zero window is rejected, never forwarded to the backend').toBe(400)

    const unregistered = await apiRequest(request, 'GET', `${INSPECTOR_PATH}?queue=not-a-registered-queue`, { token: superadminToken })
    expect(unregistered.status()).toBe(200)
    expect(await readJsonSafe(unregistered)).toEqual({ jobs: [], crossTenant: false })
  })
})
