import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  deleteChannelIfExists,
  disconnectSeededChannel,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-009 — the profile channels table does not offer
 * "Set as primary" on a disconnected channel.
 *
 * The row menu omits actions a channel cannot take. A disconnected channel stays
 * listed, and the set-primary route refuses it, so offering the action would only
 * lead to an error.
 */
async function rowMenuItems(page: Page, displayName: string): Promise<string[]> {
  const row = page.getByRole('row').filter({ hasText: displayName })
  await expect(row).toBeVisible({ timeout: 15_000 })
  const actionsButton = row.getByRole('button', { name: 'Open actions' })
  await expect(actionsButton).toBeEnabled({ timeout: 10_000 })
  const disconnectItem = page.getByRole('menuitem', { name: 'Disconnect' })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await disconnectItem.isVisible().catch(() => false)) break
    await actionsButton.click({ timeout: 5_000 }).catch(async () => {
      await actionsButton.focus()
      await actionsButton.press('Enter')
    })
    const opened = await disconnectItem
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (opened) break
  }
  await expect(disconnectItem).toBeVisible()
  const labels = (await page.getByRole('menuitem').allInnerTexts()).map((label) => label.trim())
  await page.keyboard.press('Escape')
  await expect(disconnectItem).toBeHidden({ timeout: 5_000 })
  return labels
}

test.describe('TC-CHANNEL-EMAIL-HUB-009: set-primary row action follows channel status', () => {
  test('a disconnected channel row has no "Set as primary" action', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let liveChannel: string | null = null
    let disconnectedChannel: string | null = null
    const liveName = `HUB-009 live ${stamp}`
    const disconnectedName = `HUB-009 gone ${stamp}`
    try {
      adminToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed channels.',
      )

      liveChannel = await seedConnectedChannel(request, adminToken, {
        displayName: liveName,
        externalIdentifier: `hub-009-live-${stamp}@test-seed.local`,
      })
      disconnectedChannel = await seedConnectedChannel(request, adminToken, {
        displayName: disconnectedName,
        externalIdentifier: `hub-009-gone-${stamp}@test-seed.local`,
      })
      await disconnectSeededChannel(request, adminToken, disconnectedChannel)

      await login(page, 'admin')
      await page.goto('/backend/profile/communication-channels', { waitUntil: 'domcontentloaded' })

      expect(await rowMenuItems(page, liveName)).toContain('Set as primary')
      expect(await rowMenuItems(page, disconnectedName)).not.toContain('Set as primary')
    } finally {
      await deleteChannelIfExists(request, adminToken, liveChannel)
      await deleteChannelIfExists(request, adminToken, disconnectedChannel)
    }
  })
})
