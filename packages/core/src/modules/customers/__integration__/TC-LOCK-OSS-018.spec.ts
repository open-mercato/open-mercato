import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  putWithLock,
  expectConflictBody,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-018 (API contract) — manual cases CRM-10 / CRM-11 / CRM-12 / CRM-13.
 *
 * CRM activities/tasks are `customers.interaction` rows. Their write commands
 * (`packages/core/src/modules/customers/commands/interactions.ts`) call
 * `enforceCommandOptimisticLock` (version mismatch → 409) and
 * `enforceRecordGoneIsConflict` (deleted-out-of-band → 409 record-gone, NOT a
 * bare 404) on update / complete / cancel / delete. The browser surface for
 * these is the `ScheduleActivityDialog` edit modal, which submits through
 * `runGuardedMutation` + `buildOptimisticLockHeader(editData.updatedAt)` and so
 * raises the shared `data-testid="record-conflict-banner"` on a 409.
 *
 * COVERAGE CHOICE — API-level fallback (per the spec brief's allowance):
 * Driving the modal deterministically is impractical — it requires loading a
 * People/Deal detail, locating the freshly-created activity inside the rendered
 * timeline, opening its per-card "More" dropdown, and clicking an edit item,
 * all of which depend on async timeline rendering and menu virtualization. The
 * lock CONTRACT those modal writes exercise (`PUT /api/customers/interactions`
 * with a stale `x-om-ext-optimistic-lock-expected-updated-at` header, plus the
 * lifecycle `complete`/`cancel` POSTs) is identical to the API path and is
 * asserted here with `putWithLock` + `expectConflictBody`, exactly as the brief
 * permits for sub-cases whose UI is impractical to drive. The modal itself
 * sends the same header and renders the same banner from the same 409 body.
 *
 * Cases:
 *   - CRM-10 stale interaction edit            → 409 (version mismatch)
 *   - CRM-11 delete-then-stale-update          → 409 record-gone (NOT a 404)
 *   - CRM-12 stale complete (done) transition  → 409 (version mismatch)
 *   - CRM-13 stale cancel transition           → 409 (version mismatch)
 */

const INTERACTIONS_API_BASE = '/api/customers/interactions'
const COMPANIES_API_BASE = '/api/customers/companies'

type JsonRecord = Record<string, unknown>

/** Read the current ISO `updated_at` of a single interaction via the entity-scoped list. */
async function readInteractionUpdatedAt(
  request: APIRequestContext,
  token: string,
  entityId: string,
  interactionId: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    `${INTERACTIONS_API_BASE}?entityId=${encodeURIComponent(entityId)}&limit=100`,
    { token },
  )
  expect(response.ok(), `GET interactions for entity ${entityId} should be 200`).toBeTruthy()
  const body = await readJsonSafe<JsonRecord>(response)
  const items = Array.isArray(body?.items) ? (body!.items as JsonRecord[]) : []
  const row = items.find((item) => item.id === interactionId)
  expect(row, `interaction ${interactionId} should be present in the list`).toBeTruthy()
  const raw = (row!.updatedAt ?? row!.updated_at) as string | undefined
  expect(typeof raw, `interaction should expose updatedAt, got ${String(raw)}`).toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updatedAt should parse, got ${String(raw)}`).toBe(true)
  return new Date(ms).toISOString()
}

/** Create an activity/task interaction on the company entity; returns its id. */
async function createInteractionFixture(
  request: APIRequestContext,
  token: string,
  entityId: string,
  data: JsonRecord,
): Promise<string> {
  const response = await apiRequest(request, 'POST', INTERACTIONS_API_BASE, {
    token,
    data: { entityId, ...data },
  })
  expect(response.status(), 'interaction create should be 201').toBe(201)
  const created = await readJsonSafe<JsonRecord>(response)
  const id = typeof created?.id === 'string' ? created.id : null
  expect(id, 'create response should include the interaction id').toBeTruthy()
  return id as string
}

/** POST a lifecycle transition (complete/cancel) with a stale optimistic-lock header. */
async function postWithLock(
  request: APIRequestContext,
  token: string,
  path: string,
  body: JsonRecord,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue,
    },
    data: body,
  })
}

test.describe('TC-LOCK-OSS-018: CRM interaction (activity/task) optimistic-lock conflict contract', () => {
  test('CRM-10 stale interaction edit returns the unified 409 conflict body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    let interactionId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `QA Lock 018 ${stamp}`)
      interactionId = await createInteractionFixture(request, token, companyId, {
        interactionType: 'meeting',
        title: `QA Lock 018 edit ${stamp}`,
        scheduledAt: new Date(stamp + 86_400_000).toISOString(),
      })

      // The "modal" captured this updated_at when it opened.
      const staleToken = await readInteractionUpdatedAt(request, token, companyId, interactionId)

      // Out-of-band edit advances updated_at → the captured token is now stale.
      const bump = await apiRequest(request, 'PUT', INTERACTIONS_API_BASE, {
        token,
        data: { id: interactionId, title: `QA Lock 018 bumped ${stamp}` },
      })
      expect(bump.ok(), 'out-of-band edit should succeed (additive path)').toBeTruthy()

      // Stale modal save → 409 with the optimistic-lock conflict code.
      const conflict = await putWithLock(
        request,
        token,
        INTERACTIONS_API_BASE,
        { id: interactionId, title: `QA Lock 018 stale ${stamp}` },
        staleToken,
      )
      await expectConflictBody(conflict)
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `${INTERACTIONS_API_BASE}?id=${interactionId}`, { token }).catch(() => {})
      }
      await deleteEntityIfExists(request, token, COMPANIES_API_BASE, companyId)
    }
  })

  test('CRM-11 stale save after an out-of-band delete returns 409 record-gone (not a bare 404)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    let interactionId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `QA Lock 018 del ${stamp}`)
      interactionId = await createInteractionFixture(request, token, companyId, {
        interactionType: 'task',
        title: `QA Lock 018 gone ${stamp}`,
        scheduledAt: new Date(stamp + 86_400_000).toISOString(),
      })

      // The modal captured this updated_at when it opened.
      const staleToken = await readInteractionUpdatedAt(request, token, companyId, interactionId)

      // Another tab deletes the interaction.
      const del = await apiRequest(request, 'DELETE', `${INTERACTIONS_API_BASE}?id=${interactionId}`, { token })
      expect(del.ok(), 'out-of-band delete should succeed').toBeTruthy()

      // Saving the now-stale modal must surface the unified conflict (record-gone),
      // NOT a generic "not found" — the client keys off `code`, not the timestamps.
      const conflict = await putWithLock(
        request,
        token,
        INTERACTIONS_API_BASE,
        { id: interactionId, title: `QA Lock 018 gone stale ${stamp}` },
        staleToken,
      )
      await expectConflictBody(conflict)
      interactionId = null
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `${INTERACTIONS_API_BASE}?id=${interactionId}`, { token }).catch(() => {})
      }
      await deleteEntityIfExists(request, token, COMPANIES_API_BASE, companyId)
    }
  })

  test('CRM-12 stale complete (mark done) returns the unified 409 conflict body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    let interactionId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `QA Lock 018 done ${stamp}`)
      interactionId = await createInteractionFixture(request, token, companyId, {
        interactionType: 'task',
        title: `QA Lock 018 done ${stamp}`,
        scheduledAt: new Date(stamp + 86_400_000).toISOString(),
      })

      const staleToken = await readInteractionUpdatedAt(request, token, companyId, interactionId)

      // Out-of-band edit advances updated_at → the captured token is now stale.
      const bump = await apiRequest(request, 'PUT', INTERACTIONS_API_BASE, {
        token,
        data: { id: interactionId, title: `QA Lock 018 done bumped ${stamp}` },
      })
      expect(bump.ok(), 'out-of-band edit should succeed').toBeTruthy()

      // Stale "mark done" transition → 409.
      const conflict = await postWithLock(
        request,
        token,
        `${INTERACTIONS_API_BASE}/complete`,
        { id: interactionId },
        staleToken,
      )
      await expectConflictBody(conflict)
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `${INTERACTIONS_API_BASE}?id=${interactionId}`, { token }).catch(() => {})
      }
      await deleteEntityIfExists(request, token, COMPANIES_API_BASE, companyId)
    }
  })

  test('CRM-13 stale cancel returns the unified 409 conflict body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    let interactionId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `QA Lock 018 cancel ${stamp}`)
      interactionId = await createInteractionFixture(request, token, companyId, {
        interactionType: 'meeting',
        title: `QA Lock 018 cancel ${stamp}`,
        scheduledAt: new Date(stamp + 86_400_000).toISOString(),
      })

      const staleToken = await readInteractionUpdatedAt(request, token, companyId, interactionId)

      // Out-of-band edit advances updated_at → the captured token is now stale.
      const bump = await apiRequest(request, 'PUT', INTERACTIONS_API_BASE, {
        token,
        data: { id: interactionId, title: `QA Lock 018 cancel bumped ${stamp}` },
      })
      expect(bump.ok(), 'out-of-band edit should succeed').toBeTruthy()

      // Stale cancel transition → 409.
      const conflict = await postWithLock(
        request,
        token,
        `${INTERACTIONS_API_BASE}/cancel`,
        { id: interactionId },
        staleToken,
      )
      await expectConflictBody(conflict)
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `${INTERACTIONS_API_BASE}?id=${interactionId}`, { token }).catch(() => {})
      }
      await deleteEntityIfExists(request, token, COMPANIES_API_BASE, companyId)
    }
  })
})
