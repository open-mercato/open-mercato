import handler from '../ai-auto-reply'

describe('channel_discord ai-auto-reply subscriber', () => {
  it('no-ops for a non-discord provider without touching the container', async () => {
    const resolve = jest.fn(() => {
      throw new Error('resolver should not be called')
    })
    await expect(
      handler(
        { providerKey: 'gmail', messageId: 'm', channelId: 'c', tenantId: 't', direction: 'inbound' },
        { resolve },
      ),
    ).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('no-ops for an outbound message', async () => {
    const resolve = jest.fn(() => {
      throw new Error('resolver should not be called')
    })
    await expect(
      handler(
        { providerKey: 'discord', messageId: 'm', channelId: 'c', tenantId: 't', direction: 'outbound' },
        { resolve },
      ),
    ).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('no-ops when required payload fields are missing', async () => {
    const resolve = jest.fn(() => {
      throw new Error('resolver should not be called')
    })
    await expect(
      handler({ providerKey: 'discord', direction: 'inbound' }, { resolve }),
    ).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })
})
