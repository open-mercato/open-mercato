import { getMessageListParticipantLabel, getMessageParticipantLabel } from '../messageListLabels'

const t = (_key: string, fallback: string) => fallback

describe('messageListLabels', () => {
  it('shows a no-recipient placeholder for sent and draft rows without recipients', () => {
    const item = {
      senderUserId: 'user-1',
      senderName: 'Current User',
      senderEmail: 'current@example.com',
      recipientCount: 0,
    }

    expect(getMessageListParticipantLabel(item, 'drafts', t)).toBe('(No recipient)')
    expect(getMessageListParticipantLabel(item, 'sent', t)).toBe('(No recipient)')
  })

  it('keeps sender labels for recipient-owned folders', () => {
    expect(getMessageListParticipantLabel({
      senderUserId: 'user-1',
      senderName: 'Sender',
      recipientCount: 0,
    }, 'inbox', t)).toBe('Sender')
  })

  it('falls back to the external identity for ingested inbound messages', () => {
    // Inbound channel messages are authored by the module's system user, so
    // senderName/senderEmail are empty and only the external identity is
    // human-readable. Without this fallback the list rendered a bare uuid.
    const systemUserId = '00000000-0000-0000-0000-000000000000'

    expect(getMessageListParticipantLabel({
      senderUserId: systemUserId,
      senderName: null,
      senderEmail: null,
      externalName: 'Jane Doe',
      externalEmail: 'jane@example.com',
    }, 'inbox', t)).toBe('Jane Doe')

    expect(getMessageListParticipantLabel({
      senderUserId: systemUserId,
      externalEmail: 'jane@example.com',
    }, 'inbox', t)).toBe('jane@example.com')

    expect(getMessageListParticipantLabel({
      senderUserId: systemUserId,
      externalName: '   ',
      externalEmail: '  jane@example.com  ',
    }, 'inbox', t)).toBe('jane@example.com')
  })

  it('prefers the platform sender over the external identity', () => {
    expect(getMessageListParticipantLabel({
      senderUserId: 'user-1',
      senderName: 'Platform User',
      externalName: 'External Contact',
    }, 'inbox', t)).toBe('Platform User')
  })

  it('still returns the sender id when no identity is available', () => {
    expect(getMessageListParticipantLabel({
      senderUserId: 'user-1',
    }, 'inbox', t)).toBe('user-1')
  })
})

describe('inbound external attribution', () => {
  const INBOUND = 'communication_channels.external_conversation'

  it('attributes an assigned conversation to the external sender, not the assigned agent', () => {
    // `ingest-inbound-message` composes with `mapping.assignedUserId` as the
    // sender once an operator assigns the thread, so the agent resolves to a
    // real name in the user directory. Preferring it would print the agent as
    // the author of the customer's own email — a wrong answer that reads as a
    // fact, unlike the uuid this fix originally replaced.
    expect(getMessageParticipantLabel({
      senderUserId: 'agent-1',
      senderName: 'Anna Nowak',
      senderEmail: 'anna@support.example.com',
      externalName: 'Jan Kowalski',
      externalEmail: 'jan@example.com',
      sourceEntityType: INBOUND,
    })).toBe('Jan Kowalski')

    expect(getMessageListParticipantLabel({
      senderUserId: 'agent-1',
      senderName: 'Anna Nowak',
      externalEmail: 'jan@example.com',
      sourceEntityType: INBOUND,
    }, 'inbox', t)).toBe('jan@example.com')
  })

  it('falls back to the platform sender when an inbound message carries no external identity', () => {
    expect(getMessageParticipantLabel({
      senderUserId: 'bot-1',
      senderName: 'Channel Bot',
      externalName: '  ',
      externalEmail: null,
      sourceEntityType: INBOUND,
    })).toBe('Channel Bot')
  })

  it('keeps platform-sender precedence for outbound messages that carry an external counterparty', () => {
    // `lib/send-as-user.ts` composes outbound mail with the same
    // `channel.<provider>` type but `sourceEntityType` of
    // `communication_channels.send_as_user`, and puts the SUBJECT in
    // `externalName`. Discriminating on the type would label these with the
    // subject line instead of their real author.
    expect(getMessageParticipantLabel({
      senderUserId: 'agent-1',
      senderName: 'Anna Nowak',
      externalName: 'Re: order 1234',
      externalEmail: 'jan@example.com',
      sourceEntityType: 'communication_channels.send_as_user',
    })).toBe('Anna Nowak')
  })

  it('still returns the sender id for an inbound message with no identity at all', () => {
    const systemUserId = '00000000-0000-0000-0000-000000000000'

    expect(getMessageParticipantLabel({
      senderUserId: systemUserId,
      sourceEntityType: INBOUND,
    })).toBe(systemUserId)
  })
})

describe('getMessageParticipantLabel', () => {
  it('resolves identities in order without folder-specific rules', () => {
    expect(getMessageParticipantLabel({
      senderUserId: 'user-1',
      senderEmail: 'sender@example.com',
      externalEmail: 'external@example.com',
    })).toBe('sender@example.com')

    expect(getMessageParticipantLabel({
      senderUserId: 'user-1',
      externalName: 'External Contact',
    })).toBe('External Contact')
  })
})
