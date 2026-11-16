import type { EntityManager } from '@mikro-orm/postgresql'
import { assertAttachmentOwnerAccess } from '../access-query'
import { createAttachmentAccessContext } from '../access-runner'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => key }),
}))

const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager
const auth = { sub: 'user', tenantId: 'tenant', orgId: 'org' }
const attachment = { id: 'attachment', partitionCode: 'missing', tenantId: 'tenant', organizationId: 'org', entityId: 'example:todo', recordId: 'record', fileName: 'file', mimeType: 'text/plain' }
const context = createAttachmentAccessContext({ resolve: jest.fn() } as never)
const previousPolicy = process.env.OM_ATTACHMENT_STORAGE_POLICY

afterEach(() => {
  if (previousPolicy === undefined) delete process.env.OM_ATTACHMENT_STORAGE_POLICY
  else process.env.OM_ATTACHMENT_STORAGE_POLICY = previousPolicy
})

it.each(['read', 'render', 'metadata', 'reassign', 'delete', 'export'] as const)('keeps missing-partition %s errors within the caller boundary', async (action) => {
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'strict'
  const result = assertAttachmentOwnerAccess({ em, context, auth, attachment, action })
  await expect(result).rejects.toMatchObject(action === 'delete'
    ? { status: 503, reason: 'partition_missing' }
    : { status: 404, body: { error: 'attachments.access.notFound' } })
})

it('preserves the legacy deletion not-found response', async () => {
  delete process.env.OM_ATTACHMENT_STORAGE_POLICY
  await expect(assertAttachmentOwnerAccess({ em, context, auth, attachment, action: 'delete' }))
    .rejects.toMatchObject({ status: 404, body: { error: 'attachments.access.notFound' } })
})
