import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  cleanupOrder,
  cleanupQuote,
  createOrderFixture,
  createQuoteFixture,
  getOrderUpdatedAt,
  getQuoteUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
} from './helpers/recordLocks'

test.describe('TC-LOCK-SALES line draft conflict retry', () => {
  test.describe.configure({ timeout: 120_000 })

  for (const kind of ['order', 'quote'] as const) {
    for (const role of ['admin', 'employee'] as const) {
      test(`${role} handles a stale ${kind} line draft according to override permission`, async ({ page, request }) => {
        const adminToken = await getAuthToken(request, 'admin')
        const superadminToken = await getAuthToken(request, 'superadmin')
        const settings = await getRecordLockSettings(request, superadminToken)
        const createDocument = kind === 'order' ? createOrderFixture : createQuoteFixture
        const cleanupDocument = kind === 'order' ? cleanupOrder : cleanupQuote
        const getUpdatedAt = kind === 'order' ? getOrderUpdatedAt : getQuoteUpdatedAt
        const resourceKind = `sales.${kind}`
        const linePath = `/api/sales/${kind}-lines`
        let documentId: string | null = null

        try {
          await saveRecordLockSettings(request, superadminToken, {
            ...settings,
            enabled: true,
            strategy: 'optimistic',
            enabledResources: [...new Set([...settings.enabledResources, resourceKind])],
            allowIncomingOverride: true,
          })
          documentId = await createDocument(request, adminToken)

          await login(page, role)
          const acquired = page.waitForResponse((response) =>
            new URL(response.url()).pathname === '/api/record_locks/acquire'
            && response.ok()
            && response.request().postDataJSON()?.resourceId === documentId,
          )
          await page.goto(`/backend/sales/${kind}s/${documentId}`)
          await page.getByRole('main').getByRole('button', { name: 'Add item', exact: true }).first().click()
          const lineDialog = page.getByRole('dialog', { name: 'Add line' })
          const lineForm = page.locator(`form[id="record-lock:${resourceKind}:${documentId}"]`)
          await lineDialog.getByRole('button', { name: 'Custom line', exact: true }).click()
          const draft = `Draft line ${documentId}`
          const name = lineForm.getByPlaceholder('Optional line name')
          await name.fill(draft)
          await lineDialog.getByPlaceholder('0.00', { exact: true }).fill('12')
          await acquired

          const parentVersion = await getUpdatedAt(request, adminToken, documentId)
          expect(parentVersion).toBeTruthy()
          const competingLine = `Competing line ${documentId}`
          const competingSave = await apiRequest(request, 'POST', linePath, {
            token: superadminToken,
            headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: parentVersion ?? '' },
            data: {
              [`${kind}Id`]: documentId,
              name: competingLine,
              currencyCode: 'USD',
              quantity: 1,
              unitPriceNet: 10,
              unitPriceGross: 10,
              metadata: { customLine: true, lineMode: 'custom' },
            },
          })
          expect(competingSave.ok()).toBeTruthy()

          const lineWriteStatuses: number[] = []
          page.on('response', (response) => {
            if (new URL(response.url()).pathname === linePath && response.request().method() === 'POST') {
              lineWriteStatuses.push(response.status())
            }
          })
          await lineDialog.getByRole('button', { name: 'Add item', exact: true }).click()
          const conflict = page.getByRole('dialog', { name: 'Conflict detected' })
          await expect(conflict).toBeVisible()
          await expect(name).toHaveValue(draft)
          expect(lineWriteStatuses).toEqual([])

          const keepMine = conflict.getByRole('button', { name: 'Keep my changes', exact: true })
          if (role === 'employee') {
            await expect(conflict.getByText(/do not have permission to override incoming changes/)).toBeVisible()
            await expect(keepMine).toHaveCount(0)
            await conflict.getByRole('button', { name: 'Keep editing', exact: true }).click()
            await expect(name).toBeVisible()
            expect(lineWriteStatuses).toEqual([])
            return
          }

          await keepMine.click()
          await expect(conflict).toHaveCount(0)
          await expect(lineForm).toHaveCount(0)
          expect(lineWriteStatuses).toEqual([409, 201])

          await page.reload()
          const main = page.getByRole('main')
          await expect(main.getByText(draft, { exact: true })).toHaveCount(1)
          await expect(main.getByText(competingLine, { exact: true })).toHaveCount(1)
        } finally {
          try {
            await cleanupDocument(request, adminToken, documentId)
          } finally {
            await saveRecordLockSettings(request, superadminToken, settings)
          }
        }
      })
    }
  }
})
