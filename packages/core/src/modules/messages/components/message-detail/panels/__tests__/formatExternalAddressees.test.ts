import { formatExternalAddressees } from '../MessageHeader'

function participant(role: 'to' | 'cc' | 'bcc', email: string) {
  return { id: email, role, email, name: null, deliveryStatus: null, deliveryError: null, sentAt: null }
}

describe('formatExternalAddressees', () => {
  it('lists to before cc, hides bcc and caps the list with +N', () => {
    expect(formatExternalAddressees({
      externalParticipants: [
        participant('cc', 'copy@example.com'),
        participant('bcc', 'hidden@example.com'),
        participant('to', 'a@example.com'),
      ],
    })).toBe('a@example.com, copy@example.com')
    expect(formatExternalAddressees({
      externalParticipants: ['a', 'b', 'c', 'd', 'e'].map((name) => participant('to', `${name}@example.com`)),
    })).toBe('a@example.com, b@example.com, c@example.com +2')
  })

  it('returns null when there are no visible external addressees', () => {
    expect(formatExternalAddressees({ externalParticipants: [participant('bcc', 'hidden@example.com')] })).toBeNull()
    expect(formatExternalAddressees({})).toBeNull()
  })
})
