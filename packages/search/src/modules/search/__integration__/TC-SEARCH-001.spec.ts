import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

type EventPayload = {
  id: string
  payload: Record<string, unknown>
  timestamp: number
  organizationId: string
}

test.describe('TC-SEARCH-001: search reindex SSE refresh behavior', () => {
  test('refreshes reindex state from SSE progress events and reconnect without periodic polling', async ({ page }) => {
    const requestCounts = {
      settings: 0,
      embeddings: 0,
    }

    const onRequest = (rawRequest: { url: () => string; method: () => string }) => {
      if (rawRequest.method() !== 'GET') return
      const url = rawRequest.url()
      if (url.includes('/api/search/settings')) {
        requestCounts.settings += 1
      }
      if (url.includes('/api/search/embeddings')) {
        requestCounts.embeddings += 1
      }
    }

    const emitAppEvent = async (detail: EventPayload) => {
      await page.evaluate((eventDetail) => {
        window.dispatchEvent(new CustomEvent('om:event', { detail: eventDetail }))
      }, detail)
    }

    try {
      await login(page, 'superadmin')
      page.on('request', onRequest)
      await page.goto('/backend/config/search')
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByRole('heading', { name: 'Search Settings' })).toBeVisible()

      await page.waitForTimeout(2_000)
      const baseline = { ...requestCounts }

      await emitAppEvent({
        id: 'search.reindex.fulltext.progress',
        payload: {
          status: 'running',
          tenantId: 'test-tenant',
          operationId: 'search.reindex.fulltext:test-tenant',
        },
        timestamp: Date.now(),
        organizationId: 'org',
      })

      await expect.poll(() => requestCounts.settings, { timeout: 15_000 }).toBeGreaterThan(baseline.settings)
      const afterFulltext = { ...requestCounts }

      await emitAppEvent({
        id: 'search.reindex.vector.progress',
        payload: {
          status: 'running',
          tenantId: 'test-tenant',
          operationId: 'search.reindex.vector:test-tenant',
        },
        timestamp: Date.now(),
        organizationId: 'org',
      })

      await expect.poll(() => requestCounts.embeddings, { timeout: 15_000 }).toBeGreaterThan(afterFulltext.embeddings)
      const afterVector = { ...requestCounts }

      await page.waitForTimeout(6_000)
      expect(requestCounts.settings).toBe(afterVector.settings)
      expect(requestCounts.embeddings).toBe(afterVector.embeddings)

      await emitAppEvent({
        id: 'om:bridge:reconnected',
        payload: {},
        timestamp: Date.now(),
        organizationId: 'org',
      })

      await expect.poll(() => requestCounts.settings, { timeout: 15_000 }).toBeGreaterThan(afterVector.settings)
      await expect.poll(() => requestCounts.embeddings, { timeout: 15_000 }).toBeGreaterThan(afterVector.embeddings)
    } finally {
      page.off('request', onRequest)
    }
  })
})
