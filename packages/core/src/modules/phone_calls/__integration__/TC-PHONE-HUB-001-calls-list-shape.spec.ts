import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deletePhoneCallsIfExist, seedPhoneCalls } from './helpers/phoneCallsFixtures'

type CallRow = Record<string, unknown>
type ListBody = { items?: CallRow[] }

/**
 * TC-PHONE-HUB-001 — an ingested call is listed with the projection the module declares.
 *
 * Covers the module's own contract: the route is mounted, `phone_calls.view` admits
 * the caller, and `listFields` projects the columns the backend list renders. The
 * paging machinery itself belongs to `makeCrudRoute` and is covered centrally by
 * packages/shared/src/lib/crud/__tests__/crud-factory.test.ts — it is not re-tested here.
 */
test.describe('TC-PHONE-HUB-001: phone calls list projection', () => {
  test('lists an ingested call with the declared columns', async ({ request }) => {
    const token = await getAuthToken(request)
    const scope = getTokenScope(token)
    const externalCallId = `qa-phone-hub-001-${Date.now()}`
    let seeded: string[] = []

    try {
      seeded = await seedPhoneCalls([
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          externalCallId,
          direction: 'inbound',
          status: 'completed',
          startedAt: new Date('2026-03-01T10:00:00Z'),
          durationSeconds: 65,
        },
      ])

      const response = await apiRequest(
        request,
        'GET',
        `/api/phone_calls/calls?q=${encodeURIComponent(externalCallId)}`,
        { token },
      )
      expect(response.status(), 'admin should be able to list phone calls').toBe(200)

      const body = await readJsonSafe<ListBody>(response)
      const row = body?.items?.find((item) => item.external_call_id === externalCallId)
      expect(row, 'the seeded call should be listed').toBeTruthy()

      expect(row!.provider_key, 'provider_key should round-trip').toBe('tillio')
      expect(row!.direction, 'direction should round-trip').toBe('inbound')
      expect(row!.status, 'status should round-trip').toBe('completed')
      expect(row!.duration_seconds, 'duration_seconds should round-trip').toBe(65)
      expect(row!.ingest_status, 'ingest_status should round-trip').toBe('ingested')
      expect(row!.started_at, 'started_at should be projected').toBeTruthy()
      expect(row!.id, 'id should be projected').toBeTruthy()
    } finally {
      await deletePhoneCallsIfExist(seeded)
    }
  })
})
