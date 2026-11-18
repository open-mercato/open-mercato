import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/helpers/integration/ui'
import { skipIfUndoTestsDisabled, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'
import { createBuilding, deleteBuildingIfExists, stampOf } from './helpers'
import { bookingDay, cleanupBookingSetup, createBooking, createBookingSetup, type BookingSetup } from './bookingFixtures'
import { isoDayFromToday } from './leaseFixtures'
import { confirmClosure, endClosure, endClosures, listClosures } from './unavailabilityFixtures'
import { watchHydration } from './hydrationWatch'

type ActionRow = { commandId: string; resourceId: string | null; undoToken: string | null; executionState: string }

async function findEndUndoToken(request: Parameters<typeof apiRequest>[0], token: string, closureId: string): Promise<string> {
  const query = new URLSearchParams({
    resourceKind: 'property_management.unavailability',
    resourceId: closureId,
    undoableOnly: 'true',
    pageSize: '20',
  })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query.toString()}`, { token })
  const body = await readJsonSafe<{ items?: ActionRow[] }>(response)
  expect(response.status(), `GET audit-logs/actions → ${JSON.stringify(body)}`).toBe(200)
  const action = (body?.items ?? []).find(
    (item) => item.commandId === 'property_management.unavailability.end' && item.executionState === 'done' && Boolean(item.undoToken),
  )
  expect(action, 'the end command is logged with an undo token').toBeTruthy()
  return action?.undoToken as string
}

export const integrationMeta = {
  dependsOnModules: ['property_management'],
}

/**
 * TC-PM-029: Availability switch on the buildings list
 * Switching a building off opens the dialog (reason, from, until) with the dry-run preview; confirm stays
 * disabled until there is a reason; confirming switches the row off and shows the reason beneath it.
 * Switching it back on takes effect at once. Undoing the end of a closure is refused (409
 * unavailability_undo_bookings) once a booking was made inside the restored window.
 */
test.describe('TC-PM-029: availability switch', () => {
  test('switches a building off through the dialog and back on', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    const name = `TC-PM-029 Building ${stamp}`
    let buildingId: string | null = null
    const closureIds: string[] = []
    try {
      buildingId = await createBuilding(request, token, { name })
      const watch = watchHydration(page)
      await login(page, 'admin')
      await page.goto('/backend/property_management/buildings')
      const searched = page.waitForResponse((candidate) => {
        const url = new URL(candidate.url())
        return url.pathname === '/api/property_management/buildings' && url.searchParams.get('search') === name
      })
      await fillControlledInput(page.getByPlaceholder('Search buildings'), name)
      await searched
      await expect(page.locator('tbody tr'), 'the list settles on the searched building').toHaveCount(1)
      const toggle = page.getByTestId(`pm-availability-switch-building-${buildingId}`)
      await expect(toggle).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')

      const dialog = page.getByRole('dialog')
      await expect(async () => {
        if (!(await dialog.isVisible())) await toggle.click()
        await expect(dialog).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      const confirm = dialog.getByTestId('pm-availability-confirm')
      await expect(confirm).toBeDisabled()
      await fillControlledInput(dialog.getByLabel('Description'), 'QA renovation')
      await expect(confirm).toBeEnabled()
      const created = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          candidate.url().includes('/api/property_management/unavailabilities') &&
          !candidate.url().includes('dryRun=true'),
      )
      await confirm.click()
      const response = await created
      expect(response.status(), 'confirming creates the unavailability').toBe(201)
      await expect(dialog).toBeHidden()
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByTestId(`pm-availability-hint-${buildingId}`)).toContainText('QA renovation')
      closureIds.push(...(await listClosures(request, token, buildingId)).map((row) => row.id))

      const ended = await waitForApiMutation(page, '/end', async () => {
        await toggle.click()
      }, 'POST')
      expect(ended.status()).toBe(200)
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      watch.assertClean()
    } finally {
      await endClosures(request, token, closureIds)
      await deleteBuildingIfExists(request, token, buildingId)
    }
  })

  test('refuses to undo the end of a closure once a booking was made in the restored window', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    const closureIds: string[] = []
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(2)
      const closure = await confirmClosure(
        request,
        token,
        { subjectType: 'unit', subjectId: unitId, startsAt: `${isoDayFromToday(0)}T00:00`, endsAt: `${bookingDay(5)}T00:00`, reasonText: 'QA undo' },
        closureIds,
      )
      const ended = await endClosure(request, token, closure.id)
      expect(ended.status(), `end → ${JSON.stringify(await readJsonSafe(ended))}`).toBe(200)

      await createBooking(request, token, setup, {
        unitId,
        startsAt: `${day}T10:00`,
        endsAt: `${day}T11:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })

      const undoToken = await findEndUndoToken(request, token, closure.id)
      const undone = await undoByToken(request, token, undoToken)
      const undoneBody = await readJsonSafe<{ code?: string; bookingCount?: number }>(undone)
      expect(undone.status(), `undo end → ${JSON.stringify(undoneBody)}`).toBe(409)
      expect(undoneBody?.code).toBe('unavailability_undo_bookings')
      expect(undoneBody?.bookingCount).toBe(1)
      expect(await listClosures(request, token, setup.buildingId as string), 'the closure stays ended').toEqual([])
    } finally {
      await endClosures(request, token, closureIds)
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
