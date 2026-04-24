import { metadata as messageListPageMetadata } from '../backend/page.meta'
import { metadata as messageListApiMetadata } from '../api/route'
import { metadata as messageUnreadCountMetadata } from '../api/unread-count/route'
import { metadata as messageDetailPageMetadata } from '../backend/messages/[id]/page.meta'
import { metadata as messageDetailApiMetadata } from '../api/[id]/route'
import { metadata as messageAttachmentsMetadata } from '../api/[id]/attachments/route'
import { metadata as messageConfirmationMetadata } from '../api/[id]/confirmation/route'

describe('message detail access metadata', () => {
  it('keeps recipient read surfaces auth-only', () => {
    expect(messageListPageMetadata.requireAuth).toBe(true)
    expect(messageListPageMetadata.requireFeatures).toBeUndefined()

    expect(messageListApiMetadata.GET.requireAuth).toBe(true)
    expect(messageListApiMetadata.GET.requireFeatures).toBeUndefined()

    expect(messageUnreadCountMetadata.GET.requireAuth).toBe(true)
    expect(messageUnreadCountMetadata.GET.requireFeatures).toBeUndefined()

    expect(messageDetailPageMetadata.requireAuth).toBe(true)
    expect(messageDetailPageMetadata.requireFeatures).toBeUndefined()

    expect(messageDetailApiMetadata.GET.requireAuth).toBe(true)
    expect(messageDetailApiMetadata.GET.requireFeatures).toBeUndefined()

    expect(messageAttachmentsMetadata.GET.requireAuth).toBe(true)
    expect(messageAttachmentsMetadata.GET.requireFeatures).toBeUndefined()

    expect(messageConfirmationMetadata.GET.requireAuth).toBe(true)
    expect(messageConfirmationMetadata.GET.requireFeatures).toBeUndefined()
  })
})
