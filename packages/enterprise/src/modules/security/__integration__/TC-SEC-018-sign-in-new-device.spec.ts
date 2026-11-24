import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  chromeWindows, createActivityFixture, enqueueActivityJob, expectActivityCount, expectLoginToken,
  fixtureIp, newDeviceNotificationType, signIn,
} from './helpers/signInActivityFixtures'

export const integrationMeta = { dependsOnModules: ['security', 'notifications'] }

test('TC-SEC-018: alerts once for a new device without copying raw client data', async ({ request }) => {
  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor()
    const token = expectLoginToken(await signIn(actor))
    const query = { userId: actor.userId, result: 'success' }
    const notifications = () => listNotifications(request, token, { type: newDeviceNotificationType })
    const sweep = async () => {
      await enqueueActivityJob('security-sign-in-notification', {})
      await drainIntegrationQueue('security-sign-in-notification')
    }

    await expectActivityCount(request, fixture.adminToken, query, 1)
    await sweep()
    expect((await notifications()).total).toBe(0)

    await signIn(actor, { userAgent: chromeWindows })
    await expectActivityCount(request, fixture.adminToken, query, 2)
    await sweep()
    await expect.poll(async () => (await notifications()).total, { timeout: 10_000 }).toBe(1)

    const stored = await withClient(async (client) =>
      client.query(
        'select body, body_variables, action_data, data from notifications where tenant_id = $1 and recipient_user_id = $2 and type = $3',
        [actor.tenantId, actor.userId, newDeviceNotificationType],
      ),
    )
    expect(stored.rows).toHaveLength(1)
    const serialized = JSON.stringify(stored.rows[0])
    expect(serialized).not.toContain(actor.email)
    expect(serialized).not.toContain(chromeWindows)
    expect(serialized).not.toContain(fixtureIp)

    await signIn(actor, { userAgent: chromeWindows })
    await expectActivityCount(request, fixture.adminToken, query, 3)
    await sweep()
    expect((await notifications()).total).toBe(1)
  } finally {
    await fixture.dispose()
  }
})
