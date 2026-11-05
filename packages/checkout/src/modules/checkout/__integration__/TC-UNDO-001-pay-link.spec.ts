import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  undoOk,
  redoOk,
  expectTokenConsumed,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  deleteLink,
  updateLink,
} from './helpers/fixtures'

/**
 * TC-UNDO-001 (§3 checkout.pay-link) — Undo/Redo correctness for the checkout pay-link
 * command bus, driven through the real `/api/checkout/links` routes plus the
 * `/api/audit_logs/audit-logs/actions/undo|redo` endpoints.
 *
 * Invariants asserted: I1 (update→undo restores), I2 (delete→undo re-materializes),
 * I3 (create→undo soft-deletes), I4 (custom fields restore), I5 (token consumed),
 * I6 (redo reproduces post-state). checkout.link.create ships an id-preserving redo
 * handler, so the create→undo→redo SAME-id leg is asserted as corrected behaviour.
 *
 * Also covers the #2540 fix: a draft pay-link may persist a null gatewayProviderKey,
 * and editing it to null then undoing must restore the prior gateway.
 */

const LINKS = '/api/checkout/links'

type LinkRecord = {
  id?: string
  name?: string
  slug?: string
  updatedAt?: string
  gatewayProviderKey?: string | null
  customFields?: Record<string, unknown>
}

// The undo endpoint resolves the *latest* undoable log for a resource ordered by
// millisecond-precision created_at, so consecutive mutations issued within the same
// millisecond can tie. A short settle keeps each round-trip deterministic.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

async function getLink(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<{ status: number; body: LinkRecord | null }> {
  const res = await apiRequest(request, 'GET', `${LINKS}/${encodeURIComponent(id)}`, { token })
  return { status: res.status(), body: await readJsonSafe<LinkRecord>(res) }
}

test.describe('TC-UNDO-001 checkout.pay-link undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('create → undo soft-deletes (I3) + token consumed (I5)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let linkId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', LINKS, {
        token,
        data: createFixedTemplateInput({ status: 'draft' }),
      })
      expect(createRes.status(), `create status ${createRes.status()}`).toBe(201)
      const createOp = expectOperation(createRes, 'checkout.link.create')
      linkId = createOp.resourceId
      expect(linkId, 'create returns a resource id').toBeTruthy()

      expect((await getLink(request, token, linkId as string)).status, 'pay-link exists after create').toBe(200)

      await undoOk(request, token, createOp.undoToken, 'undo create pay-link')
      expect(
        (await getLink(request, token, linkId as string)).status,
        'pay-link is gone after undoing create (I3 — soft-deleted, not readable)',
      ).not.toBe(200)

      await expectTokenConsumed(request, token, createOp.undoToken, 'checkout.link.create double-undo (I5)')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('update → undo restores scalars (I1) → redo re-applies (I6)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let linkId: string | null = null
    try {
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      linkId = link.id
      const before = await getLink(request, token, linkId)
      const beforeName = before.body?.name
      expect(beforeName, 'pay-link name readable before update').toBeTruthy()

      await settle()
      const changedName = `Renamed by undo test ${Date.now()}`
      const updateRes = await updateLink(request, token, linkId, { name: changedName })
      expect(updateRes.status(), `update status ${updateRes.status()}`).toBe(200)
      const updateOp = expectOperation(updateRes, 'checkout.link.update')
      expect((await getLink(request, token, linkId)).body?.name, 'update changed the name').toBe(changedName)

      await settle()
      await undoOk(request, token, updateOp.undoToken, 'undo update pay-link')
      const afterUndo = await getLink(request, token, linkId)
      expect(afterUndo.body?.name, 'update→undo restores the prior name (I1)').toBe(beforeName)
      expect(typeof afterUndo.body?.updatedAt, 'pay-link surfaces updatedAt').toBe('string')
      expect(afterUndo.body?.updatedAt, 'undo bumps updatedAt (I1)').not.toBe(before.body?.updatedAt)

      await redoOk(request, token, updateOp.logId, 'redo update pay-link')
      expect((await getLink(request, token, linkId)).body?.name, 'redo re-applies the renamed value (I6)').toBe(changedName)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('delete → undo re-materializes (I2) → redo re-deletes (I6)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let linkId: string | null = null
    try {
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      linkId = link.id
      const beforeName = (await getLink(request, token, linkId)).body?.name

      await settle()
      const deleteRes = await deleteLink(request, token, linkId)
      expect(deleteRes.ok(), `delete status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'checkout.link.delete')
      expect((await getLink(request, token, linkId)).status, 'gone after delete').not.toBe(200)

      await undoOk(request, token, deleteOp.undoToken, 'undo delete pay-link')
      const afterUndo = await getLink(request, token, linkId)
      expect(afterUndo.status, 'delete→undo re-materializes the row (I2)').toBe(200)
      expect(afterUndo.body?.name, 're-materialized record keeps its scalars (I2)').toBe(beforeName)

      await redoOk(request, token, deleteOp.logId, 'redo delete pay-link')
      expect((await getLink(request, token, linkId)).status, 'gone again after redo delete (I6)').not.toBe(200)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('create → undo → redo restores the SAME record (I6)', async ({ request }) => {
    // checkout.link.create registers an id-preserving redo handler, so redo must restore
    // the original soft-deleted row — not mint a new id (the #2468 customers.people defect).
    const token = await getAuthToken(request, 'admin')
    let linkId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', LINKS, {
        token,
        data: createFixedTemplateInput({ status: 'draft' }),
      })
      const createOp = expectOperation(createRes, 'checkout.link.create')
      linkId = createOp.resourceId

      await settle()
      const undoLogId = await undoOk(request, token, createOp.undoToken, 'undo create pay-link')
      expect((await getLink(request, token, linkId as string)).status, 'gone after undo create').not.toBe(200)

      await redoOk(request, token, undoLogId, 'redo create pay-link')
      const afterRedo = await getLink(request, token, linkId as string)
      expect(afterRedo.status, 'same pay-link restored after redo (I6)').toBe(200)
      expect(afterRedo.body?.id, 'redo preserves the original id (I6)').toBe(linkId)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('custom fields revert on undo and re-apply on redo (I4)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let linkId: string | null = null
    try {
      const beforeValue = `before ${Date.now()}`
      const link = await createLinkFixture(
        request,
        token,
        createFixedTemplateInput({
          status: 'draft',
          customFieldsetCode: 'service_package',
          customFields: { delivery_timeline: beforeValue },
        }),
      )
      linkId = link.id
      expect(
        (await getLink(request, token, linkId)).body?.customFields?.delivery_timeline,
        'custom field persisted on create',
      ).toBe(beforeValue)

      await settle()
      const afterValue = `after ${Date.now()}`
      const updateRes = await updateLink(request, token, linkId, { customFields: { delivery_timeline: afterValue } })
      const updateOp = expectOperation(updateRes, 'checkout.link.update')
      expect(
        (await getLink(request, token, linkId)).body?.customFields?.delivery_timeline,
        'update changed the custom field',
      ).toBe(afterValue)

      await settle()
      await undoOk(request, token, updateOp.undoToken, 'undo update custom field')
      expect(
        (await getLink(request, token, linkId)).body?.customFields?.delivery_timeline,
        'custom field reverts on undo (I4)',
      ).toBe(beforeValue)

      await redoOk(request, token, updateOp.logId, 'redo update custom field')
      expect(
        (await getLink(request, token, linkId)).body?.customFields?.delivery_timeline,
        'custom field re-applies on redo (I4)',
      ).toBe(afterValue)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('null gatewayProviderKey edit → undo restores the prior gateway (#2540, I1)', async ({ request }) => {
    // #2540: a draft pay-link may persist a null gatewayProviderKey. Editing the gateway to
    // null must round-trip, and undoing the edit must restore the prior gateway value.
    const token = await getAuthToken(request, 'admin')
    let linkId: string | null = null
    try {
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      linkId = link.id
      const before = await getLink(request, token, linkId)
      expect(before.body?.gatewayProviderKey, 'pay-link starts with the mock gateway').toBe('mock')

      await settle()
      const updateRes = await updateLink(request, token, linkId, {
        name: 'Pay link (no gateway)',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        status: 'draft',
        gatewayProviderKey: null,
      })
      expect(
        updateRes.ok(),
        `clearing the gateway on a draft pay-link should succeed: ${updateRes.status()}`,
      ).toBeTruthy()
      const updateOp = expectOperation(updateRes, 'checkout.link.update (null gateway)')

      const afterUpdate = await getLink(request, token, linkId)
      expect(afterUpdate.body?.gatewayProviderKey ?? null, 'gateway cleared to null after edit').toBeNull()
      expect(afterUpdate.body?.name, 'name changed by edit').toBe('Pay link (no gateway)')

      await settle()
      await undoOk(request, token, updateOp.undoToken, 'undo null-gateway edit')
      const afterUndo = await getLink(request, token, linkId)
      expect(afterUndo.body?.gatewayProviderKey, 'undo restores the prior gateway (#2540, I1)').toBe('mock')
      expect(afterUndo.body?.name, 'undo restores the prior name (I1)').toBe(before.body?.name)

      await redoOk(request, token, updateOp.logId, 'redo null-gateway edit')
      expect(
        (await getLink(request, token, linkId)).body?.gatewayProviderKey ?? null,
        'redo re-clears the gateway to null (I6)',
      ).toBeNull()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
