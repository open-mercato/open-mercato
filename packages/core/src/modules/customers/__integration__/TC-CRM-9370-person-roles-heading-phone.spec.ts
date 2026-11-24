import { expect, test, type Locator, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const DISPLAY_NAME = 'QA Invitation dbdbdbdbdbdb'
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 720 },
]

async function expectHeadingContained(page: Page, heading: Locator, viewportWidth: number, state: string): Promise<void> {
  const label = `${viewportWidth}px, ${state}`
  await heading.scrollIntoViewIfNeeded()
  const card = page.locator('[data-collapsible-group-id="roles"]')
  const headingBox = await heading.boundingBox()
  const cardBox = await card.boundingBox()
  expect(headingBox, 'heading has a layout box').not.toBeNull()
  expect(cardBox, 'roles group has a layout box').not.toBeNull()
  const headingRight = (headingBox?.x ?? 0) + (headingBox?.width ?? 0)
  expect(headingRight, `heading stays inside its group (${label})`).toBeLessThanOrEqual(
    (cardBox?.x ?? 0) + (cardBox?.width ?? 0),
  )
  expect(headingRight, `heading stays inside the viewport (${label})`).toBeLessThanOrEqual(viewportWidth)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `document width (${label})` })
    .toBeLessThanOrEqual(viewportWidth)
}

/**
 * TC-CRM-9370: the "My roles with …" group heading on a phone (#9370).
 *
 * A person named "QA Invitation <12 hex characters>" made the collapsible
 * group heading wider than its card, and on the narrowest phones wider than
 * the document. The heading must stay inside its group and the viewport, keep
 * its full accessible name, and leave the page without a horizontal scroll,
 * collapsed and expanded, at 390 and 320 px.
 */
test('TC-CRM-9370: a long person name keeps the roles heading inside a phone screen', async ({ page, request }) => {
  test.slow()

  const token = await getAuthToken(request, 'admin')
  let personId: string | null = null

  try {
    personId = await createPersonFixture(request, token, {
      firstName: 'QA',
      lastName: 'Invitation dbdbdbdbdbdb',
      displayName: DISPLAY_NAME,
    })

    await login(page, 'admin')
    await page.setViewportSize(VIEWPORTS[0])
    await page.evaluate(() => {
      localStorage.setItem('om:zone1-collapsed:person-v2', JSON.stringify('0'))
    })
    await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' })

    const heading = page
      .locator('[data-collapsible-group-id="roles"]')
      .getByRole('button', { name: `My roles with ${DISPLAY_NAME}` })
      .first()
    await expect(heading).toBeVisible({ timeout: 30_000 })

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      const wasExpanded = (await heading.getAttribute('aria-expanded')) === 'true'
      await expectHeadingContained(page, heading, viewport.width, wasExpanded ? 'expanded' : 'collapsed')

      await heading.click()
      await expect(heading).toHaveAttribute('aria-expanded', wasExpanded ? 'false' : 'true')
      await expectHeadingContained(page, heading, viewport.width, wasExpanded ? 'collapsed' : 'expanded')

      await heading.click()
      await expect(heading).toHaveAttribute('aria-expanded', wasExpanded ? 'true' : 'false')
    }
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})
