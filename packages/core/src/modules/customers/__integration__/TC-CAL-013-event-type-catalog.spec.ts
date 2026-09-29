import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

type Catalog = { fallbackKey: string; items: Array<{ key: string; selectable: boolean; behavior: { baseKind: string }; source: string }> }

test.describe('TC-CAL-013: scoped event-type catalog and command enforcement', () => {
  test('links calendar settings to the authoritative activity type manager', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/calendar')
    await page.getByRole('button', { name: 'Calendar settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Customization' })
    const manageLink = settings.getByRole('link', { name: 'Manage activity types' })
    await expect(manageLink).toHaveAttribute('href', '/backend/config/customers#customer-dictionary-activity-types')
    await manageLink.click()
    await expect(page).toHaveURL(/\/backend\/config\/customers#customer-dictionary-activity-types$/)
    await expect(page.getByRole('button', { name: 'New activity type' })).toBeVisible()
  })

  test('publishes effective types and rejects an unknown key through the interaction API', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    let meetingId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const catalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(catalogResponse.status(), await catalogResponse.text()).toBe(200)
      const catalog = await catalogResponse.json() as Catalog
      expect(catalog.fallbackKey).toBe('meeting')
      expect(catalog.items.find((item) => item.key === 'meeting')).toMatchObject({ selectable: true, behavior: { baseKind: 'meeting' } })
      expect(new Set(catalog.items.map((item) => item.key)).size).toBe(catalog.items.length)

      personId = await createPersonFixture(request, token, {
        firstName: 'Calendar', lastName: `Type${Date.now()}`, displayName: `Calendar type QA ${Date.now()}`,
      })
      const rejected = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: personId, interactionType: 'qa_unregistered_type', title: 'Should be rejected' },
      })
      expect(rejected.status()).toBe(400)
      expect(await rejected.json()).toMatchObject({ code: 'activity_type_unavailable' })

      const accepted = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: personId, interactionType: 'meeting', title: 'Known catalog type' },
      })
      expect(accepted.status(), await accepted.text()).toBe(201)
      meetingId = (await accepted.json() as { id?: string }).id ?? null
      expect(meetingId).toBeTruthy()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', meetingId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('requires confirmation before a type switch discards stored values', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    let meetingId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, {
        firstName: 'Calendar', lastName: `Switch${Date.now()}`, displayName: `Calendar switch QA ${Date.now()}`,
      })
      const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personId, interactionType: 'meeting', title: 'Type switch QA',
          scheduledAt: '2026-10-05T09:00:00.000Z', durationMinutes: 60, location: 'Office',
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      meetingId = (await created.json() as { id?: string }).id ?? null
      expect(meetingId).toBeTruthy()

      const proposed = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: meetingId, interactionType: 'task' },
      })
      expect(proposed.status(), await proposed.text()).toBe(409)
      expect(await proposed.json()).toMatchObject({
        code: 'calendar_type_change_confirmation_required',
        fields: expect.arrayContaining(['durationMinutes', 'location']),
      })

      const confirmed = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: meetingId, interactionType: 'task', confirmDiscardInapplicableValues: true },
      })
      expect(confirmed.status(), await confirmed.text()).toBe(200)
      const list = await apiRequest(request, 'GET', '/api/customers/interactions?entityId=' + personId +
        '&from=2026-10-05T00%3A00%3A00Z&to=2026-10-06T00%3A00%3A00Z', { token })
      expect(list.status(), await list.text()).toBe(200)
      const row = ((await list.json()) as { items?: Array<{ id: string; interactionType: string; durationMinutes?: number | null; location?: string | null }> })
        .items?.find((item) => item.id === meetingId)
      expect(row).toMatchObject({ interactionType: 'task', durationMinutes: null, location: null })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', meetingId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('round-trips an administrator type through the dictionary and effective catalog APIs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const key = `qa_calendar_${Date.now()}`
    const dictionaryPath = '/api/customers/dictionaries/activity-types'
    let entryId: string | null = null
    let updatedAt: string | null = null
    try {
      const initialCatalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(initialCatalogResponse.status()).toBe(200)
      const initialCatalog = await initialCatalogResponse.json() as Catalog
      const meeting = initialCatalog.items.find((item) => item.key === 'meeting')
      expect(meeting).toBeTruthy()
      const behavior = { ...meeting!.behavior, order: 8000, selectable: true }

      const createdResponse = await apiRequest(request, 'POST', dictionaryPath, {
        token, data: { value: key, label: 'QA calendar type', behavior },
      })
      expect(createdResponse.status(), await createdResponse.text()).toBe(201)
      const created = await createdResponse.json() as { id?: string; updatedAt?: string }
      entryId = created.id ?? null
      updatedAt = created.updatedAt ?? null
      expect(entryId).toBeTruthy()

      const listedResponse = await apiRequest(request, 'GET', dictionaryPath, { token })
      expect(listedResponse.status()).toBe(200)
      const listed = await listedResponse.json() as { items?: Array<{ value: string; behavior: { order: number } }> }
      expect(listed.items?.find((item) => item.value === key)?.behavior.order).toBe(8000)

      const catalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(catalogResponse.status()).toBe(200)
      const catalog = await catalogResponse.json() as Catalog
      expect(catalog.items.find((item) => item.key === key)).toMatchObject({ label: 'QA calendar type', selectable: true, behavior: { order: 8000 } })

      const changedResponse = await apiRequest(request, 'PATCH', `${dictionaryPath}/${entryId}`, {
        token,
        headers: updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt } : undefined,
        data: { label: 'QA calendar type edited', behavior: { ...behavior, order: 8100 } },
      })
      expect(changedResponse.status(), await changedResponse.text()).toBe(200)
      const changed = await changedResponse.json() as { updatedAt?: string }
      updatedAt = changed.updatedAt ?? updatedAt
      const updatedCatalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(updatedCatalogResponse.status()).toBe(200)
      const updatedCatalog = await updatedCatalogResponse.json() as Catalog
      expect(updatedCatalog.items.find((item) => item.key === key)).toMatchObject({ label: 'QA calendar type edited', behavior: { order: 8100 } })
    } finally {
      if (entryId) await apiRequest(request, 'DELETE', `${dictionaryPath}/${entryId}`, {
        token, headers: updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt } : undefined,
      })
    }
  })

  test('does not expose a sibling organization’s activity type in the selected organization', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superToken = await getAuthToken(request, 'superadmin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const key = `qa_sibling_${Date.now()}`
    let siblingId: string | null = null
    let entryId: string | null = null
    let updatedAt: string | null = null
    try {
      const organizationResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superToken, data: { tenantId, name: `QA calendar sibling ${Date.now()}` },
      })
      expect(organizationResponse.status(), await organizationResponse.text()).toBe(201)
      siblingId = (await organizationResponse.json() as { id?: string }).id ?? null
      expect(siblingId).toBeTruthy()
      const siblingCookie = `om_selected_tenant=${tenantId}; om_selected_org=${siblingId}`

      const createdResponse = await apiRequest(request, 'POST', '/api/customers/dictionaries/activity-types', {
        token: superToken, headers: { Cookie: siblingCookie }, data: { value: key, label: 'Sibling only' },
      })
      expect(createdResponse.status(), await createdResponse.text()).toBe(201)
      const created = await createdResponse.json() as { id?: string; updatedAt?: string }
      entryId = created.id ?? null
      updatedAt = created.updatedAt ?? null
      expect(entryId).toBeTruthy()

      const selectedCatalogResponse = await apiRequest(request, 'GET', `/api/customers/activity-types?organizationId=${organizationId}`, { token: superToken })
      expect(selectedCatalogResponse.status()).toBe(200)
      const selectedCatalog = await selectedCatalogResponse.json() as Catalog
      expect(selectedCatalog.items.some((item) => item.key === key)).toBe(false)
      const selectedDictionaryResponse = await apiRequest(request, 'GET', `/api/customers/dictionaries/activity-types?organizationId=${organizationId}`, { token: superToken })
      expect(selectedDictionaryResponse.status()).toBe(200)
      const selectedDictionary = await selectedDictionaryResponse.json() as { items?: Array<{ value: string }> }
      expect(selectedDictionary.items?.some((item) => item.value === key)).toBe(false)

      const siblingCatalogResponse = await apiRequest(request, 'GET', `/api/customers/activity-types?organizationId=${siblingId}`, { token: superToken })
      expect(siblingCatalogResponse.status()).toBe(200)
      const siblingCatalog = await siblingCatalogResponse.json() as Catalog
      expect(siblingCatalog.items.find((item) => item.key === key)).toMatchObject({ label: 'Sibling only' })
    } finally {
      if (siblingId && entryId) await apiRequest(request, 'DELETE', `/api/customers/dictionaries/activity-types/${entryId}`, {
        token: superToken,
        headers: {
          Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${siblingId}`,
          ...(updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt } : {}),
        },
      }).catch(() => undefined)
      if (siblingId) await apiRequest(request, 'DELETE', `/api/directory/organizations?id=${siblingId}`, { token: superToken }).catch(() => undefined)
    }
  })
})
