import { expect, test } from '@playwright/test'
import { createCompanyFixture, createDealFixture, createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  assertNativePayload, authenticateCrm, captureCrmWrites, cleanupCrmRecord, createPriority,
  openCrmPriorityForm, readCrmOverview, readPriorities, selectPriority, updatePriority, type CrmKind,
} from './helpers/umesFixtures'

export const integrationMeta = { requiredModules: ['customers', 'example'] }

test.describe('TC-CRM-UMES-PRIORITY-001: Real contributor detail round trips', () => {
  for (const kind of ['people', 'companies', 'deals'] as const) {
    test(`${kind} loads, saves and reloads native and owning-module fields`, async ({ page, request }, testInfo) => {
      const token = await authenticateCrm(page, request)
      const name = `UMES ${kind} ${Date.now()}`
      let id: string | null = null
      let linkedPersonId: string | null = null
      const captured = captureCrmWrites(page)
      try {
        if (kind === 'people') id = await createPersonFixture(request, token, { firstName: 'Original', lastName: 'Person', displayName: name })
        if (kind === 'companies') id = await createCompanyFixture(request, token, name)
        if (kind === 'deals') {
          linkedPersonId = await createPersonFixture(request, token, { firstName: 'Linked', lastName: 'Person', displayName: `${name} link` })
          id = await createDealFixture(request, token, { title: name, personIds: [linkedPersonId] })
        }
        expect(id).toBeTruthy()
        const recordId = id as string
        const child = await createPriority(request, token, recordId, 'high')
        const cold = await readCrmOverview(request, token, kind, recordId)
        const hit = await readCrmOverview(request, token, kind, recordId)
        expect(cold.priority).toMatchObject({ priority: 'high', priorityId: child.id, priorityUpdatedAt: child.updatedAt })
        expect(hit.priority).toEqual(cold.priority)
        const startedAt = Date.now()
        await openCrmPriorityForm(page, kind, recordId)
        testInfo.annotations.push({ type: 'form-ready-ms', description: String(Date.now() - startedAt) })
        await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveText('High')
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
        const nextNative = `Updated ${kind} ${Date.now()}`
        await page.getByRole('main').getByRole('textbox').first().fill(nextNative)
        await selectPriority(page, 'Critical')
        const saved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/customers/${kind}` && response.request().method() === 'PUT')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        expect((await saved).ok()).toBe(true)
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
        await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveText('Critical')
        const nativeWrite = assertNativePayload(captured.writes, kind, 'PUT')
        expect(nativeWrite.lockVersion).toBe(cold.record.updatedAt)
        expect(nativeWrite.data[kind === 'people' ? 'firstName' : kind === 'companies' ? 'displayName' : 'title']).toBe(nextNative)
        const contributorWrites = captured.writes.filter((write) => write.path === '/api/example/customer-priorities')
        expect(contributorWrites).toHaveLength(1)
        expect(contributorWrites[0]).toMatchObject({ method: 'PUT', data: { id: child.id, customerId: recordId, priority: 'critical' } })
        expect(contributorWrites[0].lockVersion).toBe(child.updatedAt)
        expect(captured.writes.indexOf(contributorWrites[0])).toBeLessThan(captured.writes.indexOf(nativeWrite))
        const persisted = await readCrmOverview(request, token, kind, recordId)
        expect(persisted.priority.priority).toBe('critical')
        if (kind === 'people') expect(persisted.envelope.profile).toMatchObject({ firstName: nextNative })
        else expect(persisted.record[kind === 'companies' ? 'displayName' : 'title']).toBe(nextNative)
        const children = await readPriorities(request, token, recordId)
        expect(children).toHaveLength(1)
        await readCrmOverview(request, token, kind, recordId)
        await updatePriority(request, token, recordId, children[0], 'low')
        const fresh = await readCrmOverview(request, token, kind, recordId)
        const repeated = await readCrmOverview(request, token, kind, recordId)
        expect(fresh.priority.priority).toBe('low')
        expect(repeated.priority).toEqual(fresh.priority)
        await openCrmPriorityForm(page, kind, recordId)
        await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveText('Low')
        await expect(page.getByRole('main').getByRole('textbox').first()).toHaveValue(nextNative)
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
        await page.screenshot({ path: testInfo.outputPath(`${kind}-priority-reloaded.png`), fullPage: true })
        if (kind === 'people') {
          await page.setViewportSize({ width: 390, height: 844 })
          await expect(page.locator('form')).toHaveCount(1)
          await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toBeVisible()
          await page.screenshot({ path: testInfo.outputPath('person-priority-narrow.png'), fullPage: true })
        }
      } finally {
        captured.stop()
        await cleanupCrmRecord(request, token, kind as CrmKind, id)
        await cleanupCrmRecord(request, token, 'people', linkedPersonId)
      }
    })
  }
})
