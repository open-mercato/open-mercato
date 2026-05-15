import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type MaterialListItem = {
  id: string
  code: string
  lifecycle_state: string
  replacement_material_id: string | null
}

type ListResponse<T> = { items?: T[] }

type LifecycleResponse = {
  ok?: boolean
  materialId?: string
  eventId?: string
  fromState?: string
  toState?: string
  error?: string
  details?: unknown
}

async function createMaterial(
  request: APIRequestContext,
  token: string,
  code: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/materials', {
    token,
    data: { code, name, kind: 'raw' },
  })
  expect(response.status()).toBe(201)
  return expectId(((await readJsonSafe<{ id?: string }>(response)) ?? {}).id, 'Material id')
}

async function getMaterial(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<MaterialListItem | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/materials?ids=${encodeURIComponent(id)}&page=1&pageSize=10`,
    { token },
  )
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<ListResponse<MaterialListItem>>(response)
  return body?.items?.find((row) => row.id === id) ?? null
}

async function transitionLifecycle(
  request: APIRequestContext,
  token: string,
  materialId: string,
  body: Record<string, unknown>,
) {
  return apiRequest(
    request,
    'POST',
    `/api/materials/${encodeURIComponent(materialId)}/lifecycle`,
    { token, data: body },
  )
}

async function deleteMaterialIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/materials', { token, data: { id } }).catch(() => undefined)
}

test.describe('TC-MAT-006: Material Lifecycle Transitions', () => {
  test('walks the legal state machine and rejects illegal transitions', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let materialId: string | null = null
    let replacementId: string | null = null

    try {
      materialId = await createMaterial(request, token, `MAT006-SM-${stamp}`, `Lifecycle ${stamp}`)
      replacementId = await createMaterial(
        request,
        token,
        `MAT006-REP-${stamp}`,
        `Replacement ${stamp}`,
      )

      const sameState = await transitionLifecycle(request, token, materialId, { toState: 'draft' })
      expect(sameState.status(), 'Same-state transition must be 409').toBe(409)

      const draftToObsolete = await transitionLifecycle(request, token, materialId, {
        toState: 'obsolete',
      })
      expect(draftToObsolete.status(), 'draft→obsolete is invalid; must be 409').toBe(409)
      const draftToObsoleteBody = await readJsonSafe<LifecycleResponse>(draftToObsolete)
      expect(draftToObsoleteBody?.error).toBeTruthy()
      expect(draftToObsoleteBody?.details, 'Should include allowed transitions hint').toBeTruthy()

      const draftToActive = await transitionLifecycle(request, token, materialId, {
        toState: 'active',
        reason: 'Initial release',
      })
      expect(draftToActive.status()).toBe(200)
      const draftToActiveBody = await readJsonSafe<LifecycleResponse>(draftToActive)
      expect(draftToActiveBody?.fromState).toBe('draft')
      expect(draftToActiveBody?.toState).toBe('active')
      expect(typeof draftToActiveBody?.eventId === 'string').toBe(true)

      const activeAfterPromote = await getMaterial(request, token, materialId)
      expect(activeAfterPromote?.lifecycle_state).toBe('active')

      const activeToPhaseOut = await transitionLifecycle(request, token, materialId, {
        toState: 'phase_out',
      })
      expect(activeToPhaseOut.status()).toBe(200)

      const phaseOutToActive = await transitionLifecycle(request, token, materialId, {
        toState: 'active',
        reason: 'Re-activated',
      })
      expect(phaseOutToActive.status(), 'phase_out→active is the only legal reverse').toBe(200)

      const backToPhaseOut = await transitionLifecycle(request, token, materialId, {
        toState: 'phase_out',
      })
      expect(backToPhaseOut.status()).toBe(200)

      const obsoleteWithSelfRef = await transitionLifecycle(request, token, materialId, {
        toState: 'obsolete',
        replacementMaterialId: materialId,
      })
      expect(obsoleteWithSelfRef.status(), 'Self-replacement must be 422').toBe(422)

      const obsoleteWithFakeReplacement = await transitionLifecycle(request, token, materialId, {
        toState: 'obsolete',
        replacementMaterialId: '00000000-0000-4000-8000-000000000111',
      })
      expect(
        obsoleteWithFakeReplacement.status(),
        'Replacement material in another scope must 422',
      ).toBe(422)

      const obsoleteOk = await transitionLifecycle(request, token, materialId, {
        toState: 'obsolete',
        replacementMaterialId: replacementId,
        reason: 'Replaced by newer model',
      })
      expect(obsoleteOk.status()).toBe(200)
      const obsoleteOkBody = await readJsonSafe<LifecycleResponse>(obsoleteOk)
      expect(obsoleteOkBody?.toState).toBe('obsolete')

      const finalState = await getMaterial(request, token, materialId)
      expect(finalState?.lifecycle_state).toBe('obsolete')
      expect(finalState?.replacement_material_id).toBe(replacementId)
    } finally {
      await deleteMaterialIfExists(request, token, materialId)
      await deleteMaterialIfExists(request, token, replacementId)
    }
  })
})
