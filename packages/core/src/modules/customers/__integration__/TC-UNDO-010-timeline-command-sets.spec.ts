import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createDealFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-010 customers timeline command sets (#3624).
 *
 * The comment and address command sets moved to shared factories
 * (`makeCommentCommandSet`, `makeAddressCommandSet`). The plain CRUD undo/redo contract for
 * both is already covered by TC-UNDO-001-comments and TC-UNDO-001-addresses, which run
 * unchanged against the refactored handlers — this file deliberately does not repeat them.
 *
 * What it adds are the three seams that neither those round-trips nor unit characterization
 * can reach: relation restore, the one sanctioned behavior change, and the primary-address
 * invariant. Each needs a real EntityManager and a real prior row, so each is integration-only.
 */
test.describe('TC-UNDO-010 customers timeline command sets', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  /**
   * Relation restore. TC-UNDO-001 proves the comment `body` survives a delete → undo; it says
   * nothing about the linked deal, which is restored by the factory's `resolveParentForRestore`
   * hook from the persisted snapshot. A hook reading the wrong snapshot, or a factory that
   * dropped the FK, would re-materialize the comment detached from its deal — visible only here.
   */
  test('comment delete → undo restores the linked deal', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let commentId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `TimelineDeal ${stamp}`,
        displayName: `Undo TimelineDeal ${stamp}`,
      })
      const dealId = await createDealFixture(request, token, {
        title: `Undo Timeline Deal ${stamp}`,
        personIds: [personId],
      })

      const created = await apiRequest(request, 'POST', '/api/customers/comments', {
        token,
        data: { entityId: personId, dealId, body: `Undo timeline comment ${stamp}` },
      })
      expect(created.status(), `comment create status ${created.status()}`).toBe(201)
      commentId = ((await created.json()) as { id: string }).id

      const deleted = await apiRequest(request, 'DELETE', `/api/customers/comments?id=${commentId}`, { token })
      expect(deleted.ok(), `comment delete status ${deleted.status()}`).toBeTruthy()
      await undoOk(request, token, expectOperation(deleted, 'customers.comments.delete').undoToken, 'comment delete undo')

      const list = await apiRequest(request, 'GET', `/api/customers/comments?entityId=${personId}`, { token })
      const rows = ((await list.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
      const restored = rows.find((row) => row.id === commentId)

      expect(restored, 'comment re-materialized by undo').toBeTruthy()
      expect(restored?.body, 'body restored').toBe(`Undo timeline comment ${stamp}`)
      expect(restored?.deal_id, 'deal link restored with the comment').toBe(dealId)
    } finally {
      if (commentId) await apiRequest(request, 'DELETE', `/api/customers/comments?id=${commentId}`, { token }).catch(() => {})
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  /**
   * One of the two sanctioned behavior changes in #3624: the customers address `delete.undo`
   * restored every column except `companyName` when the row still existed, while `update.undo`
   * restored it. The factory has a single restore path, so the asymmetry is gone.
   *
   * That omission sits in the row-already-exists branch, which a hard delete makes unreachable
   * from the normal undo path — `timeline-address-parity` drives it directly against a fake
   * EntityManager. What this case covers is the reachable half: that `companyName` genuinely
   * survives a real delete → undo through CommandBus and Postgres after the fold, which
   * TC-UNDO-001 does not check (it round-trips `address_line1` only).
   */
  test('address delete → undo restores companyName (sanctioned fold)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let addressId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `TimelineAddr ${stamp}`,
        displayName: `Undo TimelineAddr ${stamp}`,
      })

      const created = await apiRequest(request, 'POST', '/api/customers/addresses', {
        token,
        data: {
          entityId: personId,
          addressLine1: `Undo Street ${stamp}`,
          companyName: `Undo Company ${stamp}`,
          city: `Undo City ${stamp}`,
        },
      })
      expect(created.status(), `address create status ${created.status()}`).toBe(201)
      addressId = ((await created.json()) as { id: string }).id

      const deleted = await apiRequest(request, 'DELETE', `/api/customers/addresses?id=${addressId}`, { token })
      expect(deleted.ok(), `address delete status ${deleted.status()}`).toBeTruthy()
      await undoOk(request, token, expectOperation(deleted, 'customers.addresses.delete').undoToken, 'address delete undo')

      const list = await apiRequest(request, 'GET', `/api/customers/addresses?entityId=${personId}`, { token })
      const rows = ((await list.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
      const restored = rows.find((row) => row.id === addressId)

      expect(restored, 'address re-materialized by undo').toBeTruthy()
      expect(restored?.company_name, 'companyName restored by delete → undo').toBe(`Undo Company ${stamp}`)
      // Guard against a fix that restores companyName by dropping the columns that already worked.
      expect(restored?.address_line1, 'addressLine1 still restored').toBe(`Undo Street ${stamp}`)
      expect(restored?.city, 'city still restored').toBe(`Undo City ${stamp}`)
    } finally {
      if (addressId) await apiRequest(request, 'DELETE', `/api/customers/addresses?id=${addressId}`, { token }).catch(() => {})
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  /**
   * Primary-address invariant. The factory calls `enforcePrimary` after create, update and
   * every restore path; unit tests can only assert it was called with a fake EntityManager.
   * This proves the real SQL demotion happens and leaves exactly one primary — the state a
   * broken enforcement would corrupt without any error surfacing.
   */
  test('creating a primary address demotes the previous primary', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `TimelinePrimary ${stamp}`,
        displayName: `Undo TimelinePrimary ${stamp}`,
      })

      const first = await apiRequest(request, 'POST', '/api/customers/addresses', {
        token,
        data: { entityId: personId, addressLine1: `First ${stamp}`, isPrimary: true },
      })
      expect(first.status(), `first address create status ${first.status()}`).toBe(201)
      const firstId = ((await first.json()) as { id: string }).id

      const second = await apiRequest(request, 'POST', '/api/customers/addresses', {
        token,
        data: { entityId: personId, addressLine1: `Second ${stamp}`, isPrimary: true },
      })
      expect(second.status(), `second address create status ${second.status()}`).toBe(201)
      const secondId = ((await second.json()) as { id: string }).id

      const list = await apiRequest(request, 'GET', `/api/customers/addresses?entityId=${personId}`, { token })
      const rows = ((await list.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
      const primaryIds = rows.filter((row) => row.is_primary === true).map((row) => row.id)

      expect(primaryIds, 'exactly one primary address remains, and it is the newest').toEqual([secondId])
      expect(primaryIds, 'the earlier primary was demoted').not.toContain(firstId)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
