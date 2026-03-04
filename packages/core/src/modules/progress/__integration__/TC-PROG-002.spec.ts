import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  getCapturedOmEvents,
  installOmEventCollector,
} from '@open-mercato/core/modules/core/__integration__/helpers/sseEventCollector'

async function hasEvent(
  page: Page,
  eventId: string,
  jobId: string,
): Promise<boolean> {
  const events = await getCapturedOmEvents(page)
  return events.some((event) => {
    if (event.id !== eventId) return false
    const payload = event.payload
    if (!payload || typeof payload !== 'object') return false
    return payload.jobId === jobId
  })
}

test.describe('TC-PROG-002: Progress SSE events', () => {
  test('emits progress.job.updated to authenticated user via SSE bridge', async ({ page, request }) => {
    await login(page, 'admin')
    await page.goto('/backend')
    await page.waitForLoadState('domcontentloaded')
    await installOmEventCollector(page)

    const token = await getAuthToken(request, 'admin')

    const createRes = await apiRequest(request, 'POST', '/api/progress/jobs', {
      token,
      data: {
        jobType: 'integration.progress.sse',
        name: 'Integration progress SSE job',
        totalCount: 10,
        cancellable: true,
      },
    })
    expect(createRes.ok()).toBeTruthy()
    const createBody = await createRes.json() as { id: string }
    const jobId = createBody.id

    try {
      const updateRes = await apiRequest(request, 'PUT', `/api/progress/jobs/${jobId}`, {
        token,
        data: { processedCount: 4, totalCount: 10 },
      })
      expect(updateRes.ok()).toBeTruthy()

      await expect
        .poll(async () => hasEvent(page, 'progress.job.updated', jobId), { timeout: 8_000 })
        .toBe(true)
    } finally {
      await apiRequest(request, 'DELETE', `/api/progress/jobs/${jobId}`, { token }).catch(() => undefined)
    }
  })
})
