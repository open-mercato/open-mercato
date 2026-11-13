import { test, expect, type BrowserContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { get as requestHttp } from 'node:http'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { startRlsLiveRuntime, type RlsLiveRuntime } from './helpers/liveRuntime'

const evidenceSchema = z.array(z.object({
  requestId: z.string(), phase: z.enum(['started', 'queried', 'rejected', 'completed']),
  active: z.boolean(), tenantId: z.string().optional(), invocationMatches: z.boolean().optional(),
}))
const resultSchema = z.object({
  tenantId: z.string(), invocationMatches: z.literal(true),
  rows: z.array(z.object({ id: z.string(), tenantId: z.string(), configuredTenant: z.string() })),
})

async function evidence(runtime: RlsLiveRuntime) {
  let body: string
  try { body = await readFile(runtime.evidenceFile, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return evidenceSchema.parse(body.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown))
}

test.describe('TC-RLS-001: deferred request lifetime on the real Next application', () => {
  let runtime: RlsLiveRuntime

  test.beforeAll(async () => { runtime = await startRlsLiveRuntime() })
  test.afterAll(async () => { await runtime?.stop() })
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus && runtime) {
      await testInfo.attach('restricted-server-log', { body: await runtime.serverLog(), contentType: 'text/plain' })
    }
  })

  test('keeps concurrent deferred staff renders isolated and revokes completed invocations', async ({ browser }) => {
    const contexts: BrowserContext[] = []
    try {
      const results = await Promise.all([runtime.first, runtime.second].map(async (actor) => {
        const requestId = randomUUID()
        const context = await browser.newContext({
          extraHTTPHeaders: {
            'x-rls-probe-id': requestId, 'x-rls-probe-record-ids': JSON.stringify([runtime.first.customerId, runtime.second.customerId]),
            'x-rls-probe-delay': '25',
          },
        })
        contexts.push(context)
        await context.addCookies([{ name: 'auth_token', value: actor.token, url: runtime.baseUrl }])
        const page = await context.newPage()
        await page.goto(runtime.baseUrl + '/backend/tenant-boundaries/integration-probe')
        await expect(page.getByTestId('tenant-boundary-probe')).toBeVisible()
        const result = resultSchema.parse(JSON.parse(await page.getByTestId('tenant-boundary-probe').innerText()))
        expect(result.tenantId).toBe(actor.tenantId)
        expect(result.rows).toEqual([{ id: actor.customerId, tenantId: actor.tenantId, configuredTenant: actor.tenantId }])
        await expect.poll(async () => (await evidence(runtime)).find((entry) => entry.requestId === requestId && entry.phase === 'completed')?.active).toBe(false)
        return result.tenantId
      }))
      expect(new Set(results).size).toBe(2)
    } finally { await Promise.all(contexts.map((context) => context.close())) }
  })

  test('chooses portal identity with both cookies and staff selected tenant after canonical actor validation', async ({ browser }, testInfo) => {
    const headers = { 'x-rls-probe-id': randomUUID(), 'x-rls-probe-record-ids': JSON.stringify([runtime.first.customerId, runtime.second.customerId]) }
    const context = await browser.newContext({ extraHTTPHeaders: headers })
    try {
      await context.addCookies([
        { name: 'auth_token', value: runtime.first.token, url: runtime.baseUrl },
        { name: 'customer_auth_token', value: runtime.customerToken, url: runtime.baseUrl },
      ])
      const page = await context.newPage()
      await page.goto(`${runtime.baseUrl}/${runtime.second.slug}/portal/tenant-boundaries-probe`)
      await expect(page.getByTestId('tenant-boundary-probe')).toBeVisible()
      const portal = resultSchema.parse(JSON.parse(await page.getByTestId('tenant-boundary-probe').innerText()))
      expect(portal.rows.map((row) => row.id)).toEqual([runtime.second.customerId])
      expect(portal.tenantId).toBe(runtime.second.tenantId)
      await page.screenshot({ path: testInfo.outputPath('rls-portal-deferred.png'), fullPage: true })
      await context.addCookies([
        { name: 'auth_token', value: runtime.selectedAdmin.token, url: runtime.baseUrl },
        { name: 'om_selected_tenant', value: runtime.second.tenantId, url: runtime.baseUrl },
        { name: 'om_selected_org', value: runtime.second.orgId, url: runtime.baseUrl },
      ])
      await page.goto(runtime.baseUrl + '/backend/tenant-boundaries/integration-probe')
      await expect(page.getByTestId('tenant-boundary-probe')).toBeVisible()
      const selected = resultSchema.parse(JSON.parse(await page.getByTestId('tenant-boundary-probe').innerText()))
      expect(selected.rows.map((row) => row.id)).toEqual([runtime.second.customerId])
      expect(selected.tenantId).toBe(runtime.second.tenantId)
      await page.screenshot({ path: testInfo.outputPath('rls-selected-tenant-deferred.png'), fullPage: true })
    } finally { await context.close() }
  })

  test('revokes a canceled streamed render before its delayed canary query', async () => {
    const requestId = randomUUID()
    const pending = requestHttp(runtime.baseUrl + '/backend/tenant-boundaries/integration-probe', {
      headers: {
        cookie: `auth_token=${runtime.first.token}`, 'x-rls-probe-id': requestId,
        'x-rls-probe-record-ids': JSON.stringify([runtime.first.customerId, runtime.second.customerId]), 'x-rls-probe-delay': '1000',
      },
    }, (response) => response.resume())
    pending.on('error', () => undefined)
    try {
      await expect.poll(async () => (await evidence(runtime)).some((entry) => entry.requestId === requestId && entry.phase === 'started')).toBe(true)
      pending.destroy()
      await expect.poll(async () => (await evidence(runtime)).find((entry) => entry.requestId === requestId && entry.phase === 'completed')?.active).toBe(false)
      const entries = (await evidence(runtime)).filter((entry) => entry.requestId === requestId)
      expect(entries.some((entry) => entry.phase === 'queried')).toBe(false)
    } finally { pending.destroy() }
  })
})
