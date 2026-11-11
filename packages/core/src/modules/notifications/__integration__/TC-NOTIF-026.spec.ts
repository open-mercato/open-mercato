import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
  type CustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import type { NotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'

/**
 * TC-NOTIF-026: `notificationService.createForCustomerUsers` writes portal bell entries.
 *
 * The method has no HTTP route of its own (modules call it from the DI container), so the spec
 * boots the app container in-process, creates the row through the real service, and then reads it
 * back over the portal API: the recipient sees it, another customer user of the same organization
 * does not.
 */

type PortalNotificationList = {
  items?: Array<{ id: string; sourceEntityId?: string | null; type: string; linkHref?: string | null }>
}

test.describe('TC-NOTIF-026: createForCustomerUsers feeds the portal bell', () => {
  test('a row created for a customer user is listed for that user only', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const sourceEntityId = randomUUID()
    let recipient: CustomerUserFixture | null = null
    let bystander: CustomerUserFixture | null = null

    try {
      recipient = await createCustomerUserFixture(request, adminToken)
      bystander = await createCustomerUserFixture(request, adminToken)

      await bootstrapFromAppRoot(resolveAppRoot())
      const container = await createRequestContainer()
      const notificationService = container.resolve('notificationService') as NotificationService
      expect(notificationService.createForCustomerUsers, 'service must expose createForCustomerUsers').toBeDefined()

      const created = await notificationService.createForCustomerUsers!(
        {
          recipientCustomerUserIds: [recipient.id],
          type: 'notifications.qa.portal_entry',
          titleKey: 'notifications.qa.portal_entry.title',
          sourceModule: 'notifications',
          sourceEntityType: 'notifications:qa',
          sourceEntityId,
          linkHref: '/portal',
        },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      expect(created).toHaveLength(1)

      const recipientSession = await portalLogin(request, {
        email: recipient.email,
        password: recipient.password,
        tenantId: scope.tenantId,
      })
      const recipientRes = await request.get('/api/customer_accounts/portal/notifications', {
        headers: portalCookieHeaders(recipientSession),
      })
      expect(recipientRes.status()).toBe(200)
      const recipientBody = await readJsonSafe<PortalNotificationList>(recipientRes)
      const recipientMatches = (recipientBody?.items ?? []).filter((item) => item.sourceEntityId === sourceEntityId)
      expect(recipientMatches).toHaveLength(1)
      expect(recipientMatches[0]?.linkHref).toBe('/portal')

      const bystanderSession = await portalLogin(request, {
        email: bystander.email,
        password: bystander.password,
        tenantId: scope.tenantId,
      })
      const bystanderRes = await request.get('/api/customer_accounts/portal/notifications', {
        headers: portalCookieHeaders(bystanderSession),
      })
      expect(bystanderRes.status()).toBe(200)
      const bystanderBody = await readJsonSafe<PortalNotificationList>(bystanderRes)
      expect((bystanderBody?.items ?? []).filter((item) => item.sourceEntityId === sourceEntityId)).toHaveLength(0)
    } finally {
      await withClient(async (client) => {
        await client.query('delete from notifications where source_entity_id = $1', [sourceEntityId])
      }).catch(() => undefined)
      await deleteCustomerUserFixture(request, adminToken, recipient?.id ?? null)
      await deleteCustomerUserFixture(request, adminToken, bystander?.id ?? null)
    }
  })
})
