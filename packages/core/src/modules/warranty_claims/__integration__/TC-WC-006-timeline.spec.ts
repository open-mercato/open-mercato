import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  authHeaders,
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  postClaimEvent,
  readClaimEvents,
  submitAndExpect,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-006: warranty claim timeline events', () => {
  test('persists staff comment visibility, appends status payloads, and exposes no mutable event routes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-006')
    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Timeline ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      claimId = claim.id

      const internalBody = `Internal timeline note ${stamp}`
      const internal = await postClaimEvent(request, token, {
        claimId: claimId!,
        body: internalBody,
        visibility: 'internal',
      })
      expect(internal.status(), 'staff internal comment should return 200').toBe(200)

      const customerBody = `Customer-visible timeline note ${stamp}`
      const customer = await postClaimEvent(request, token, {
        claimId: claimId!,
        body: customerBody,
        visibility: 'customer',
      })
      expect(customer.status(), 'staff customer-visible comment should return 200').toBe(200)

      const comments = await readClaimEvents(request, token, claimId!)
      expect(comments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'comment', visibility: 'internal', body: internalBody }),
          expect.objectContaining({ kind: 'comment', visibility: 'customer', body: customerBody }),
        ]),
      )

      await submitAndExpect(request, token, claim)
      const afterSubmit = await readClaimEvents(request, token, claimId!)
      expect(afterSubmit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'status_changed',
            visibility: 'customer',
            payload: expect.objectContaining({ from: 'draft', to: 'submitted' }),
          }),
        ]),
      )

      const putEvent = await request.fetch(`/api/warranty_claims/events?claimId=${encodeURIComponent(claimId!)}`, {
        method: 'PUT',
        headers: authHeaders(token),
        data: { body: 'should not update' },
      })
      expect([404, 405], 'timeline events should not expose PUT').toContain(putEvent.status())

      const deleteEvent = await request.fetch(`/api/warranty_claims/events?claimId=${encodeURIComponent(claimId!)}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
      expect([404, 405], 'timeline events should not expose DELETE').toContain(deleteEvent.status())
    } finally {
      await cancelThenDeleteClaimIfPossible(request, token, claimId)
    }
  })
})
