import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-057: Activity History date-range filter chevron does not overlap text (issue #1811).
 *
 * Spec: .ai/specs/2026-05-06-crm-fixes-3.md (Cluster F — Step 2).
 *
 * Issue #1811 reported the activity-log "Last 90 days" trigger rendering its chevron icon
 * on top of the selected text in Edge. The legacy implementation used a native `<select>`
 * with `appearance` defaults; on some Chromium/Edge variants the OS-drawn caret would
 * overlap the longest option label. The fix swaps the native control for the DS `Select`
 * primitive, which reserves space for the chevron via a flex layout (the trigger uses
 * `inline-flex justify-between` and the icon is a sibling of the label span, not an
 * overlay on top of it).
 *
 * This test asserts the visual contract:
 *   1. The trigger renders as an ARIA combobox (DS Select primitive, not a native select).
 *   2. There is at least 16px of horizontal gap between the right edge of the visible
 *      label and the right edge of the trigger — enough room for a 14-16px chevron icon.
 */
test.describe('TC-CRM-057: Activity history date-range chevron padding (#1811)', () => {
  test('Date-range trigger has DS chevron spacing and no label/icon overlap', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-057 Co ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      await page.getByRole('tab', { name: /Activity log/i }).click()

      const trigger = page.getByRole('combobox', { name: /Date range/i })
      await trigger.scrollIntoViewIfNeeded()
      await expect(trigger).toBeVisible({ timeout: 30_000 })

      const triggerHandle = await trigger.elementHandle()
      expect(triggerHandle, 'Date-range trigger element handle').not.toBeNull()

      const measurements = await trigger.evaluate((node) => {
        const triggerRect = node.getBoundingClientRect()
        const labelSpan = node.querySelector('span') as HTMLElement | null
        const labelRect = labelSpan ? labelSpan.getBoundingClientRect() : null
        const chevron = node.querySelector('svg') as SVGElement | null
        const chevronRect = chevron ? chevron.getBoundingClientRect() : null
        return {
          triggerRect: { x: triggerRect.x, width: triggerRect.width },
          labelRect: labelRect ? { x: labelRect.x, width: labelRect.width } : null,
          chevronRect: chevronRect ? { x: chevronRect.x, width: chevronRect.width } : null,
          labelText: labelSpan?.textContent ?? '',
        }
      })

      expect(measurements.labelRect, 'Trigger label span should exist').not.toBeNull()
      expect(measurements.chevronRect, 'Trigger chevron icon should exist').not.toBeNull()
      expect(measurements.labelText.toLowerCase()).toContain('last')

      if (measurements.labelRect && measurements.chevronRect) {
        const labelRightEdge = measurements.labelRect.x + measurements.labelRect.width
        const chevronLeftEdge = measurements.chevronRect.x
        const triggerRightEdge = measurements.triggerRect.x + measurements.triggerRect.width

        // The chevron must sit to the right of the label (no horizontal overlap).
        expect(
          chevronLeftEdge,
          'Chevron should not overlap the label text',
        ).toBeGreaterThanOrEqual(labelRightEdge)

        // The DS Select trigger reserves >=16px on the right for chevron + padding.
        const reservedSpace = triggerRightEdge - labelRightEdge
        expect(
          reservedSpace,
          'DS Select must reserve >=16px between label and trigger right edge for the chevron',
        ).toBeGreaterThanOrEqual(16)
      }

      // Verify the longest option ("Last 90 days") behaves the same way once selected.
      await trigger.click()
      await page.getByRole('option', { name: /Last 90 days/i }).click()
      await expect(trigger).toContainText(/Last 90 days/i, { timeout: 10_000 })

      const post = await trigger.evaluate((node) => {
        const triggerRect = node.getBoundingClientRect()
        const labelSpan = node.querySelector('span') as HTMLElement | null
        const labelRect = labelSpan ? labelSpan.getBoundingClientRect() : null
        const chevron = node.querySelector('svg') as SVGElement | null
        const chevronRect = chevron ? chevron.getBoundingClientRect() : null
        return {
          triggerRect: { x: triggerRect.x, width: triggerRect.width },
          labelRect: labelRect ? { x: labelRect.x, width: labelRect.width } : null,
          chevronRect: chevronRect ? { x: chevronRect.x, width: chevronRect.width } : null,
          labelText: labelSpan?.textContent ?? '',
        }
      })

      expect(post.labelText).toMatch(/last 90 days/i)
      expect(post.labelRect).not.toBeNull()
      expect(post.chevronRect).not.toBeNull()

      if (post.labelRect && post.chevronRect) {
        const labelRightEdge = post.labelRect.x + post.labelRect.width
        const chevronLeftEdge = post.chevronRect.x
        const triggerRightEdge = post.triggerRect.x + post.triggerRect.width
        expect(chevronLeftEdge).toBeGreaterThanOrEqual(labelRightEdge)
        expect(triggerRightEdge - labelRightEdge).toBeGreaterThanOrEqual(16)
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
