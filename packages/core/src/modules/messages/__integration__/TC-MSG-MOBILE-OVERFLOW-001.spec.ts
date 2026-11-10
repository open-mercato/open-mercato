import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  composeInternalMessage,
  deleteMessageIfExists,
  messageRowBySubject,
  searchMessages,
  selectMessageFolder,
} from './helpers'

async function expectViewportContained(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(0)
}

for (const unknownDate of [false, true]) {
  test(`long sent messages with ${unknownDate ? 'unknown' : 'valid'} dates stay within the mobile viewport`, async ({
    page,
    request,
  }, testInfo) => {
    let messageId: string | null = null
    let senderToken: string | null = null
    const subject = `Mobile ${Date.now()} ${'LongSubject'.repeat(8)}`
    const body = `Ordinary multiline message body with enough words to exercise the message preview.\n${'LongBodyToken'.repeat(30)}`

    try {
      const fixture = await composeInternalMessage(request, { subject, body })
      messageId = fixture.messageId
      senderToken = fixture.senderToken
      await page.setViewportSize({ width: 390, height: 844 })
      await login(page, 'admin')

      if (unknownDate) {
        await withClient(async (client) => {
          const result = await client.query(
            'UPDATE messages SET sent_at = NULL WHERE id = $1 RETURNING id',
            [messageId],
          )
          expect(result.rowCount).toBe(1)
        })
      }
      await page.goto('/backend/messages')
      await selectMessageFolder(page, 'Sent')
      await searchMessages(page, subject)
      const row = messageRowBySubject(page, subject)
      await expect(row).toBeVisible()
      await expectViewportContained(page)
      await page.screenshot({
        path: testInfo.outputPath(
          `mobile-list-${unknownDate ? 'unknown' : 'valid'}-date.png`,
        ),
        fullPage: true,
      })
      await row.getByRole('button', { name: /Open message/ }).click()
      await expect(
        page.getByRole('heading', { level: 1 }).filter({ hasText: subject }),
      ).toBeVisible()
      await expect(page.getByText(body, { exact: true })).toBeVisible()
      if (unknownDate)
        await expect(
          page.getByText('Unknown date', { exact: true }).first(),
        ).toBeVisible()
      await expectViewportContained(page)
      await page
        .getByRole('button', { name: 'Conversation actions', exact: true })
        .hover()
      await page
        .getByRole('menuitem', { name: 'Forward all', exact: true })
        .click()
      await expect(
        page.getByRole('button', { name: 'Forward', exact: true }),
      ).toBeVisible()
      await expectViewportContained(page)
      await page.screenshot({
        path: testInfo.outputPath(
          `mobile-forward-${unknownDate ? 'unknown' : 'valid'}-date.png`,
        ),
        fullPage: true,
      })
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(
        page.getByRole('button', { name: 'Forward', exact: true }),
      ).toHaveCount(0)

      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto('/backend/messages')
      await selectMessageFolder(page, 'Sent')
      await searchMessages(page, subject)
      await expect(messageRowBySubject(page, subject)).toBeVisible()
      await expectViewportContained(page)
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId)
    }
  })
}
