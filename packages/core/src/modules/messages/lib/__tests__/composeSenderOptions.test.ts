import { toComposeSenderOptions } from '../composeSenderOptions'

const connectedMailbox = {
  id: '11111111-1111-1111-1111-111111111111',
  channelType: 'email',
  status: 'connected',
  displayName: 'Work inbox',
  externalIdentifier: 'agent@example.com',
  isPrimary: false,
}

describe('toComposeSenderOptions', () => {
  it('keeps only connected email channels', () => {
    const options = toComposeSenderOptions([
      connectedMailbox,
      { ...connectedMailbox, id: 'disconnected', status: 'disconnected' },
      { ...connectedMailbox, id: 'reauth', status: 'requires_reauth' },
      { ...connectedMailbox, id: 'chat', channelType: 'chat' },
      { ...connectedMailbox, id: 'chat-connected', channelType: 'discord', status: 'connected' },
      null,
      'not-an-object',
      { channelType: 'email', status: 'connected' },
    ])

    expect(options.map((option) => option.id)).toEqual([connectedMailbox.id])
  })

  it('offers the primary mailbox first as the default pick', () => {
    const options = toComposeSenderOptions([
      { ...connectedMailbox, id: 'secondary', displayName: 'Secondary' },
      { ...connectedMailbox, id: 'primary', displayName: 'Primary', isPrimary: true },
      { ...connectedMailbox, id: 'third', displayName: 'Third' },
    ])

    expect(options[0]).toMatchObject({ id: 'primary', isDefault: true })
    expect(options.filter((option) => option.isDefault)).toHaveLength(1)
    expect(options.map((option) => option.id)).toEqual(['primary', 'secondary', 'third'])
  })

  it('exposes the external identifier as the option description', () => {
    const [option] = toComposeSenderOptions([connectedMailbox])

    expect(option).toMatchObject({ label: 'Work inbox', description: 'agent@example.com' })
  })

  it('falls back to the identifier when the channel has no display name', () => {
    const [option] = toComposeSenderOptions([{ ...connectedMailbox, displayName: '   ' }])

    expect(option.label).toBe('agent@example.com')
  })

  it('returns an empty list for a non-array payload', () => {
    expect(toComposeSenderOptions(undefined)).toEqual([])
    expect(toComposeSenderOptions({ items: [] })).toEqual([])
  })
})
