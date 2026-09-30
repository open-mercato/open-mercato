import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'

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
        fields: expect.arrayContaining(['location']),
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
      expect(row).toMatchObject({ interactionType: 'task', durationMinutes: 60, location: null })
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

      const originalVersion = updatedAt
      const changedResponse = await apiRequest(request, 'PATCH', `${dictionaryPath}/${entryId}`, {
        token,
        headers: updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt } : undefined,
        data: { label: 'QA calendar type edited', behavior: { ...behavior, order: 8100 } },
      })
      expect(changedResponse.status(), await changedResponse.text()).toBe(200)
      const changed = await changedResponse.json() as { updatedAt?: string }
      updatedAt = changed.updatedAt ?? updatedAt
      expect(originalVersion).toBeTruthy()
      expect(updatedAt).not.toBe(originalVersion)
      const staleResponse = await apiRequest(request, 'PATCH', `${dictionaryPath}/${entryId}`, {
        token,
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': originalVersion! },
        data: { label: 'Stale write must be rejected' },
      })
      expect(staleResponse.status(), await staleResponse.text()).toBe(409)
      expect(await staleResponse.json()).toMatchObject({ code: 'optimistic_lock_conflict' })
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

  test('rejects hidden selections and inapplicable same-type edits while preserving record values', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const key = `qa_hidden_${Date.now()}`
    let personId: string | null = null
    let entryId: string | null = null
    let interactionId: string | null = null
    let updatedAt: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'Hidden', lastName: key, displayName: key })
      const catalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(catalogResponse.status()).toBe(200)
      const catalog = await catalogResponse.json() as Catalog
      const note = catalog.items.find((type) => type.key === 'note')!
      expect(note).toBeTruthy()
      const dictionary = await apiRequest(request, 'POST', '/api/customers/dictionaries/activity-types', {
        token, data: { value: key, label: key, behavior: { ...note.behavior, selectable: true } },
      })
      expect(dictionary.status(), await dictionary.text()).toBe(201)
      const entry = await dictionary.json() as { id: string; updatedAt: string }
      entryId = entry.id
      updatedAt = entry.updatedAt
      const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: key, title: 'Existing note-like type', allDay: false },
      })
      expect(created.status(), await created.text()).toBe(201)
      interactionId = (await created.json() as { id: string }).id
      const inapplicable = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: interactionId, durationMinutes: 45 },
      })
      expect(inapplicable.status(), await inapplicable.text()).toBe(400)
      expect(await inapplicable.json()).toMatchObject({ code: 'activity_type_field_not_applicable', fields: ['durationMinutes'] })
      const hidden = await apiRequest(request, 'PATCH', `/api/customers/dictionaries/activity-types/${entryId}`, {
        token, headers: { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt! },
        data: { behavior: { ...note.behavior, selectable: false } },
      })
      expect(hidden.status(), await hidden.text()).toBe(200)
      updatedAt = (await hidden.json() as { updatedAt: string }).updatedAt
      const unavailable = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: key, title: 'Hidden type is not selectable' },
      })
      expect(unavailable.status(), await unavailable.text()).toBe(400)
      expect(await unavailable.json()).toMatchObject({ code: 'activity_type_unavailable' })
      const unchanged = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: interactionId, title: 'Existing hidden type is still editable' },
      })
      expect(unchanged.status(), await unchanged.text()).toBe(200)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      if (entryId) await apiRequest(request, 'DELETE', `/api/customers/dictionaries/activity-types/${entryId}`, {
        token, headers: updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt } : undefined,
      })
    }
  })

  test('returns 403 for an authenticated user without interaction or settings permissions', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)
    const stamp = Date.now()
    const email = `calendar-catalog-${stamp}@example.com`
    const password = 'QaCatalog123!'
    let roleId: string | null = null
    let userId: string | null = null
    try {
      roleId = await createRoleFixture(request, token, { name: `calendar-no-permissions-${stamp}`, tenantId })
      await setRoleAclFeatures(request, token, { roleId, features: [], organizations: [organizationId] })
      userId = await createUserFixture(request, token, { email, password, organizationId, roles: [roleId] })
      const restrictedToken = await getAuthToken(request, email, password)
      const forbidden = await apiRequest(request, 'GET', '/api/customers/activity-types', { token: restrictedToken })
      expect(forbidden.status(), await forbidden.text()).toBe(403)
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })

  for (const activityType of ['call', 'task'] as const) {
    test(`creates and edits ${activityType} duration from the company schedule dialog`, async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin')
      const title = `QA schedule ${activityType} ${Date.now()}`
      let companyId: string | null = null
      let interactionId: string | null = null
      try {
        companyId = await createCompanyFixture(request, token, `Company for ${title}`)
        await login(page, 'admin')
        await page.goto(`/backend/customers/companies-v2/${companyId}`)
        await page.getByRole('tab', { name: /Activity log/i }).click()
        await page.getByRole('button', { name: /^Add new$/ }).click()
        await page.getByRole('button', { name: /New task/i }).first().click()
        const dialog = page.getByRole('dialog')
        if (activityType === 'call') await dialog.getByRole('button', { name: 'Call', exact: true }).click()
        await dialog.getByPlaceholder(/Activity title/i).fill(title)
        const createdPromise = page.waitForResponse((response) => response.url().includes('/api/customers/interactions') && response.request().method() === 'POST')
        await dialog.getByRole('button', { name: activityType === 'call' ? /^Log call$/ : /^Save task$/ }).click()
        const created = await createdPromise
        expect(created.status(), await created.text()).toBe(201)
        interactionId = (await created.json() as { id: string }).id
        const payload = created.request().postDataJSON() as { durationMinutes: number; scheduledAt: string }
        expect(payload.durationMinutes).toBeGreaterThan(0)
        await expect(dialog).toBeHidden()
        const dayNumber = await page.evaluate((scheduledAt) => String(new Date(scheduledAt).getDate()).padStart(2, '0'), payload.scheduledAt)
        await page.getByRole('button', { name: new RegExp(` ${dayNumber}$`) }).click()
        await page.getByText(title, { exact: true }).first().click()
        const editDialog = page.getByRole('dialog', { name: 'Edit activity', exact: true })
        await expect(editDialog).toBeVisible()
        await editDialog.getByPlaceholder(/Activity title/i).fill(`${title} edited`)
        const changedPromise = page.waitForResponse((response) => response.url().includes('/api/customers/interactions') && response.request().method() === 'PUT')
        await editDialog.getByRole('button', { name: /^Update activity$/ }).click()
        const changed = await changedPromise
        expect(changed.status(), await changed.text()).toBe(200)
        expect((changed.request().postDataJSON() as { durationMinutes: number }).durationMinutes).toBe(payload.durationMinutes)
        await expect(editDialog).toBeHidden()
      } finally {
        await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    })
  }

  test('round trips the selected event timezone and rejects an invalid zone', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    let interactionId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'Timezone', lastName: String(Date.now()), displayName: `Timezone roundtrip ${Date.now()}` })
      const invalid = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: 'meeting', timezone: 'Invalid/Zone', scheduledAt: '2026-09-29T07:15:00Z' },
      })
      expect(invalid.status(), await invalid.text()).toBe(400)
      const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: 'meeting', title: 'Chosen timezone', timezone: 'Europe/Warsaw', scheduledAt: '2026-09-29T07:15:00Z', durationMinutes: 165 },
      })
      expect(created.status(), await created.text()).toBe(201)
      interactionId = (await created.json() as { id: string }).id
      const list = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}`, { token })
      expect(list.status()).toBe(200)
      const saved = (await list.json() as { items: Array<{ id: string; timezone: string; scheduledAt: string; updatedAt: string }> }).items.find((item) => item.id === interactionId)!
      expect(saved).toMatchObject({ timezone: 'Europe/Warsaw', scheduledAt: '2026-09-29T07:15:00.000Z' })
      const updated = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, headers: { 'x-om-ext-optimistic-lock-expected-updated-at': saved.updatedAt },
        data: { id: interactionId, timezone: 'UTC', scheduledAt: '2026-09-29T09:15:00Z' },
      })
      expect(updated.status(), await updated.text()).toBe(200)
      const refreshed = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}`, { token })
      expect(refreshed.status()).toBe(200)
      expect((await refreshed.json() as { items: Array<{ id: string; timezone: string; scheduledAt: string }> }).items.find((item) => item.id === interactionId)).toMatchObject({ timezone: 'UTC', scheduledAt: '2026-09-29T09:15:00.000Z' })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
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
