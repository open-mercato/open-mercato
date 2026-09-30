import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'

export const integrationMeta = { dependsOnModules: ['example', 'customers', 'planner', 'resources'] }

const START = '2026-10-05T09:00:00.000Z'
const END = '2026-10-05T10:00:00.000Z'

test.describe('TC-EXAMPLE-018: Visit availability API and direct write guard', () => {
  test('mounts the Visit panel without changing the default type choices', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/calendar')
    await page.getByRole('button', { name: 'New event' }).click()
    const dialog = page.getByRole('dialog', { name: 'New event' })
    const typeChoices = dialog.getByRole('group', { name: 'Event type' })
    await expect(typeChoices.getByRole('button', { name: 'Meeting', exact: true })).toBeVisible()
    await expect(typeChoices.getByRole('button', { name: 'Note', exact: true })).toBeVisible()
    await typeChoices.getByRole('button', { name: 'Visit' }).click()
    await expect(dialog.getByTestId('example-visit-panel')).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Visit availability' })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Start time' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save event' })).toBeVisible()
  })

  test('previews an unscheduled resource and rejects direct create/update while preserving the Visit', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    let resourceId: string | null = null
    let visitId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: 'Visit', lastName: `QA${stamp}`, displayName: `Visit QA ${stamp}`,
      })
      const resource = await apiRequest(request, 'POST', '/api/resources/resources', {
        token, data: { name: `Visit QA room ${stamp}`, isActive: true },
      })
      expect(resource.status(), await resource.text()).toBe(201)
      resourceId = (await resource.json() as { id?: string }).id ?? null
      expect(resourceId).toBeTruthy()

      const catalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(catalogResponse.status(), await catalogResponse.text()).toBe(200)
      const catalog = await catalogResponse.json() as { items: Array<{ key: string; label: string; selectable: boolean; panelKey?: string; labelKey?: string }> }
      expect(catalog.items.find((item) => item.key === 'visit')).toMatchObject({ selectable: true, panelKey: 'example.visit' })
      expect(catalog.items.find((item) => item.key === 'meeting')).toMatchObject({ selectable: true })
      expect(catalog.items.find((item) => item.key === 'note')).toMatchObject({ selectable: true })

      const query = new URLSearchParams({ startAt: START, endAt: END, resourceIds: resourceId! })
      const preview = await apiRequest(request, 'GET', `/api/example/visit-availability?${query.toString()}`, { token })
      expect(preview.status(), await preview.text()).toBe(200)
      expect(await preview.json()).toEqual({ subjects: [{
        type: 'resource', id: resourceId, status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.noSchedule',
      }], warnings: [] })

      const visitInput = { entityId: personId, interactionType: 'visit', title: `Visit QA ${stamp}`, scheduledAt: START, durationMinutes: 60 }
      const rejected = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { ...visitInput, linkedEntities: [{ type: 'resource', id: resourceId, label: `Visit QA room ${stamp}` }] },
      })
      expect(rejected.status()).toBe(422)
      expect(await rejected.json()).toMatchObject({ code: 'visit_availability_unavailable', fields: ['linkedEntities'] })

      const accepted = await apiRequest(request, 'POST', '/api/customers/interactions', { token, data: visitInput })
      expect(accepted.status(), await accepted.text()).toBe(201)
      visitId = (await accepted.json() as { id?: string }).id ?? null
      expect(visitId).toBeTruthy()

      const titleUpdate = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: visitId, title: `Renamed Visit QA ${stamp}` },
      })
      expect(titleUpdate.status(), await titleUpdate.text()).toBe(200)

      const update = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token,
        data: { id: visitId, linkedEntities: [{ type: 'resource', id: resourceId, label: `Visit QA room ${stamp}` }] },
      })
      expect(update.status()).toBe(422)
      expect(await update.json()).toMatchObject({ code: 'visit_availability_unavailable', fields: ['linkedEntities'] })

      const list = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}&from=2026-10-05T00%3A00%3A00Z&to=2026-10-06T00%3A00%3A00Z`, { token })
      expect(list.status(), await list.text()).toBe(200)
      const row = ((await list.json()) as { items?: Array<{ id: string; linkedEntities?: unknown[] }> }).items?.find((item) => item.id === visitId)
      expect(row).toBeTruthy()
      expect(row?.linkedEntities ?? []).toEqual([])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', visitId)
      await deleteEntityIfExists(request, token, '/api/resources/resources', resourceId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
