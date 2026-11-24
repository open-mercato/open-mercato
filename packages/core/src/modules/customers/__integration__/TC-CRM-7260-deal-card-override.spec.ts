import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createDealFixture, createPipelineFixture, createPipelineStageFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

export const integrationMeta = { dependsOnModules: ['deal_card_reference'] }

async function runFixtureBatches<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<unknown[]> {
  const errors: unknown[] = []
  for (let offset = 0; offset < items.length; offset += 4) {
    const results = await Promise.allSettled(items.slice(offset, offset + 4).map(run))
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason)
    }
  }
  return errors
}

test.describe('TC-CRM-7260: app-defined pipeline card references', () => {
  test.slow()
  const pipelineName = `Card override ${randomUUID()}`
  const stageLabel = 'Qualified'
  const deals = new Map<string, { title: string; description: string }>()
  let token: string | null = null
  let pipelineId: string | null = null
  let stageId: string | null = null

  test.beforeAll(async ({ request }) => {
    const fixtureToken = await getAuthToken(request, 'admin')
    token = fixtureToken
    const pipeline = await createPipelineFixture(request, fixtureToken, { name: pipelineName, isDefault: false })
    pipelineId = pipeline
    const stage = await createPipelineStageFixture(request, fixtureToken, { pipelineId: pipeline, label: stageLabel, order: 0 })
    stageId = stage
    const indices = Array.from({ length: 26 }, (_, index) => index)
    const errors = await runFixtureBatches(indices, async (index) => {
      const title = `${pipelineName} deal ${index}`
      const description = `SPD-7260-${pipeline}-${index}`
      const id = await createDealFixture(request, fixtureToken, { title, description, pipelineId: pipeline, pipelineStageId: stage })
      deals.set(id, { title, description })
    })
    expect(errors, 'Create all fixture deals').toEqual([])
  })

  test.afterAll(async ({ request }) => {
    if (!token) return
    const fixtureToken = token
    const errors: unknown[] = []
    for (const [path, ids] of [
      ['/api/customers/deals', [...deals.keys()]],
      ['/api/customers/pipeline-stages', stageId ? [stageId] : []],
      ['/api/customers/pipelines', pipelineId ? [pipelineId] : []],
    ] as const) {
      errors.push(...await runFixtureBatches(ids, async (id) => {
        const response = await apiRequest(request, 'DELETE', path, { token: fixtureToken, data: { id } })
        expect(response.ok(), `Delete ${path}/${id}`).toBe(true)
      }))
    }
    expect(errors, 'Clean up every fixture').toEqual([])
  })

  function waitForListPage(page: Page, number: number) {
    return page.waitForResponse((response) => {
      const { pathname, searchParams } = new URL(response.url())
      return pathname === '/api/customers/deals' && searchParams.get('pipelineStageId') === stageId
        && searchParams.get('pipelineId') === pipelineId && searchParams.get('page') === String(number)
    })
  }

  async function expectCardFromResponse(page: Page, response: Awaited<ReturnType<typeof waitForListPage>>, count: number) {
    expect(response.ok()).toBe(true)
    const { items } = await response.json() as { items: { id: string; description: string }[] }
    expect(items).toHaveLength(count)
    const { id, description } = items[0]
    const fixture = deals.get(id)
    if (!fixture) throw new Error('The scoped lane returned a deal outside the fixture')
    expect(description).toBe(fixture.description)
    const card = page.getByRole('button', { name: `Deal: ${fixture.title}`, exact: true })
    await expect(card.getByText(description, { exact: true })).toBeVisible()
    return { card, id }
  }

  async function selectFixturePipeline(page: Page) {
    await page.goto('/backend/customers/deals/pipeline')
    await page.getByRole('button', { name: /^Pipeline:/ }).click()
    const chooser = page.getByRole('dialog').filter({ hasText: 'Filter: Pipeline' })
    await chooser.getByRole('radio', { name: pipelineName, exact: true }).click()
    await chooser.getByRole('button', { name: 'Apply', exact: true }).click()
  }

  test('shows references from both list pages and opens the appended deal by ID', async ({ page }) => {
    await login(page, 'admin')
    const [firstPage] = await Promise.all([waitForListPage(page, 1), selectFixturePipeline(page)])
    await expectCardFromResponse(page, firstPage, 25)

    const [secondPage] = await Promise.all([
      waitForListPage(page, 2),
      page.getByRole('button', { name: `Load more deals in ${stageLabel}`, exact: true }).click(),
    ])
    const { card, id } = await expectCardFromResponse(page, secondPage, 1)
    await card.getByRole('heading').click()
    await expect(page).toHaveURL(new RegExp(`/backend/customers/deals/${id}$`))
  })
})
