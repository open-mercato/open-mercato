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
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  deleteTemplate,
  updateTemplate,
} from './helpers/fixtures'

/**
 * TC-UNDO-001 (§3 checkout.template) — Undo/Redo correctness for the checkout template
 * command bus, driven through the real `/api/checkout/templates` routes plus the
 * `/api/audit_logs/audit-logs/actions/undo|redo` endpoints.
 *
 * Invariants asserted (per the #2468 tracking issue):
 *   I1 update→undo restores scalars (and bumps updatedAt)
 *   I2 delete→undo re-materializes the soft-deleted row
 *   I3 create→undo soft-deletes (never hard-deletes)
 *   I4 custom fields revert on undo and re-apply on redo
 *   I5 a consumed undo token is rejected on a second undo
 *   I6 redo reproduces the command's post-state
 *
 * Unlike the customers.people pilot (where create→undo→redo mints a new id, #2468),
 * checkout.template.create ships an id-preserving redo handler, so the SAME-id redo
 * leg is asserted as corrected behaviour rather than quarantined.
 */

const TEMPLATES = '/api/checkout/templates'

type TemplateRecord = {
  id?: string
  name?: string
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

async function getTemplate(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<{ status: number; body: TemplateRecord | null }> {
  const res = await apiRequest(request, 'GET', `${TEMPLATES}/${encodeURIComponent(id)}`, { token })
  return { status: res.status(), body: await readJsonSafe<TemplateRecord>(res) }
}

test.describe('TC-UNDO-001 checkout.template undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('create → undo soft-deletes (I3) + token consumed (I5)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let templateId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', TEMPLATES, {
        token,
        data: createFixedTemplateInput({ status: 'draft' }),
      })
      expect(createRes.status(), `create status ${createRes.status()}`).toBe(201)
      const createOp = expectOperation(createRes, 'checkout.template.create')
      templateId = createOp.resourceId
      expect(templateId, 'create returns a resource id').toBeTruthy()

      expect((await getTemplate(request, token, templateId as string)).status, 'template exists after create').toBe(200)

      await undoOk(request, token, createOp.undoToken, 'undo create template')
      expect(
        (await getTemplate(request, token, templateId as string)).status,
        'template is gone after undoing create (I3 — soft-deleted, not readable)',
      ).not.toBe(200)

      await expectTokenConsumed(request, token, createOp.undoToken, 'checkout.template.create double-undo (I5)')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })

  test('update → undo restores scalars (I1) → redo re-applies (I6)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let templateId: string | null = null
    try {
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      const before = await getTemplate(request, token, templateId)
      const beforeName = before.body?.name
      expect(beforeName, 'template name readable before update').toBeTruthy()

      await settle()
      const changedName = `Renamed by undo test ${Date.now()}`
      const updateRes = await updateTemplate(request, token, templateId, { name: changedName })
      expect(updateRes.status(), `update status ${updateRes.status()}`).toBe(200)
      const updateOp = expectOperation(updateRes, 'checkout.template.update')
      expect((await getTemplate(request, token, templateId)).body?.name, 'update changed the name').toBe(changedName)

      await settle()
      await undoOk(request, token, updateOp.undoToken, 'undo update template')
      const afterUndo = await getTemplate(request, token, templateId)
      expect(afterUndo.body?.name, 'update→undo restores the prior name (I1)').toBe(beforeName)
      expect(typeof afterUndo.body?.updatedAt, 'template surfaces updatedAt').toBe('string')
      expect(afterUndo.body?.updatedAt, 'undo bumps updatedAt (I1)').not.toBe(before.body?.updatedAt)

      await redoOk(request, token, updateOp.logId, 'redo update template')
      expect(
        (await getTemplate(request, token, templateId)).body?.name,
        'redo re-applies the renamed value (I6)',
      ).toBe(changedName)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })

  test('delete → undo re-materializes (I2) → redo re-deletes (I6)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let templateId: string | null = null
    try {
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      const beforeName = (await getTemplate(request, token, templateId)).body?.name

      await settle()
      const deleteRes = await deleteTemplate(request, token, templateId)
      expect(deleteRes.ok(), `delete status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'checkout.template.delete')
      expect((await getTemplate(request, token, templateId)).status, 'gone after delete').not.toBe(200)

      await undoOk(request, token, deleteOp.undoToken, 'undo delete template')
      const afterUndo = await getTemplate(request, token, templateId)
      expect(afterUndo.status, 'delete→undo re-materializes the row (I2)').toBe(200)
      expect(afterUndo.body?.name, 're-materialized record keeps its scalars (I2)').toBe(beforeName)

      await redoOk(request, token, deleteOp.logId, 'redo delete template')
      expect(
        (await getTemplate(request, token, templateId)).status,
        'gone again after redo delete (I6)',
      ).not.toBe(200)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })

  test('create → undo → redo restores the SAME record (I6)', async ({ request }) => {
    // checkout.template.create registers an id-preserving redo handler, so redo must restore
    // the original soft-deleted row — not mint a new id (the #2468 customers.people defect).
    const token = await getAuthToken(request, 'admin')
    let templateId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', TEMPLATES, {
        token,
        data: createFixedTemplateInput({ status: 'draft' }),
      })
      const createOp = expectOperation(createRes, 'checkout.template.create')
      templateId = createOp.resourceId

      await settle()
      const undoLogId = await undoOk(request, token, createOp.undoToken, 'undo create template')
      expect((await getTemplate(request, token, templateId as string)).status, 'gone after undo create').not.toBe(200)

      await redoOk(request, token, undoLogId, 'redo create template')
      const afterRedo = await getTemplate(request, token, templateId as string)
      expect(afterRedo.status, 'same template restored after redo (I6)').toBe(200)
      expect(afterRedo.body?.id, 'redo preserves the original id (I6)').toBe(templateId)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })

  test('custom fields revert on undo and re-apply on redo (I4)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let templateId: string | null = null
    try {
      const beforeValue = `before ${Date.now()}`
      templateId = await createTemplateFixture(
        request,
        token,
        createFixedTemplateInput({
          status: 'draft',
          customFieldsetCode: 'service_package',
          customFields: { delivery_timeline: beforeValue },
        }),
      )
      expect(
        (await getTemplate(request, token, templateId)).body?.customFields?.delivery_timeline,
        'custom field persisted on create',
      ).toBe(beforeValue)

      await settle()
      const afterValue = `after ${Date.now()}`
      const updateRes = await updateTemplate(request, token, templateId, {
        customFields: { delivery_timeline: afterValue },
      })
      const updateOp = expectOperation(updateRes, 'checkout.template.update')
      expect(
        (await getTemplate(request, token, templateId)).body?.customFields?.delivery_timeline,
        'update changed the custom field',
      ).toBe(afterValue)

      await settle()
      await undoOk(request, token, updateOp.undoToken, 'undo update custom field')
      expect(
        (await getTemplate(request, token, templateId)).body?.customFields?.delivery_timeline,
        'custom field reverts on undo (I4)',
      ).toBe(beforeValue)

      await redoOk(request, token, updateOp.logId, 'redo update custom field')
      expect(
        (await getTemplate(request, token, templateId)).body?.customFields?.delivery_timeline,
        'custom field re-applies on redo (I4)',
      ).toBe(afterValue)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
