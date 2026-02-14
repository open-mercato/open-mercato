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
})
