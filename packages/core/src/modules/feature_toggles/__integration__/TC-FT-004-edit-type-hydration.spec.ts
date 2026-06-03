import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/featureTogglesFixtures'

type FeatureToggleDetail = {
  id?: string
  identifier?: string
  name?: string
  description?: string | null
  category?: string | null
  type?: string
  defaultValue?: unknown
  updatedAt?: string
}

// Mirrors the mapping performed in
// packages/core/src/modules/feature_toggles/backend/feature-toggles/global/[id]/edit/page.tsx
// so the edit-form initial value contract (issue #2452: "Type *" must hydrate
// from the loaded record and survive a save) is covered at the data layer.
function buildEditInitialValues(record: FeatureToggleDetail, routeId: string) {
  return {
    id: record.id ?? routeId,
    identifier: record.identifier,
    name: record.name,
    description: record.description,
    category: record.category,
    type: record.type,
    defaultValue: record.defaultValue,
  }
}

test.describe('TC-FT-004: Feature toggle edit form hydrates and persists type', () => {
  test('GET returns the type and the edit initial value carries it through a partial save', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const identifier = `qa_edit_type_${Date.now()}`
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, token, {
        identifier,
        name: 'QA Edit Type Toggle',
        description: 'Edit form type hydration coverage',
        category: 'qa',
        type: 'number',
        defaultValue: 42,
      })

      // Opening the edit page loads the record via this detail endpoint.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}`,
        { token },
      )
      expect(detailResponse.status()).toBe(200)
      const detail = await readJsonSafe<FeatureToggleDetail>(detailResponse)

      // The detail payload must include both the id (so CrudForm detects edit
      // mode) and the required Type field.
      expect(detail?.id).toBe(toggleId)
      expect(detail?.type).toBe('number')

      // The edit form's initial value mapping must surface the loaded type.
      const initialValues = buildEditInitialValues(detail ?? {}, toggleId)
      expect(initialValues.id).toBe(toggleId)
      expect(initialValues.type).toBe('number')

      // Saving without re-touching type (a partial update) must not drop it —
      // reopening the record should still report the original type.
      const updateResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token,
        data: {
          id: toggleId,
          name: 'QA Edit Type Toggle (renamed)',
        },
      })
      expect(updateResponse.status()).toBe(200)

      const reopenResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}`,
        { token },
      )
      expect(reopenResponse.status()).toBe(200)
      const reopened = await readJsonSafe<FeatureToggleDetail>(reopenResponse)
      expect(reopened?.name).toBe('QA Edit Type Toggle (renamed)')
      expect(reopened?.type).toBe('number')
      expect(buildEditInitialValues(reopened ?? {}, toggleId).type).toBe('number')
    } finally {
      await deleteFeatureToggleIfExists(request, token, toggleId)
    }
  })

  // Browser regression for #2452: the API mapping passing is NOT enough — the bug
  // was a render race where the `type` SELECT mounted before the loaded value
  // arrived and never re-synced, so the Type field showed "—" in the UI even
  // though the record had a type. This drives the real edit page.
  test('the Type select hydrates the stored value on the edit page (UI)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'superadmin')
    const identifier = `qa_edit_type_ui_${Date.now()}`
    let toggleId: string | null = null
    try {
      toggleId = await createFeatureToggleFixture(page.request, token, {
        identifier,
        name: 'QA Edit Type UI',
        type: 'boolean',
        defaultValue: true,
      })

      await login(page, 'superadmin')
      await page.goto(`/backend/feature-toggles/global/${toggleId}/edit`)

      const typeField = page.locator('[data-crud-field-id="type"]').first()
      await expect(typeField).toBeVisible({ timeout: 15_000 })
      // The select must render the stored type, NOT the empty placeholder "—".
      await expect(typeField).toContainText(/boolean/i, { timeout: 15_000 })
      await expect(typeField).not.toContainText('—')
    } finally {
      await deleteFeatureToggleIfExists(page.request, token, toggleId)
    }
  })
})
