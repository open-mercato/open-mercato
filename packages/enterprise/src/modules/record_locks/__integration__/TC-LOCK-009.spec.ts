import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  cleanupCompany,
  getRecordLockSettings,
  saveRecordLockSettings,
  type RecordLockSettings,
} from './helpers/recordLocks'

test.describe('TC-LOCK-009: record_locks reconnect reconciliation', () => {
  test('reconciles lock notifications on om:bridge:reconnected without interval polling', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')

    let previousSettings: RecordLockSettings | null = null
    let companyId: string | null = null
    const requestCounts = {
      recordDeleted: 0,
      lockContended: 0,
    }

    const onRequest = (rawRequest: { url: () => string; method: () => string }) => {
      if (rawRequest.method() !== 'GET') return
      const url = rawRequest.url()
      const isDeletedList = (
        url.includes('/api/notifications?')
        && url.includes('status=unread')
        && url.includes('type=record_locks.record.deleted')
      )
      const isContendedList = (
        url.includes('/api/notifications?')
        && url.includes('status=unread')
        && url.includes('type=record_locks.lock.contended')
      )
      if (isDeletedList) {
        requestCounts.recordDeleted += 1
      }
      if (isContendedList) {
        requestCounts.lockContended += 1
      }
    }

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken)
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.company'],
      })

      companyId = await createCompanyFixture(request, adminToken, `QA TC-LOCK-009 Company ${Date.now()}`)

      await login(page, 'admin')
      page.on('request', onRequest)
      const acquireResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/record_locks/acquire') && response.request().method() === 'POST',
        { timeout: 15_000 },
      )
      await page.goto(`/backend/customers/companies/${encodeURIComponent(companyId)}`)
      await page.waitForLoadState('domcontentloaded')
      const acquireResponse = await acquireResponsePromise
      expect(acquireResponse.ok()).toBeTruthy()

      await page.evaluate(() => {
        const eventName = 'om:record_locks:record-deleted'
        const store = window as unknown as { __tcLockReconnectEvents?: number; __tcLockReconnectInstalled?: boolean }
        if (!store.__tcLockReconnectInstalled) {
          store.__tcLockReconnectEvents = 0
          window.addEventListener(eventName, () => {
            store.__tcLockReconnectEvents = (store.__tcLockReconnectEvents ?? 0) + 1
          })
          store.__tcLockReconnectInstalled = true
        }
      })

      const createNotificationResponse = await apiRequest(request, 'POST', '/api/notifications/feature', {
        token: superadminToken,
        data: {
          requiredFeature: 'record_locks.view',
          type: 'record_locks.record.deleted',
          title: 'Record was deleted',
          body: 'Reconnect reconciliation integration test',
          severity: 'warning',
          sourceModule: 'record_locks',
          sourceEntityType: 'record_locks:record',
          sourceEntityId: companyId,
          bodyVariables: { resourceKind: 'customers.company' },
        },
      })
      expect(createNotificationResponse.ok()).toBeTruthy()

      const beforeReconnect = { ...requestCounts }
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('om:event', {
          detail: {
            id: 'om:bridge:reconnected',
            payload: {},
            timestamp: Date.now(),
            organizationId: '',
          },
        }))
      })

      await expect.poll(() => requestCounts.recordDeleted, { timeout: 15_000 }).toBeGreaterThan(beforeReconnect.recordDeleted)
      await expect.poll(() => requestCounts.lockContended, { timeout: 15_000 }).toBeGreaterThan(beforeReconnect.lockContended)

      await expect.poll(async () => {
        return page.evaluate(() => {
          const store = window as unknown as { __tcLockReconnectEvents?: number }
          return store.__tcLockReconnectEvents ?? 0
        })
      }, { timeout: 20_000 }).toBeGreaterThan(0)

      const afterReconnect = { ...requestCounts }
      await page.waitForTimeout(6_000)
      expect(requestCounts.recordDeleted).toBe(afterReconnect.recordDeleted)
      expect(requestCounts.lockContended).toBe(afterReconnect.lockContended)
    } finally {
      page.off('request', onRequest)
      await cleanupCompany(request, adminToken, companyId)
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {})
      }
    }
  })
})
