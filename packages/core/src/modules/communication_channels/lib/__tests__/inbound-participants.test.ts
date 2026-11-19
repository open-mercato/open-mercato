import { buildInboundExtraParticipants } from '../inbound-participants'

describe('buildInboundExtraParticipants', () => {
  it('keeps extra To/CC and drops the sender and the channel mailbox', () => {
    const participants = buildInboundExtraParticipants(
      {
        to: [
          { address: 'Mailbox@Company.com', name: 'Our mailbox' },
          { address: 'colleague@example.com', name: 'Colleague' },
        ],
        cc: [
          { address: 'sender@example.com', name: 'Sender' },
          { address: 'boss@example.com', name: '' },
        ],
      },
      ['sender@example.com', 'mailbox@company.com', null],
    )
    expect(participants).toEqual([
      { email: 'colleague@example.com', role: 'to', name: 'Colleague' },
      { email: 'boss@example.com', role: 'cc' },
    ])
  })

  it('flattens address groups, skips invalid entries and duplicates', () => {
    const participants = buildInboundExtraParticipants(
      {
        to: [
          { name: 'Team', group: [{ address: 'one@example.com', name: 'One' }, { address: 'two@example.com', name: '' }] },
          { address: 'one@example.com', name: 'One again' },
          { address: 'undisclosed-recipients:;', name: '' },
          42,
        ],
        cc: 'not-a-list',
      },
      [],
    )
    expect(participants).toEqual([
      { email: 'one@example.com', role: 'to', name: 'One' },
      { email: 'two@example.com', role: 'to' },
    ])
  })

  it('returns nothing for a payload without addresses', () => {
    expect(buildInboundExtraParticipants(undefined, [])).toEqual([])
    expect(buildInboundExtraParticipants({ text: 'hello' }, [])).toEqual([])
  })
})
