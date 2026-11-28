import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents', 'catalog'] }

type DraftFromMediaResponse = {
  success?: boolean
  result?: { found?: boolean; context?: { userMedia?: Array<{ attachmentId: string }> } }
}

/**
 * TC-AI-ATTACHMENT-OWNER-003: `catalog.draft_description_from_media` applies
 * attachment owner policies to `userUploadedAttachmentIds`. A file of a document
 * the caller cannot open is dropped from the tool's user media; a user the
 * document is shared with keeps it. Copies of a library file and of that
 * Documents file in another organization and in another tenant are dropped for
 * both users, while the caller's own library file is kept.
 */
test('TC-AI-ATTACHMENT-OWNER-003: catalog media tool drops files of documents the caller cannot open', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view', 'catalog.products.view'],
    })
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, fixture.admin, {
        title: `${fixture.prefix} product`,
        sku: `${fixture.prefix}-sku`,
      })
      const visibleFile = await fixture.upload(fixture.visible, 'visible-catalog')
      const libraryFile = await fixture.upload(randomUUID(), 'library-catalog', { entityId: 'attachments:library' })
      const foreign = [
        await fixture.foreignCopy(visibleFile, 'organization', { recordId: fixture.visible }),
        await fixture.foreignCopy(visibleFile, 'tenant', { recordId: fixture.visible }),
        await fixture.foreignCopy(libraryFile, 'organization'),
        await fixture.foreignCopy(libraryFile, 'tenant'),
      ]
      const args = { productId, userUploadedAttachmentIds: [visibleFile, libraryFile, ...foreign.map((row) => row.id)] }
      const mediaIds = (body: DraftFromMediaResponse | null) => (
        (body?.result?.context?.userMedia ?? []).map((entry) => entry.attachmentId).sort()
      )

      const unshared = await ownerPolicyRequest<DraftFromMediaResponse>('POST', '/api/ai_assistant/tools/execute', await fixture.unshared.refreshToken(), {
        toolName: 'catalog.draft_description_from_media',
        args,
      })
      expect(unshared.status).toBe(200)
      expect(unshared.body?.result?.found).toBe(true)
      expect(mediaIds(unshared.body), 'only the own library file survives').toEqual([libraryFile])

      const recipient = await ownerPolicyRequest<DraftFromMediaResponse>('POST', '/api/ai_assistant/tools/execute', await fixture.recipient.refreshToken(), {
        toolName: 'catalog.draft_description_from_media',
        args,
      })
      expect(recipient.status).toBe(200)
      expect(mediaIds(recipient.body), 'foreign copies are dropped for the shared user too').toEqual([visibleFile, libraryFile].sort())
    } finally {
      await deleteCatalogProductIfExists(request, fixture.admin, productId)
    }
  })
})
