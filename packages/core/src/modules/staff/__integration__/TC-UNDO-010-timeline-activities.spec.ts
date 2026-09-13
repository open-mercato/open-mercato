import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createStaffTeamMemberFixture, deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'
import {
  expectOperation,
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-010 staff timeline activities (#3624).
 *
 * `makeActivityCommandSet` is the third timeline factory and the only one with no existing
 * undo integration coverage anywhere in the repo, so unlike comments and addresses its
 * cross-layer contract is otherwise unproven. It is also the only family whose persisted undo
 * payload is a NESTED envelope (`{ activity, custom? }`) rather than a flat record, and the
 * only one whose row lookups are tenant/organization-scoped throughout (#3977).
 *
 * Custom-field VALUE restore is deliberately left at unit level: it needs a custom-field
 * definition fixture the repo does not provide, and the per-module restore policy is already
 * pinned by `timeline-activity-parity.test.ts`.
 */
test.describe('TC-UNDO-010 staff timeline activities', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  /**
   * The baseline the other two families already have: create→undo (I3/I5),
   * update→undo→redo (I1/I6) and delete→undo (I2) driven over real HTTP against the
   * factory-generated handlers.
   */
  test('activity commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null
    try {
      memberId = await createStaffTeamMemberFixture(request, token, { displayName: `Undo Activity ${stamp}` })

      await runCrudUndoRoundTrip(request, token, {
        label: 'staff.team-member-activities',
        collectionPath: '/api/staff/activities',
        readPath: () => `/api/staff/activities?entityId=${encodeURIComponent(memberId as string)}`,
        // The activity list normalizes rows to camelCase (`transformItem` in makeActivityRoute).
        field: 'subject',
        createPayload: (s) => ({ entityId: memberId, activityType: 'note', subject: `Undo activity ${s}` }),
        updatePayload: (id, s) => ({ id, subject: `Undo activity changed ${s}` }),
      })
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId)
    }
  })

  /**
   * Nested-envelope restore. The round-trip above only proves one field comes back. Because
   * activities persist their snapshot one level down (`payload.undo.before.activity`), a
   * factory that read the envelope at the wrong level would still restore *something* — an
   * empty or partial row — and pass a single-field check. This asserts the whole scalar set
   * plus the parent link, which is what a mis-read envelope would actually lose.
   */
  test('delete → undo restores the whole nested activity snapshot', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null
    let activityId: string | null = null
    try {
      memberId = await createStaffTeamMemberFixture(request, token, { displayName: `Undo Envelope ${stamp}` })

      const created = await apiRequest(request, 'POST', '/api/staff/activities', {
        token,
        data: {
          entityId: memberId,
          activityType: 'call',
          subject: `Undo envelope ${stamp}`,
          body: `Undo envelope body ${stamp}`,
          appearanceColor: '#112233',
        },
      })
      expect(created.status(), `activity create status ${created.status()}`).toBe(201)
      activityId = ((await created.json()) as { id: string }).id

      const deleted = await apiRequest(request, 'DELETE', `/api/staff/activities?id=${activityId}`, { token })
      expect(deleted.ok(), `activity delete status ${deleted.status()}`).toBeTruthy()
      await undoOk(
        request,
        token,
        expectOperation(deleted, 'staff.team-member-activities.delete').undoToken,
        'activity delete undo',
      )

      const list = await apiRequest(request, 'GET', `/api/staff/activities?entityId=${memberId}`, { token })
      const rows = ((await list.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
      const restored = rows.find((row) => row.id === activityId)

      expect(restored, 'activity re-materialized by undo').toBeTruthy()
      expect(restored?.subject, 'subject restored from the nested envelope').toBe(`Undo envelope ${stamp}`)
      expect(restored?.body, 'body restored from the nested envelope').toBe(`Undo envelope body ${stamp}`)
      expect(restored?.activityType, 'activityType restored').toBe('call')
      expect(restored?.appearanceColor, 'appearance restored').toBe('#112233')
      expect(restored?.entityId, 'team member relinked').toBe(memberId)
    } finally {
      if (activityId) await apiRequest(request, 'DELETE', `/api/staff/activities?id=${activityId}`, { token }).catch(() => {})
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId)
    }
  })
})
