import { getMessageListParticipantLabel } from '../messageListLabels'

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
})
