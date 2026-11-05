import { Attachment, AttachmentPartition } from '../entities'

describe('attachments entities', () => {
  it('exposes a nullable content field on Attachment', () => {
    const att = new Attachment() as any
    expect('content' in att).toBe(true)
    expect(att.content).toBeNull()
  })

  it('exposes requiresOcr flag on AttachmentPartition with boolean default', () => {
    const partition = new AttachmentPartition() as any
    expect('requiresOcr' in partition).toBe(true)
    expect(typeof partition.requiresOcr).toBe('boolean')
  })
})
