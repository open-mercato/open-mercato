import type { Attachment as AttachmentEntity } from '@open-mercato/core/modules/attachments/data/entities'
import { serializePortalAttachment, type PortalAttachmentsApi } from '../portalAttachments'
import { CUSTOMER_VISIBLE_ATTACHMENT_TAG, customerUploadTag } from '../attachments'

const CUSTOMER_USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_CUSTOMER_USER_ID = '22222222-2222-4222-8222-222222222222'
const TASK_ID = '33333333-3333-4333-8333-333333333333'

function attachmentWithTags(tags: string[]): AttachmentEntity {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    fileName: 'invoice.pdf',
    fileSize: 2048,
    mimeType: 'application/pdf',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    storageMetadata: { tags },
  } as unknown as AttachmentEntity
}

const api = {
  readAttachmentMetadata: (metadata: unknown) => metadata as { tags?: string[] },
} as unknown as PortalAttachmentsApi

describe('serializePortalAttachment canDelete', () => {
  const ownUpload = attachmentWithTags([CUSTOMER_VISIBLE_ATTACHMENT_TAG, customerUploadTag(CUSTOMER_USER_ID)])

  it('allows deleting an own upload when the caller can manage tickets', () => {
    expect(serializePortalAttachment(api, ownUpload, TASK_ID, CUSTOMER_USER_ID, true).canDelete).toBe(true)
  })

  it('refuses deleting an own upload when the caller lacks the manage feature', () => {
    expect(serializePortalAttachment(api, ownUpload, TASK_ID, CUSTOMER_USER_ID, false).canDelete).toBe(false)
  })

  it('defaults to no delete when the manage capability is not passed', () => {
    expect(serializePortalAttachment(api, ownUpload, TASK_ID, CUSTOMER_USER_ID).canDelete).toBe(false)
  })

  it('refuses deleting another customer upload even with the manage feature', () => {
    const serialized = serializePortalAttachment(api, ownUpload, TASK_ID, OTHER_CUSTOMER_USER_ID, true)
    expect(serialized.canDelete).toBe(false)
    expect(serialized.uploadedByCustomer).toBe(true)
  })
})
