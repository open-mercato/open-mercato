import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

const OM_EVENT_NAME = 'om:event'

type CapturedEvent = {
  id: string
  payload?: Record<string, unknown>
}

async function installCollector(page: Page): Promise<void> {
  await page.evaluate((eventName) => {
    ;(window as unknown as { __capturedOmEvents?: CapturedEvent[] }).__capturedOmEvents = []
    window.addEventListener(eventName, (event: Event) => {
      const detail = (event as CustomEvent<CapturedEvent>).detail
      if (!detail || typeof detail !== 'object') return
      const store = (window as unknown as { __capturedOmEvents?: CapturedEvent[] }).__capturedOmEvents
      if (!store) return
      store.push(detail)
    })
  }, OM_EVENT_NAME)
}

async function hasEvent(page: Page, eventId: string, jobId: string): Promise<boolean> {
  return page.evaluate(({ targetId, targetJobId }) => {
    const events = (window as unknown as { __capturedOmEvents?: CapturedEvent[] }).__capturedOmEvents ?? []
    return events.some((event) => {
      if (event.id !== targetId) return false
      const payload = event.payload
      if (!payload || typeof payload !== 'object') return false
      return payload.jobId === targetJobId
    })
  }, { targetId: eventId, targetJobId: jobId })
}

test.describe('TC-PROG-002: Progress SSE events', () => {
  test('emits progress.job.updated to authenticated user via SSE bridge', async ({ page, request }) => {
    await login(page, 'admin')
    await page.goto('/backend')
    await page.waitForLoadState('domcontentloaded')
    await installCollector(page)

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
