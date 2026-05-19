import { composeMessageSchema, forwardMessageSchema, updateDraftSchema } from '../validators'

describe('messages validators', () => {
  it('rejects duplicate recipient ids during compose', () => {
    const result = composeMessageSchema.safeParse({
      subject: 'Subject',
      body: 'Body',
      recipients: [
        { userId: '11111111-1111-1111-8111-111111111111', type: 'to' },
        { userId: '11111111-1111-1111-8111-111111111111', type: 'cc' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('requires recipients for internal visibility', () => {
    const result = composeMessageSchema.safeParse({
      subject: 'Subject',
      body: 'Body',
      visibility: 'internal',
      recipients: [],
    })

    expect(result.success).toBe(false)
  })

  it('requires external email and no recipients for public visibility', () => {
    const invalidPublicResult = composeMessageSchema.safeParse({
      subject: 'Subject',
      body: 'Body',
      visibility: 'public',
      recipients: [{ userId: '11111111-1111-1111-8111-111111111111', type: 'to' }],
    })

    expect(invalidPublicResult.success).toBe(false)
  })

  it('allows saving draft without recipients, subject, or body', () => {
    const result = composeMessageSchema.safeParse({
      isDraft: true,
      visibility: 'internal',
      recipients: [],
      subject: '',
      body: '',
    })

    expect(result.success).toBe(true)
  })

  it('requires at least one object for messages.defaultWithObjects', () => {
    const result = composeMessageSchema.safeParse({
      type: 'messages.defaultWithObjects',
      recipients: [{ userId: '11111111-1111-4111-8111-111111111111', type: 'to' }],
      subject: 'Subject',
      body: 'Body',
    })

    expect(result.success).toBe(false)
  })

  it('rejects action fields for messages.defaultWithObjects', () => {
    const result = composeMessageSchema.safeParse({
      type: 'messages.defaultWithObjects',
      recipients: [{ userId: '11111111-1111-4111-8111-111111111111', type: 'to' }],
      subject: 'Subject',
      body: 'Body',
      objects: [{
        entityModule: 'sales',
        entityType: 'order',
        entityId: '11111111-1111-4111-8111-111111111112',
        actionRequired: true,
        actionType: 'approve',
        actionLabel: 'Approve',
      }],
    })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate recipients when forwarding', () => {
    const result = forwardMessageSchema.safeParse({
      recipients: [
        { userId: '11111111-1111-1111-8111-111111111111' },
        { userId: '11111111-1111-1111-8111-111111111111' },
      ],
      sendViaEmail: false,
    })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate recipients when updating draft', () => {
    const result = updateDraftSchema.safeParse({
      recipients: [
        { userId: '11111111-1111-1111-8111-111111111111' },
        { userId: '11111111-1111-1111-8111-111111111111' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('allows updating a draft with an empty body or subject', () => {
    const emptyBodyResult = updateDraftSchema.safeParse({
      subject: 'Subject',
      body: '',
      recipients: [{ userId: '11111111-1111-1111-8111-111111111111', type: 'to' }],
    })
    expect(emptyBodyResult.success).toBe(true)

    const emptySubjectResult = updateDraftSchema.safeParse({
      subject: '',
      body: 'Body',
      recipients: [{ userId: '11111111-1111-1111-8111-111111111111', type: 'to' }],
    })
    expect(emptySubjectResult.success).toBe(true)

    const bothEmptyResult = updateDraftSchema.safeParse({
      subject: '',
      body: '',
    })
    expect(bothEmptyResult.success).toBe(true)
  })

  it('allows the draft send transition with isDraft=false', () => {
    const result = updateDraftSchema.safeParse({
      isDraft: false,
    })

    expect(result.success).toBe(true)
  })

  it('rejects isDraft=true when updating a draft', () => {
    const result = updateDraftSchema.safeParse({
      isDraft: true,
    })

    expect(result.success).toBe(false)
  })
})
