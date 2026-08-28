import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  expectOperation,
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-010 sales timeline notes (#3624).
 *
 * Notes are the one consumer of `makeCommentCommandSet` outside the comments family, so this
 * file is what proves the shared contract is genuinely shape-driven and not customers-shaped.
 * Sales notes have no undo integration coverage today.
 *
 * Two properties are unique to notes and cannot be reached by unit characterization: a
 * polymorphic parent (`contextType` + `contextId` across four document kinds, resolved against
 * a real row) and a denormalized `order_id` FK kept alongside the context reference.
 */
test.describe('TC-UNDO-010 sales timeline notes', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  /**
   * The baseline contract for the shared comment factory, exercised through a module that is
   * not customers: create→undo (I3/I5), update→undo→redo (I1/I6), delete→undo (I2).
   */
  test('note commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token)

      await runCrudUndoRoundTrip(request, token, {
        label: 'sales.notes',
        collectionPath: '/api/sales/notes',
        readPath: () => `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId as string)}`,
        // The note list serializes snake_case columns; create/update payloads accept camelCase.
        field: 'body',
        createPayload: (s) => ({ contextType: 'order', contextId: orderId, body: `Undo note ${s}` }),
        updatePayload: (id, s) => ({ id, body: `Undo note changed ${s}` }),
      })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  /**
   * Polymorphic context + denormalized relation. The factory's `resolveParentForRestore` hook
   * re-resolves the parent document before re-materializing the note, and notes are the only
   * consumer that can return null from it (parent gone → abort the restore rather than throw).
   * A restore that dropped either the context reference or the `order_id` mirror would leave an
   * orphan note that reads back under no document at all — which is exactly what this asserts
   * by reading the row back through the context-filtered list rather than by id.
   */
  test('delete → undo restores the order context and the denormalized orderId', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null
    let noteId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token)

      const created = await apiRequest(request, 'POST', '/api/sales/notes', {
        token,
        data: { contextType: 'order', contextId: orderId, body: `Undo context note ${stamp}` },
      })
      expect(created.status(), `note create status ${created.status()}`).toBe(201)
      noteId = ((await created.json()) as { id: string }).id

      const deleted = await apiRequest(request, 'DELETE', `/api/sales/notes?id=${noteId}`, { token })
      expect(deleted.ok(), `note delete status ${deleted.status()}`).toBeTruthy()
      await undoOk(request, token, expectOperation(deleted, 'sales.notes.delete').undoToken, 'note delete undo')

      const list = await apiRequest(request, 'GET', `/api/sales/notes?contextType=order&contextId=${orderId}`, { token })
      const rows = ((await list.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
      const restored = rows.find((row) => row.id === noteId)

      expect(restored, 'note re-materialized by undo and still filed under the order').toBeTruthy()
      expect(restored?.body, 'body restored').toBe(`Undo context note ${stamp}`)
      expect(restored?.context_type, 'polymorphic context kind restored').toBe('order')
      expect(restored?.context_id, 'context id restored').toBe(orderId)
      expect(restored?.order_id, 'denormalized orderId mirror reattached').toBe(orderId)
    } finally {
      if (noteId) await apiRequest(request, 'DELETE', `/api/sales/notes?id=${noteId}`, { token }).catch(() => {})
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
