import { expect, test } from '@playwright/test'
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
 * document is shared with keeps it.
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
      const args = { productId, userUploadedAttachmentIds: [visibleFile] }

      const unshared = await ownerPolicyRequest<DraftFromMediaResponse>('POST', '/api/ai_assistant/tools/execute', await fixture.unshared.refreshToken(), {
        toolName: 'catalog.draft_description_from_media',
        args,
      })
      expect(unshared.status).toBe(200)
      expect(unshared.body?.result?.found).toBe(true)
      expect(unshared.body?.result?.context?.userMedia ?? []).toEqual([])

      const recipient = await ownerPolicyRequest<DraftFromMediaResponse>('POST', '/api/ai_assistant/tools/execute', await fixture.recipient.refreshToken(), {
        toolName: 'catalog.draft_description_from_media',
        args,
      })
      expect(recipient.status).toBe(200)
      expect(recipient.body?.result?.context?.userMedia?.map((entry) => entry.attachmentId)).toEqual([visibleFile])
    } finally {
      await deleteCatalogProductIfExists(request, fixture.admin, productId)
    }
  })
})
