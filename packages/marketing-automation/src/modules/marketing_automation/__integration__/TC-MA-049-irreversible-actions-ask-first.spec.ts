import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

const IMPORT_PATH = '/api/marketing_automation/consent/import'

/**
 * TC-MA-049: the two irreversible actions a marketer can reach in one click now ask first.
 *
 * Both used to run the moment they were clicked. The assertions are on the NEGATIVE half — what happens when
 * somebody says no — because that is the half the change exists for and the half no happy path covers: the
 * request must not be sent at all, not merely be undone afterwards, since neither action has an undo.
 *
 * The winner promotion has the same guard, and is held by
 * `backend/__tests__/irreversible-actions-ask-first.test.ts` instead: its button only renders once lanes have
 * recorded deliveries, which is not a state a browser spec can build cheaply.
 */
async function dialog(page: Page, text: string) {
  const box = page.getByRole('alertdialog')
  await expect(box).toBeVisible()
  await expect(box).toContainText(text)
  return box
}

/** Counts requests to a path for the life of one test, so "nothing was sent" is an assertion rather than a hope. */
function countRequests(page: Page, pathFragment: string, method: string) {
  const seen: string[] = []
  page.on('request', (request) => {
    if (request.url().includes(pathFragment) && request.method() === method) seen.push(request.url())
  })
  return () => seen.length
}

test.describe('TC-MA-049 actions nothing can undo ask first', () => {
  test.describe.configure({ timeout: 90_000 })

  test('a suppression import is not sent until it is confirmed', async ({ page }) => {
    await login(page, 'admin')
    const imports = countRequests(page, IMPORT_PATH, 'POST')

    await page.goto('/backend/marketing/settings', { waitUntil: 'domcontentloaded' })
    const reason = page.locator('#suppression-reason')
    await expect(reason).toBeVisible({ timeout: 20_000 })
    await fillControlledInput(reason, 'TC-MA-049 confirmation test')

    /**
     * An address that matches nobody on purpose. The confirmed path below really does run the import, and this
     * spec must not unsubscribe a customer another spec then finds missing from an audience.
     */
    const stranger = `nobody-${Date.now()}@example.invalid`
    const csv = `email\n${stranger}\n`

    await page.locator('#suppression-file').setInputFiles({
      name: 'suppression.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    })

    // The file's name is in the question, which is what makes a wrong pick visible while it still costs nothing.
    const asked = await dialog(page, 'suppression.csv')
    await expect(asked).toContainText('cannot be undone')
    await asked.getByRole('button', { name: 'Cancel' }).click()
    await expect(asked).toBeHidden()
    expect(imports()).toBe(0)

    // Choosing the same file again re-asks: the input is reset on purpose so a cancel is not a dead end.
    await page.locator('#suppression-file').setInputFiles({
      name: 'suppression.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    })
    const confirmed = await dialog(page, 'suppression.csv')
    const posted = page.waitForResponse((response) =>
      response.url().includes(IMPORT_PATH) && response.request().method() === 'POST')
    await confirmed.getByRole('button', { name: 'Confirm' }).click()
    expect((await posted).status()).toBe(200)
    expect(imports()).toBe(1)
    // The summary is what tells an operator their list was only partly applied.
    await expect(page.getByText('matched no customer here')).toBeVisible()
  })

  test('a version is not restored until it is confirmed', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-049 ${Date.now()}`)

    try {
      const created = await getCampaign(request, token, campaignId)
      const first = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: created.name,
        triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{ id: 's1', type: 'send_email', params: { subject: 'First', bodyHtml: '<p>First</p>' } }],
        },
      })
      expect(first.status()).toBe(200)

      const afterFirst = await getCampaign(request, token, campaignId)
      const second = await saveGraph(request, token, campaignId, {
        updatedAt: afterFirst.updatedAt,
        name: afterFirst.name,
        triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{ id: 's1', type: 'send_email', params: { subject: 'Second', bodyHtml: '<p>Second</p>' } }],
        },
      })
      expect(second.status()).toBe(200)

      await login(page, 'admin')
      const restores = countRequests(page, `${CAMPAIGNS_PATH}/${campaignId}/revisions/1/restore`, 'POST')

      const loaded = page.waitForResponse((response) =>
        response.url().includes(`${CAMPAIGNS_PATH}/${campaignId}`) && response.request().method() === 'GET')
      await page.goto(`/backend/marketing/campaigns/${campaignId}`, { waitUntil: 'domcontentloaded' })
      await loaded
      await expect(page.locator('#campaign-name')).toBeVisible({ timeout: 20_000 })

      const listed = page.waitForResponse((response) =>
        response.url().includes(`${CAMPAIGNS_PATH}/${campaignId}/revisions`) && response.request().method() === 'GET')
      await page.getByRole('button', { name: 'Show saved versions' }).click()
      await listed

      const versionOne = page.locator('li').filter({ hasText: 'v1' }).first()
      await versionOne.getByRole('button', { name: 'Restore' }).click()
      const asked = await dialog(page, 'Put version 1 back?')
      // The reassurance that makes it a decision somebody is willing to take rather than one they avoid.
      await expect(asked).toContainText('kept as a version you can return to')
      await asked.getByRole('button', { name: 'Cancel' }).click()
      await expect(asked).toBeHidden()
      expect(restores()).toBe(0)

      // And the campaign still says what the second save said, since nothing was sent.
      const untouched = await getCampaign(request, token, campaignId)
      expect(JSON.stringify(untouched.definition)).toContain('Second')

      await versionOne.getByRole('button', { name: 'Restore' }).click()
      const confirmed = await dialog(page, 'Put version 1 back?')
      const posted = page.waitForResponse((response) =>
        response.url().includes(`${CAMPAIGNS_PATH}/${campaignId}/revisions/1/restore`)
        && response.request().method() === 'POST')
      await confirmed.getByRole('button', { name: 'Confirm' }).click()
      expect((await posted).status()).toBe(200)

      const restored = await getCampaign(request, token, campaignId)
      expect(JSON.stringify(restored.definition)).toContain('First')
      // A restore is an ordinary save, so it becomes a third version rather than rewriting the first.
      const history = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/revisions`, { token })
      const versions = ((await history.json()) as { items?: Array<{ version?: number }> }).items ?? []
      expect(versions.map((item) => item.version)).toContain(3)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
