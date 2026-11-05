import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readLink,
  submitPayLink,
  updateLink,
} from './helpers/fixtures'

/**
 * TC-CHKT-046: Pay-link usage counters stay equal to the link's transactions.
 *
 * The example mock gateway captures every session immediately, so each accepted
 * submit reserves a usage slot and completes it inside one request. Parallel submits
 * are therefore parallel terminal transitions on the same link row.
 *
 * Invariants: completionCount = completed payments, activeReservationCount = payments
 * in flight (0 here), isLocked = activeReservationCount > 0, never more completions
 * than maxCompletions — including after undoing an edit made before the payments.
 */

const PAYMENT = { customerData: {}, acceptedLegalConsents: {}, amount: 49.99 }

async function payInParallel(request: APIRequestContext, slug: string, count: number) {
  return Promise.all(Array.from({ length: count }, () => submitPayLink(request, slug, PAYMENT)))
}

test.describe('TC-CHKT-046: Pay-link usage counters under concurrent payments and undo', () => {
  test('parallel payments on one link are all counted and release their reservations', async ({ request }) => {
    const token = await getAuthToken(request)
    let linkId: string | null = null
    try {
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active', collectCustomerDetails: false }))
      linkId = link.id

      const responses = await payInParallel(request, link.slug, 4)
      expect(responses.map((response) => response.status())).toEqual([201, 201, 201, 201])

      const stored = await readLink(request, token, link.id)
      expect(stored.completionCount).toBe(4)
      expect(stored.activeReservationCount).toBe(0)
      expect(stored.isLocked).toBe(false)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('a duplicated Idempotency-Key submit does not leave a reservation behind', async ({ request }) => {
    const token = await getAuthToken(request)
    let linkId: string | null = null
    try {
      const link = await createLinkFixture(request, token, createFixedTemplateInput({
        status: 'active',
        collectCustomerDetails: false,
        maxCompletions: 2,
      }))
      linkId = link.id
      const idempotencyKey = `tc-chkt-046-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      const responses = await Promise.all([
        submitPayLink(request, link.slug, PAYMENT, { idempotencyKey }),
        submitPayLink(request, link.slug, PAYMENT, { idempotencyKey }),
      ])
      const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ transactionId?: string }>))
      expect(bodies[0].transactionId).toBeTruthy()
      expect(bodies[1].transactionId).toBe(bodies[0].transactionId)

      const stored = await readLink(request, token, link.id)
      expect(stored.completionCount).toBe(1)
      expect(stored.activeReservationCount).toBe(0)
      expect(stored.isLocked).toBe(false)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('a limited link sells exactly its limit under parallel payments', async ({ request }) => {
    const token = await getAuthToken(request)
    let linkId: string | null = null
    try {
      const link = await createLinkFixture(request, token, createFixedTemplateInput({
        status: 'active',
        collectCustomerDetails: false,
        maxCompletions: 2,
      }))
      linkId = link.id

      const responses = await payInParallel(request, link.slug, 6)
      const accepted = responses.filter((response) => response.status() === 201)
      expect(accepted).toHaveLength(2)

      const stored = await readLink(request, token, link.id)
      expect(stored.completionCount).toBe(2)
      expect(stored.activeReservationCount).toBe(0)
      expect(stored.isLocked).toBe(false)

      const afterLimit = await submitPayLink(request, link.slug, PAYMENT)
      expect(afterLimit.status()).toBe(422)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('undoing an edit made before a sale does not reopen a sold-out link', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request)
    let linkId: string | null = null
    try {
      const input = createFixedTemplateInput({ status: 'active', collectCustomerDetails: false, maxCompletions: 1 })
      const link = await createLinkFixture(request, token, input)
      linkId = link.id

      const updateResponse = await updateLink(request, token, link.id, { ...input, slug: link.slug, title: `${input.title} (edited)` })
      expect(updateResponse.status()).toBe(200)
      const updateOperation = expectOperation(updateResponse, 'checkout.link.update')

      const sale = await submitPayLink(request, link.slug, PAYMENT)
      expect(sale.status()).toBe(201)

      await undoOk(request, token, updateOperation.undoToken, 'undo pay-link edit after a sale')

      const stored = await readLink(request, token, link.id)
      expect(stored.title).toBe(input.title)
      expect(stored.completionCount).toBe(1)
      expect(stored.activeReservationCount).toBe(0)

      const afterUndo = await submitPayLink(request, link.slug, PAYMENT)
      expect(afterUndo.status()).toBe(422)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
