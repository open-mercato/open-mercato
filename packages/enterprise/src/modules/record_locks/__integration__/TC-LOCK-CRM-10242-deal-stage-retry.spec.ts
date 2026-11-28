import { expect, test, type Request } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  cleanupDeal,
  getDealTitle,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateDeal,
} from './helpers/recordLocks'

test.describe('TC-LOCK-CRM-10242: Keep my changes retries the deal stage update', () => {
  for (const panel of ['expanded', 'collapsed'] as const) {
    test(`submits only the selected stage with the details form ${panel}`, async ({ page, request }) => {
      const superadminToken = await getAuthToken(request, 'superadmin')
      const adminToken = await getAuthToken(request, 'admin')
      const employeeToken = await getAuthToken(request, 'employee')
      const previousSettings = await getRecordLockSettings(request, superadminToken)
      const title = `TC-LOCK-CRM-10242 deal ${Date.now()}`
      let pipelineId: string | null = null
      let dealId: string | null = null
      const stageIds: string[] = []
      const initialLockRequests = Promise.withResolvers<void>()

      try {
        await saveRecordLockSettings(request, superadminToken, {
          ...previousSettings,
          enabled: true,
          strategy: 'optimistic',
          enabledResources: ['customers.deal'],
          allowIncomingOverride: true,
        })
        pipelineId = await createPipelineFixture(request, adminToken, { name: `${title} pipeline` })
        const firstStageId = await createPipelineStageFixture(request, adminToken, {
          pipelineId, label: 'First stage', order: 0,
        })
        stageIds.push(firstStageId)
        const secondStageId = await createPipelineStageFixture(request, adminToken, {
          pipelineId, label: 'Second stage', order: 1,
        })
        stageIds.push(secondStageId)
        dealId = await createDealFixture(request, adminToken, { title, pipelineId, pipelineStageId: firstStageId })

        await login(page, 'admin')
        if (panel === 'expanded') {
          await page.route('**/api/record_locks/acquire', async (route) => {
            await initialLockRequests.promise
            await route.continue()
          })
        }
        const lockAcquired = page.waitForResponse((response) => {
          if (!response.ok() || new URL(response.url()).pathname !== '/api/record_locks/acquire') return false
          return response.request().postDataJSON()?.resourceId === dealId
        })
        await page.goto(`/backend/customers/deals/${dealId}`)
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
        const expandForm = page.getByRole('button', { name: 'Expand form panel' })
        await expect(expandForm).toBeVisible()
        if (panel === 'expanded') {
          await expandForm.click()
          const titleField = page.locator('[data-crud-field-id="title"]').getByRole('textbox')
          await expect(titleField).toBeVisible()
          await expect.poll(() => titleField.evaluate((field, recordId) => {
            const owners = (globalThis as Record<string, unknown>).__openMercatoRecordLockWidgetOwners__
            const owner = owners instanceof Map
              ? owners.get(`customers.deal:${recordId}`) as { formId: string } | undefined
              : undefined
            return Boolean(owner && owner.formId === field.closest('form')?.id)
          }, dealId)).toBe(true)
        }
        initialLockRequests.resolve()
        await lockAcquired

        const incomingTitle = `${title} updated by employee`
        expect((await updateDeal(request, employeeToken, dealId, incomingTitle)).status).toBe(200)

        const isDealWrite = (outgoing: Request) =>
          outgoing.method() === 'PUT' && new URL(outgoing.url()).pathname === '/api/customers/deals'
        const writes: Request[] = []
        page.on('request', (outgoing) => {
          if (isDealWrite(outgoing)) writes.push(outgoing)
        })
        const progress = page.getByRole('list', { name: /^Pipeline progress/ })
        await progress.getByRole('button', { name: /Second stage/ }).click()
        const conflict = page.getByRole('dialog', { name: 'Conflict detected' })
        await expect(conflict).toBeVisible()

        const retryResponse = page.waitForResponse((response) => isDealWrite(response.request()))
        await conflict.getByRole('button', { name: 'Keep my changes' }).click()
        const response = await retryResponse
        expect(writes).toHaveLength(1)
        expect(response.request().postDataJSON()).toEqual({ id: dealId, pipelineStageId: secondStageId })
        expect(await response.request().headerValue('x-om-record-lock-resolution')).toBe('accept_mine')
        expect(await getDealTitle(request, adminToken, dealId)).toBe(incomingTitle)
      } finally {
        initialLockRequests.resolve()
        await cleanupDeal(request, adminToken, dealId)
        for (const stageId of stageIds) {
          await deleteEntityByBody(request, adminToken, '/api/customers/pipeline-stages', stageId)
        }
        await deleteEntityByBody(request, adminToken, '/api/customers/pipelines', pipelineId)
        await saveRecordLockSettings(request, superadminToken, previousSettings)
      }
    })
  }
})
