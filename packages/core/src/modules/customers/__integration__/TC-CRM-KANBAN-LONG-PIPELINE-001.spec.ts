import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('failed and cancelled operation summaries stay distinct from success on narrow screens', async ({ page }, testInfo) => {
  let status: 'failed' | 'cancelled' = 'failed'
  await page.route('**/api/progress/active', (route) => route.fulfill({
    json: {
      active: [],
      recentlyCompleted: [{
        id: 'responsive-terminal-progress-job',
        jobType: 'customers.bulk_reassign',
        name: 'An unsuccessful operation with a long descriptive title',
        status,
        progressPercent: 20,
        processedCount: 2,
        totalCount: 10,
        cancellable: false,
        errorMessage: status === 'failed' ? 'The operation was refused' : null,
      }],
    },
  })))
  await login(page, 'admin')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/backend/customers/deals')
  const failedSummary = page.getByRole('button', { name: '1 operations failed', exact: true })
  await expect(failedSummary).toBeVisible()
  await failedSummary.click()
  await expect(page.getByText('The operation was refused', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1 operations completed', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await testInfo.attach('mobile-failed-operation-summary', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  status = 'cancelled'
  await page.reload()
  await expect(page.getByRole('button', { name: '1 operations cancelled', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1 operations completed', exact: true })).toHaveCount(0)
})

test('a long selected pipeline name fits a narrow viewport and retains its accessible name', async ({ page, request }, testInfo) => {
  const progressName = 'Reassign selected deals to a new owner with a long operation description'
  await page.route('**/api/progress/active', (route) => route.fulfill({
    json: {
      active: [{
        id: 'responsive-progress-job',
        jobType: 'customers.bulk_reassign',
        name: progressName,
        status: 'running',
        progressPercent: 0,
        processedCount: 0,
        totalCount: 10,
        cancellable: false,
      }],
      recentlyCompleted: [],
    },
  }))
  const token = await getAuthToken(request, 'admin')
  const name = `QA responsive pipeline ${Date.now()} ${'long descriptive name '.repeat(6)}`.trim()
  let pipelineId: string | null = null
  let stageId: string | null = null

  try {
    const pipelineResponse = await apiRequest(request, 'POST', '/api/customers/pipelines', {
      token,
      data: { name, isDefault: false },
    })
    expect(pipelineResponse.status()).toBe(201)
    pipelineId = expectId((await readJsonSafe<{ id?: unknown }>(pipelineResponse))?.id, 'Pipeline fixture id')

    const stageResponse = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
      token,
      data: { pipelineId, label: 'QA responsive stage', order: 0 },
    })
    expect(stageResponse.status()).toBe(201)
    stageId = expectId((await readJsonSafe<{ id?: unknown }>(stageResponse))?.id, 'Stage fixture id')

    await login(page, 'admin')
    await page.goto('/backend/customers/deals/pipeline')
    await expect(page.getByRole('button', { name: 'New stage', exact: true }).first()).toBeEnabled()
    await page.getByRole('status', { name: 'Loading', exact: true }).waitFor({ state: 'hidden' })
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name, exact: true }).press('Enter')
    await page.setViewportSize({ width: 390, height: 844 })

    await expect(page.getByRole('button', { name: `Pipeline: ${name}`, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(progressName) })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await testInfo.attach('mobile-pipeline-with-active-progress', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  } finally {
    const cleanupErrors: unknown[] = []
    for (const [path, entityId] of [
      ['/api/customers/pipeline-stages', stageId],
      ['/api/customers/pipelines', pipelineId],
    ] as const) {
      if (!entityId) continue
      try {
        const response = await apiRequest(request, 'DELETE', path, { token, data: { id: entityId } })
        expect([200, 404]).toContain(response.status())
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    expect(cleanupErrors).toEqual([])
  }
})
