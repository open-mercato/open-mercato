/**
 * TC-CRM-7206: Deal detail page fits a 390px viewport
 * Source: https://github.com/open-mercato/open-mercato/issues/7206
 *
 * Verifies:
 * - At 390px the deal detail page does not scroll horizontally
 * - Log activity header, Mark done, AI action chips and Related documents actions stay inside their cards
 * - At desktop width the composer header and the Mark done row keep their single-row layout
 */
import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type CardOverflow = { text: string; right: number; cardRight: number }

async function collectCardOverflow(page: Page, labels: string[]): Promise<CardOverflow[]> {
  return page.evaluate((targetLabels) => {
    const isInsideScroller = (element: Element) => {
      let node = element.parentElement
      while (node) {
        if (['auto', 'scroll'].includes(getComputedStyle(node).overflowX)) return true
        node = node.parentElement
      }
      return false
    }
    return Array.from(document.querySelectorAll('main button'))
      .filter((button) => targetLabels.some((label) => (button.textContent ?? '').trim() === label))
      .filter((button) => button.getBoundingClientRect().width > 0 && !isInsideScroller(button))
      .map((button) => {
        const card = button.parentElement?.closest('.rounded-2xl, .rounded-xl, .rounded-lg')
        return {
          text: (button.textContent ?? '').trim(),
          right: Math.round(button.getBoundingClientRect().right),
          cardRight: Math.round(card ? card.getBoundingClientRect().right : window.innerWidth),
        }
      })
      .filter((entry) => entry.right > entry.cardRight + 1)
  }, labels)
}

async function verticalCenter(page: Page, locatorText: string, role: 'button' | 'heading'): Promise<number> {
  const box = await page.getByRole(role, { name: locatorText }).first().boundingBox()
  expect(box, `${locatorText} should be rendered`).not.toBeNull()
  return box ? box.y + box.height / 2 : 0
}

test.describe('TC-CRM-7206: deal detail page fits a 390px viewport', () => {
  test('deal detail page does not overflow horizontally on a phone-width viewport', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const plannedTitle = `Planned call ${stamp}`
    const completedTitle = `Completed call ${stamp}`
    let token: string | null = null
    let personId: string | null = null
    let dealId: string | null = null
    let documentId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, {
        firstName: 'Mobile',
        lastName: `Layout ${stamp}`,
        displayName: `Mobile Layout ${stamp}`,
      })
      dealId = await createDealFixture(request, token, { title: `QA Mobile Deal ${stamp}`, personIds: [personId] })

      const planned = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personId,
          dealId,
          interactionType: 'call',
          title: plannedTitle,
          status: 'planned',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
      expect(planned.status(), 'planned activity should be created').toBeLessThan(400)
      const completed = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personId,
          dealId,
          interactionType: 'call',
          title: completedTitle,
          status: 'done',
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
        },
      })
      expect(completed.status(), 'completed activity should be created').toBeLessThan(400)

      const documentResponse = await apiRequest(request, 'POST', '/api/documents', {
        token,
        data: { title: `QA Mobile Doc ${stamp}`, folderId: null },
      })
      expect(documentResponse.status(), 'document should be created').toBe(201)
      documentId = ((await readJsonSafe(documentResponse)) as { id?: string } | null)?.id ?? null
      expect(documentId, 'document id should be returned').toBeTruthy()
      const linkResponse = await apiRequest(request, 'POST', `/api/documents/${documentId}/links`, {
        token,
        data: {
          entityType: 'deal',
          entityId: dealId,
          label: `QA Mobile Deal ${stamp}`,
          href: `/backend/customers/deals/${dealId}`,
          source: 'related-panel',
        },
      })
      expect(linkResponse.status(), 'document should be linked to the deal').toBe(201)

      await login(page, 'admin')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/backend/customers/deals/${dealId}`)
      await expect(page.getByText(completedTitle).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'New from template' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Mark done' }).first()).toBeVisible()

      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(widths.scrollWidth, 'deal page should not scroll horizontally at 390px').toBeLessThanOrEqual(widths.clientWidth)

      const overflowing = await collectCardOverflow(page, [
        'Schedule',
        'Save activity',
        'Mark done',
        'Transcription',
        'Action items',
        'Link existing',
        'New from template',
      ])
      expect(overflowing, 'actions should stay inside their cards at 390px').toEqual([])

      await page.setViewportSize({ width: 1440, height: 900 })
      await expect(page.getByRole('button', { name: 'Save activity' })).toBeVisible()
      const headingCenter = await verticalCenter(page, 'Log activity', 'heading')
      const saveCenter = await verticalCenter(page, 'Save activity', 'button')
      expect(Math.abs(headingCenter - saveCenter), 'composer header should stay on one row on desktop').toBeLessThan(4)
      const plannedRow = page.getByText(plannedTitle).last()
      const plannedBox = await plannedRow.boundingBox()
      const markDoneBox = await page.getByRole('button', { name: 'Mark done' }).last().boundingBox()
      expect(plannedBox && markDoneBox, 'timeline row should be rendered').toBeTruthy()
      if (plannedBox && markDoneBox) {
        expect(markDoneBox.y, 'Mark done should stay on the title row on desktop').toBeLessThan(plannedBox.y + plannedBox.height)
      }
    } finally {
      if (documentId && token) {
        await apiRequest(request, 'DELETE', `/api/documents/${documentId}`, { token }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
