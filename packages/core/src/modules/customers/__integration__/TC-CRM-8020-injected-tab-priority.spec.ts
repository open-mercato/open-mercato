import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

for (const kind of ['company', 'person', 'deal'] as const) {
  test(`TC-CRM-8020: ${kind} detail orders contributed tabs without changing its default`, async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${testInfo.workerIndex}`
    const fixtures: Array<{ path: string; id: string }> = []
    try {
      const companyId = await createCompanyFixture(request, token, `QA tab priority ${stamp}`)
      fixtures.push({ path: '/api/customers/companies', id: companyId })
      let recordId = companyId
      if (kind === 'person') {
        recordId = await createPersonFixture(request, token, {
          firstName: 'QA', lastName: stamp, displayName: `QA priority ${stamp}`, companyEntityId: companyId,
        })
        fixtures.push({ path: '/api/customers/people', id: recordId })
      }
      if (kind === 'deal') {
        const pipelineId = await createPipelineFixture(request, token, { name: `QA priority ${stamp}` })
        fixtures.push({ path: '/api/customers/pipelines', id: pipelineId })
        const stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'QA stage', order: 0 })
        fixtures.push({ path: '/api/customers/pipeline-stages', id: stageId })
        recordId = await createDealFixture(request, token, {
          title: `QA priority deal ${stamp}`, companyIds: [companyId], pipelineId, pipelineStageId: stageId,
        })
        fixtures.push({ path: '/api/customers/deals', id: recordId })
      }
      await login(page, 'admin')
      await page.addInitScript(({ targetKind }) => {
        const definitions = [
          { id: 'high', title: 'QA High', priority: 1000 },
          { id: 'tie-first', title: 'QA Tie First', priority: 900 },
          { id: 'tie-second', title: 'QA Tie Second', priority: 900 },
          { id: 'omitted', title: 'QA Omitted' },
          { id: 'zero', title: 'QA Zero', priority: 0 },
          { id: 'negative', title: 'QA Negative', priority: -100 },
          { id: 'unavailable', title: 'QA Unavailable', priority: 2000, requiredModules: ['qa_absent_module'] },
        ]
        const widgets = definitions.map((definition) => {
          const metadata = {
            id: `qa.priority.${definition.id}`,
            title: definition.title,
            requiredModules: definition.requiredModules,
          }
          return {
            moduleId: 'customers', key: metadata.id, widgetId: metadata.id,
            loader: async () => ({ default: { metadata, Widget: () => `${definition.title} content` } }),
          }
        })
        const slots = definitions.map((definition) => ({
          widgetId: `qa.priority.${definition.id}`, kind: 'tab', groupId: `qa-${definition.id}`,
          ...(definition.priority === undefined ? {} : { priority: definition.priority }),
        }))
        const additions: Record<string, unknown[]> = {
          __openMercatoCoreInjectionWidgetEntries__: widgets,
          __openMercatoCoreInjectionTables__: [{
            moduleId: 'customers', table: { [`detail:customers.${targetKind}:tabs`]: slots },
          }],
        }
        for (const [key, contribution] of Object.entries(additions)) {
          let registered: unknown[] = []
          Object.defineProperty(globalThis, key, {
            configurable: true,
            get: () => [...registered, ...contribution],
            set: (value: unknown) => { registered = Array.isArray(value) ? value : [] },
          })
        }
      }, { targetKind: kind })
      const segment = { company: 'companies-v2', person: 'people-v2', deal: 'deals' }[kind]
      const route = `/backend/customers/${segment}/${recordId}`
      await page.goto(route)
      const main = page.getByRole('main')
      const high = main.getByRole('tab', { name: 'QA High', exact: true })
      await expect(high).toBeVisible()
      const labels = await main.getByRole('tab').allTextContents()
      const position = (label: string) => labels.findIndex((entry) => entry.trim() === label)
      const builtIn = main.getByRole('tab', { name: kind === 'company' ? /^People/ : 'Activities', exact: kind !== 'company' })
      await expect(builtIn).toHaveAttribute('aria-selected', 'true')
      const builtInPosition = labels.findIndex((label) => label.startsWith(kind === 'company' ? 'People' : 'Activities'))
      expect(position('QA High')).toBeLessThan(builtInPosition)
      expect(position('QA Tie First')).toBeLessThan(position('QA Tie Second'))
      expect(position('QA Tie Second')).toBeLessThan(builtInPosition)
      expect(position('QA Omitted')).toBeGreaterThan(builtInPosition)
      expect(position('QA Zero')).toBeGreaterThan(builtInPosition)
      expect(position('QA Negative')).toBe(labels.length - 1)
      await expect(main.getByRole('tab', { name: 'QA Unavailable' })).toHaveCount(0)
      await high.click()
      await expect(main.getByText('QA High content', { exact: true })).toBeVisible()
      await page.goto(`${route}?tab=qa-negative`)
      await expect(main.getByRole('tab', { name: 'QA Negative', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(main.getByText('QA Negative content', { exact: true })).toBeVisible()
      const screenshot = testInfo.outputPath(`${kind}-tab-priority.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      await testInfo.attach(`${kind}-tab-priority`, { path: screenshot, contentType: 'image/png' })
    } finally {
      for (const fixture of fixtures.reverse()) {
        await deleteEntityIfExists(request, token, fixture.path, fixture.id)
      }
    }
  })
}
