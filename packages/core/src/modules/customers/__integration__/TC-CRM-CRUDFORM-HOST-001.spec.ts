import { expect, test } from '@playwright/test'
import { createPipelineFixture, createPipelineStageFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { assertNativePayload, authenticateCrm, captureCrmWrites, cleanupCrmRecord, cleanupCrmPipeline, readCrmOverview, readPriorities, selectPriority, type CrmKind } from './helpers/umesFixtures'

export const integrationMeta = { requiredModules: ['customers', 'example'] }

test.describe('TC-CRM-CRUDFORM-HOST-001: Canonical CRM create hosts', () => {
  for (const host of ['person', 'company', 'full deal', 'quick deal'] as const) {
    test(`${host} creates the contributor once with the newly created native ID`, async ({ page, request }, testInfo) => {
      const token = await authenticateCrm(page, request)
      const name = `Host ${host} ${Date.now()}`
      const kind: CrmKind = host === 'person' ? 'people' : host === 'company' ? 'companies' : 'deals'
      let id: string | null = null
      let pipelineId: string | null = null
      let otherPipelineId: string | null = null
      let stageId: string | null = null
      const captured = captureCrmWrites(page)
      try {
        if (host === 'quick deal') {
          const pipelineName = `${name} pipeline`
          const stageName = `${name} stage`
          pipelineId = await createPipelineFixture(request, token, { name: pipelineName })
          otherPipelineId = await createPipelineFixture(request, token, { name: `${name} other pipeline` })
          stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageName })
          await page.goto('/backend/customers/deals/pipeline', { waitUntil: 'domcontentloaded' })
          const toolbar = page.getByRole('main').getByRole('link', { name: 'New deal', exact: true }).locator('..')
          await expect(toolbar.getByRole('button', { name: 'New stage', exact: true })).toBeEnabled()
          const pipelineSelect = page.getByRole('main').getByText('Pipeline', { exact: true }).locator('..').getByRole('combobox')
          await pipelineSelect.click()
          await page.getByRole('option', { name: pipelineName, exact: true }).click()
          await expect(pipelineSelect).toHaveText(pipelineName)
          const quickAdd = page.getByRole('button', { name: `Quickly add a deal to ${stageName}`, exact: true })
          await expect(quickAdd).toBeEnabled()
          await quickAdd.click()
          await expect(page.getByRole('dialog', { name: 'Quick deal', exact: true })).toBeVisible()
          await page.getByRole('dialog').getByRole('textbox', { name: 'e.g. Q3 Expansion — Lighting Package', exact: true }).fill(name)
        } else {
          await page.goto(`/backend/customers/${kind}/create`, { waitUntil: 'domcontentloaded' })
          await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toBeVisible()
          if (host === 'person') {
            await page.getByRole('main').getByRole('textbox').nth(0).fill('Host')
            await page.getByRole('main').getByRole('textbox').nth(1).fill(name)
          } else if (host === 'company') await page.getByRole('main').getByRole('textbox').first().fill(name)
          else await page.getByRole('textbox', { name: 'Deal title *', exact: true }).fill(name)
        }
        await selectPriority(page, 'Critical')
        const created = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/customers/${kind}` && response.request().method() === 'POST')
        const childSaved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/example/customer-priorities' && response.request().method() === 'POST')
        if (host === 'quick deal') await page.getByRole('button', { name: 'Add deal', exact: true }).click()
        else await page.getByRole('button', { name: host === 'person' ? 'Create Person' : host === 'company' ? 'Create Company' : 'Create deal', exact: true }).first().click()
        const nativeResponse = await created
        expect(nativeResponse.ok()).toBe(true)
        const body = await nativeResponse.json() as { id?: string; entityId?: string }
        id = body.id ?? body.entityId ?? null
        expect(id).toBeTruthy()
        const childResponse = await childSaved
        expect(childResponse.ok()).toBe(true)
        if (host === 'quick deal') await expect(page.getByRole('dialog', { name: 'Quick deal', exact: true })).toHaveCount(0)
        else if (host === 'full deal') await expect(page).toHaveURL(/\/backend\/customers\/deals$/)
        else await expect(page).toHaveURL(new RegExp(`/backend/customers/${kind}-v2/${id}$`))
        const nativeWrite = assertNativePayload(captured.writes, kind, 'POST')
        const childWrites = captured.writes.filter((write) => write.path === '/api/example/customer-priorities')
        expect(childWrites).toHaveLength(1)
        expect(childWrites[0]).toMatchObject({ method: 'POST', data: { customerId: id, priority: 'critical' } })
        expect(captured.writes.indexOf(nativeWrite)).toBeLessThan(captured.writes.indexOf(childWrites[0]))
        const children = await readPriorities(request, token, id as string)
        expect(children).toHaveLength(1)
        expect(children[0].priority).toBe('critical')
        const overview = await readCrmOverview(request, token, kind, id as string)
        expect(overview.priority).toMatchObject({ priority: 'critical', priorityId: children[0].id })
        if (host === 'quick deal') expect(overview.record).toMatchObject({ pipelineId, pipelineStageId: stageId })
        await page.screenshot({ path: testInfo.outputPath(`${host.replace(' ', '-')}-after-save.png`), fullPage: true })
      } finally {
        captured.stop()
        await cleanupCrmRecord(request, token, kind, id)
        await cleanupCrmPipeline(request, token, stageId, pipelineId)
        await cleanupCrmPipeline(request, token, null, otherPipelineId)
      }
    })
  }
})
