import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createDealFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { readJsonSafe as parseJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

const polishDurations = ['15 min', '30 min', '45 min', '1 godzina', '1 godz. 30 min', '2 godziny']

type DealFixture = { token: string; personId: string; pipelineId: string; stageId: string; dealId: string; title: string; name: string }
type DealRecord = { id: string; title: string; pipeline_id?: string; pipeline_stage_id?: string }

async function withDealFixture(request: APIRequestContext, run: (fixture: DealFixture) => Promise<void>) {
  const token = await getAuthToken(request)
  const name = `Boundary ${randomUUID()}`
  const title = name.padEnd(200, 'x')
  let personId: string | null = null
  let pipelineId: string | null = null
  let stageId: string | null = null
  let dealId: string | null = null
  try {
    personId = await createPersonFixture(request, token, { firstName: 'Boundary', lastName: 'Person', displayName: name })
    pipelineId = await createPipelineFixture(request, token, { name })
    stageId = await createPipelineStageFixture(request, token, { pipelineId, label: name })
    dealId = await createDealFixture(request, token, { title, personIds: [personId], pipelineId, pipelineStageId: stageId })
    await run({ token, name, title, personId, pipelineId, stageId, dealId })
  } finally {
    if (pipelineId) {
      const remaining = await apiRequest(request, 'GET', `/api/customers/deals?pipelineId=${pipelineId}&pageSize=100`, { token })
      expect(remaining.status()).toBe(200)
      const records = (await readJsonSafe<{ items?: DealRecord[] }>(remaining))?.items ?? []
      for (const record of records.filter((item) => item.pipeline_id === pipelineId)) {
        const deleted = await apiRequest(request, 'DELETE', `/api/customers/deals?id=${record.id}`, { token })
        expect(deleted.status(), 'all original/copied deals in the owned pipeline are removed').toBe(200)
      }
    }
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId)
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
  }
}

for (const width of [1440, 390]) {
  test(`TC-CRM-8592: Polish scheduling duration choices at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await withDealFixture(request, async ({ dealId, title }) => {
      await login(page, 'admin')
      await page.context().addCookies([{ name: 'locale', value: 'pl', url: new URL(page.url()).origin }])
      await page.goto(`/backend/customers/deals/${dealId}`)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Zaplanuj', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Nowe spotkanie', exact: true })
      const duration = dialog.getByRole('combobox').first()
      for (const choice of ['1 godzina', '2 godziny']) {
        await duration.click()
        await expect(page.getByRole('listbox').getByRole('option')).toHaveText(polishDurations)
        await expect(page.getByRole('option', { name: /^(1 hour|2 hours)$/ })).toHaveCount(0)
        await page.getByRole('option', { name: choice, exact: true }).click()
        await expect(duration).toHaveText(choice)
      }
      await testInfo.attach(`polish-duration-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
      await dialog.getByRole('button', { name: 'Anuluj', exact: true }).first().click()
      await page.getByRole('alertdialog', { name: 'Odrzucić niezapisane zmiany?', exact: true })
        .getByRole('button', { name: 'Odrzuć', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    })
  })
}

for (const entry of [{ locale: 'en', mode: 'list', suffix: ' (copy)' }, { locale: 'pl', mode: 'kanban', suffix: ' (kopia)' }]) {
  test(`TC-CRM-8592: ${entry.locale} ${entry.mode} preserves the duplicate marker at the title limit`, async ({ page, request }) => {
    await withDealFixture(request, async ({ token, title, name, pipelineId, stageId, dealId }) => {
      expect(title.length).toBe(200)
      await login(page, 'admin')
      await page.context().addCookies([{ name: 'locale', value: entry.locale, url: new URL(page.url()).origin }])
      if (entry.mode === 'list') {
        await page.goto(`/backend/customers/deals?search=${encodeURIComponent(title)}`)
        const row = page.getByRole('row').filter({ has: page.getByText(title, { exact: true }) })
        await expect(row).toHaveCount(1)
        await row.getByRole('button', { name: 'Open actions', exact: true }).click()
      } else {
        await page.goto('/backend/customers/deals/pipeline')
        await page.getByRole('combobox').first().click()
        await page.getByRole('option', { name, exact: true }).click()
        const card = page.getByRole('button', { name: `Szansa: ${title}`, exact: true })
        await card.getByRole('button', { name: 'Akcje szansy', exact: true }).click()
      }
      const created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/deals' && response.request().method() === 'POST')
      await page.getByRole('menuitem', { name: entry.mode === 'list' ? 'Duplicate' : 'Duplikuj', exact: true }).click()
      const response = await created
      expect(response.status(), 'maximum-length duplicate is accepted').toBe(201)
      const result = await parseJsonSafe<{ id?: string; dealId?: string }>(await response.text())
      const copyId = result?.id ?? result?.dealId
      expect(copyId).toBeTruthy()
      expect(copyId).not.toBe(dealId)
      const persisted = await apiRequest(request, 'GET', `/api/customers/deals?id=${copyId}`, { token })
      expect(persisted.status()).toBe(200)
      const copy = (await readJsonSafe<{ items?: DealRecord[] }>(persisted))?.items?.find((item) => item.id === copyId)
      expect(copy?.title).toBe(`${title.slice(0, 200 - entry.suffix.length)}${entry.suffix}`)
      expect(copy?.title.length).toBeLessThanOrEqual(200)
      expect(copy?.pipeline_id).toBe(pipelineId)
      expect(copy?.pipeline_stage_id).toBe(stageId)
      const original = await apiRequest(request, 'GET', `/api/customers/deals?id=${dealId}`, { token })
      expect((await readJsonSafe<{ items?: DealRecord[] }>(original))?.items?.[0]?.title).toBe(title)
    })
  })
}
