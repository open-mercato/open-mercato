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
