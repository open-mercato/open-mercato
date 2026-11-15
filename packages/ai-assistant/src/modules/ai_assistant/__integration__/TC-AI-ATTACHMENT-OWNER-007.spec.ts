import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  deletePendingActionInDb,
  readCatalogProductTitleInDb,
  readPendingActionStateInDb,
  seedPendingActionInDb,
} from './helpers/aiAssistantFixtures'

export const integrationMeta = { dependsOnModules: ['documents', 'catalog'] }

const AGENT_ID = 'catalog.merchandising_assistant'
const TOOL_NAME = 'catalog.update_product'

type ConfirmResponse = { ok?: boolean; code?: string; error?: string; pendingAction?: { status?: string } }

/**
 * TC-AI-ATTACHMENT-OWNER-007: confirming a pending action re-checks the
 * attachments it carries against the confirming user. Rows are seeded in the
 * database (a pending action is otherwise born only from a model turn) for the
 * shipped `catalog.merchandising_assistant` agent and its
 * `catalog.update_product` tool, with `attachment_ids` set. A file of a
 * document the user cannot open refuses the confirm with 403
 * `attachment_access_denied` and a localized message, a file of another
 * organization or tenant with `attachment_cross_tenant`; the action stays
 * pending and the product unchanged. A user the document is shared with
 * confirms, and is refused once the share is revoked.
 */
test('TC-AI-ATTACHMENT-OWNER-007: confirming a pending action re-checks attachment owner access', async ({ request }) => {
  test.slow()
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view', 'catalog.products.view', 'catalog.products.manage'],
    })
    const { tenantId, organizationId } = getTokenContext(fixture.admin)
    const document = await fixture.document('confirm')
    const userShare = await fixture.share(document, 'viewer')
    const file = await fixture.upload(document, 'confirm-ai')
    const foreignOrganizationFile = await fixture.foreignCopy(file, 'organization', { recordId: document })
    const foreignTenantFile = await fixture.foreignCopy(file, 'tenant', { recordId: document })
    const foreignBefore = [await readAttachmentRowInDb(foreignOrganizationFile.id), await readAttachmentRowInDb(foreignTenantFile.id)]
    const unsharedToken = await fixture.unshared.refreshToken()
    const recipientToken = await fixture.recipient.refreshToken()
    const actions: string[] = []
    let productId: string | null = null

    const seed = async (createdByUserId: string, attachmentIds: string[], title: string) => {
      const row = await seedPendingActionInDb({
        tenantId, organizationId, createdByUserId, agentId: AGENT_ID, toolName: TOOL_NAME,
        normalizedInput: { productId, title }, attachmentIds,
      })
      actions.push(row.id)
      return row.id
    }
    const confirm = (id: string, token: string, language: string) => ownerPolicyRequest<ConfirmResponse>(
      'POST', `/api/ai_assistant/ai/actions/${id}/confirm`, token, {}, 'Bearer', { 'Accept-Language': language },
    )

    try {
      productId = await createProductFixture(request, fixture.admin, {
        title: `${fixture.prefix} product`,
        sku: `${fixture.prefix}-sku`,
      })
      const originalTitle = await readCatalogProductTitleInDb(productId)

      const deniedId = await seed(fixture.unshared.id, [file], `Denied ${randomUUID()}`)
      const denied = await confirm(deniedId, unsharedToken, 'en')
      expect(denied.status).toBe(403)
      expect(denied.body).toEqual({
        code: 'attachment_access_denied',
        error: 'You do not have access to one or more of these attachments.',
      })
      const deniedPolish = await confirm(deniedId, unsharedToken, 'pl')
      expect(deniedPolish.status).toBe(403)
      expect(deniedPolish.body, 'the refusal is localized').toEqual({
        code: 'attachment_access_denied',
        error: 'Nie masz dostępu do co najmniej jednego z tych załączników.',
      })
      expect((await readPendingActionStateInDb(deniedId))?.status).toBe('pending')

      for (const foreignFile of [foreignOrganizationFile, foreignTenantFile]) {
        const crossId = await seed(fixture.recipient.id, [file, foreignFile.id], `Cross ${randomUUID()}`)
        const cross = await confirm(crossId, recipientToken, 'en')
        expect(cross.status).toBe(403)
        expect(cross.body?.code, 'a foreign attachment is refused by the scope check').toBe('attachment_cross_tenant')
        expect((await readPendingActionStateInDb(crossId))?.status).toBe('pending')
      }
      expect(await readCatalogProductTitleInDb(productId), 'refused confirms leave the product unchanged').toBe(originalTitle)
      expect([await readAttachmentRowInDb(foreignOrganizationFile.id), await readAttachmentRowInDb(foreignTenantFile.id)]).toEqual(foreignBefore)

      const allowedTitle = `Allowed ${randomUUID()}`
      const allowedId = await seed(fixture.recipient.id, [file], allowedTitle)
      const allowed = await confirm(allowedId, recipientToken, 'en')
      expect(allowed.status, 'the shared user confirms').toBe(200)
      expect(allowed.body?.ok).toBe(true)
      expect(allowed.body?.pendingAction?.status).toBe('confirmed')
      expect(await readCatalogProductTitleInDb(productId)).toBe(allowedTitle)

      const revokedId = await seed(fixture.recipient.id, [file], `Revoked ${randomUUID()}`)
      await fixture.unshare(document, userShare)
      const revoked = await confirm(revokedId, recipientToken, 'en')
      expect(revoked.status).toBe(403)
      expect(revoked.body?.code, 'the confirm is refused once the share is revoked').toBe('attachment_access_denied')
      expect((await readPendingActionStateInDb(revokedId))?.status).toBe('pending')
      expect(await readCatalogProductTitleInDb(productId)).toBe(allowedTitle)
    } finally {
      for (const id of actions) await deletePendingActionInDb(id).catch(() => undefined)
      await deleteCatalogProductIfExists(request, fixture.admin, productId)
    }
  })
})
