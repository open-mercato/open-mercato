import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createResourceFixture, deleteResourceIfExists } from './helpers/resourcesFixtures'

/**
 * TC-RESO-AVAILABILITY-HEADING-LOCALE (issue #9517, follow-up from #9063):
 * #9063 shipped dictionary unit tests for `resources.resources.availability.section.title`,
 * but never verified the rendered heading in the browser. This exercises the
 * live `AvailabilityRulesEditor` heading on the resource detail page across
 * locales, and that the sibling `resources.teamMembers.*` key stays distinct.
 */
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

function loadLocale(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>
}

test.describe('TC-RESO-AVAILABILITY-HEADING-LOCALE: resource availability heading renders per locale', () => {
  test('renders the translated Availability heading and preserves the staff sibling key', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let resourceId: string | null = null

    try {
      resourceId = await createResourceFixture(request, token, `QA Availability Heading ${stamp}`)
      await login(page, 'admin')

      for (const locale of LOCALES) {
        const dictionary = loadLocale(locale)
        const expectedHeading = dictionary['resources.resources.availability.section.title']
        expect(expectedHeading, `${locale} dictionary should define the availability section title`).toBeTruthy()

        // Preserve the staff/team-members sibling heading: it must keep its own
        // translation under a distinct key, never collapse into the resources one.
        expect(dictionary['resources.teamMembers.availability.section.title']).toBeTruthy()

        await page.context().addCookies([
          { name: 'locale', value: locale, url: new URL(page.url()).origin },
        ])
        await page.goto(
          `/backend/resources/resources/${encodeURIComponent(resourceId)}?tab=availability`,
          { waitUntil: 'domcontentloaded' },
        )

        const heading = page.getByRole('heading', { name: expectedHeading, exact: true })
        await expect(heading).toBeVisible({ timeout: 30_000 })

        await page.setViewportSize({ width: 375, height: 900 })
        await expect(heading).toBeVisible()
        await expect.poll(async () => {
          const bounds = await heading.boundingBox()
          return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= 375
        }).toBe(true)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
        await page.setViewportSize({ width: 1280, height: 900 })
      }
    } finally {
      await deleteResourceIfExists(request, token, resourceId)
    }
  })
})
