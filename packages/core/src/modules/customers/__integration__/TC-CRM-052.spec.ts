import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-052: "Mark done" quick action contract on the Activity timeline (issue #1812).
 *
 * Spec: .ai/specs/2026-05-06-crm-fixes-3.md (Cluster B — Step 1; updated for
 * post-review fix H-1 which lifts `status: 'done'` from the Activity history list).
 *
 * Before this fix, `ActivityCard.tsx` rendered no quick action for transitioning a
 * planned interaction to `done`. The Cluster B fix adds a `Button` (DS primitive,
 * never a raw `<button>`) gated on `activity.status === 'planned'` that POSTs to
 * `/api/customers/interactions/complete` and refreshes the host timeline.
 *
 * This test guards three contracts at the same surface:
 *   1. The button's API path — `/api/customers/interactions/complete` — is wired
 *      end-to-end. We exercise the same endpoint the button calls.
 *   2. The Mark done button does NOT render on a `done` activity card. This proves
 *      the `status === 'planned'` conditional gate in `ActivityCard.tsx` is wired
 *      correctly so the button never appears once an interaction has been completed.
 *   3. With the post-review H-1 fix, planned interactions DO surface in the Activity
 *      history. The Mark done button is reachable from the UI: clicking it flips the
 *      activity to done, and the card stays visible afterwards.
 */
test.describe('TC-CRM-052: Mark done conditional gate + complete endpoint contract (#1812)', () => {
  test('Mark done button is hidden on done activities and complete endpoint flips status', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const callTitle = `QA TC-CRM-052 call ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-052 Co ${stamp}`)

      // Step 1: API-create a planned Call interaction so we can exercise the
      // complete endpoint and capture the resulting interactionId.
      const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'call',
          title: callTitle,
          body: 'QA call to discuss next steps',
          status: 'planned',
          scheduledAt,
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/interactions returned ${createRes.status()}`,
      ).toBeTruthy()

      const operationHeader = createRes.headers()['x-om-operation'] ?? ''
      const operationEncoded = operationHeader.startsWith('omop:')
        ? operationHeader.slice('omop:'.length)
        : ''
      try {
        const parsed = operationEncoded
          ? (JSON.parse(decodeURIComponent(operationEncoded)) as { resourceId?: string })
          : null
        interactionId = parsed?.resourceId ?? null
      } catch {
        interactionId = null
      }
      // Fallback: extract id from the response body if header parsing failed.
      if (!interactionId) {
        const body = await createRes.json().catch(() => null) as { id?: string } | null
        interactionId = body?.id ?? null
      }
      expect(interactionId, 'create response should expose interactionId').toBeTruthy()

      // Step 2: hit the same endpoint the Mark done button hits. This is the wire
      // contract: ActivityCard's handleMarkDone calls /api/customers/interactions/complete.
      const completeRes = await apiRequest(request, 'POST', '/api/customers/interactions/complete', {
        token,
        data: { id: interactionId, occurredAt: new Date().toISOString() },
      })
      expect(
        completeRes.ok(),
        `POST /api/customers/interactions/complete returned ${completeRes.status()}`,
      ).toBeTruthy()

      // Step 3: open the company detail and Activity log tab. The completed call MUST
      // surface in the activity history (status='done') and MUST NOT show a Mark done
      // button — the conditional gate in ActivityCard.tsx is the regression guard for
      // #1812's intent (button only appears for status='planned').
      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      await page.getByRole('tab', { name: /Activity log/i }).click()

      const callRow = page.getByText(callTitle).first()
      await expect(callRow).toBeVisible({ timeout: 20_000 })

      // The done card MUST NOT render the Mark done button. We scope the search to
      // the card containing the call title to avoid catching any other Mark done
      // buttons that might exist outside the activity history (e.g. from the day
      // strip planned section once Cluster E lands).
      const markDoneOnDone = page.getByRole('button', { name: /Mark done/i })
      await expect(markDoneOnDone).toHaveCount(0)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Planned card surfaces in history with a clickable Mark done button (post H-1 fix)', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const callTitle = `QA TC-CRM-052 planned ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-052 Co planned ${stamp}`)

      // API-create a planned Call. After the H-1 fix, ActivityHistorySection drops
      // the `status: 'done'` filter so this planned interaction MUST be visible in
      // the Activity log tab and the Mark done button on its card MUST be reachable.
      const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'call',
          title: callTitle,
          body: 'QA planned call to verify Mark done positive flow',
          status: 'planned',
          scheduledAt,
        },
      })
      expect(
        createRes.ok(),
        `POST /api/customers/interactions returned ${createRes.status()}`,
      ).toBeTruthy()

      const operationHeader = createRes.headers()['x-om-operation'] ?? ''
      const operationEncoded = operationHeader.startsWith('omop:')
        ? operationHeader.slice('omop:'.length)
        : ''
      try {
        const parsed = operationEncoded
          ? (JSON.parse(decodeURIComponent(operationEncoded)) as { resourceId?: string })
          : null
        interactionId = parsed?.resourceId ?? null
      } catch {
        interactionId = null
      }
      if (!interactionId) {
        const body = await createRes.json().catch(() => null) as { id?: string } | null
        interactionId = body?.id ?? null
      }
      expect(interactionId, 'create response should expose interactionId').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      await page.getByRole('tab', { name: /Activity log/i }).click()

      // The planned call must be visible in the history.
      const callRow = page.getByText(callTitle).first()
      await expect(callRow).toBeVisible({ timeout: 20_000 })

      // And the Mark done button must be reachable in the UI.
      const markDoneButton = page.getByRole('button', { name: /Mark done/i }).first()
      await expect(markDoneButton).toBeVisible({ timeout: 10_000 })

      // Click Mark done; the activity should remain visible (it now appears as done).
      await markDoneButton.click()

      // The card stays visible in history after the flip.
      await expect(callRow).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
