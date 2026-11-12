import { features } from '../acl'
import { smtpCapabilities } from '../capabilities'
import { integration } from '../integration'
import { metadata } from '../index'
import { getSmtpChannelAdapter } from '../lib/adapter'

describe('channel_smtp contracts', () => {
  it('declares supported module metadata and coordinated versions', () => {
    expect(metadata).toEqual(expect.objectContaining({
      id: 'channel_smtp',
      version: '0.1.0',
      requires: ['communication_channels', 'integrations'],
    }))
    expect(integration).toEqual(expect.objectContaining({
      providerKey: 'smtp',
      version: '0.1.0',
      healthCheck: { service: 'channelSmtpHealthCheck' },
    }))
    expect(metadata).not.toHaveProperty('dependencies')
  })

  it('exports catalog-compatible ACL features and honest capabilities', () => {
    expect(features).toEqual([
      { id: 'channel_smtp.view', title: expect.any(String), module: 'channel_smtp' },
      { id: 'channel_smtp.configure', title: expect.any(String), module: 'channel_smtp' },
    ])
    expect(smtpCapabilities.fileSharing).toBe(false)
    expect(smtpCapabilities.conversationHistory).toBe(false)
  })

  it('connects tenant-wide, because system email only resolves channels with userId null', () => {
    expect(getSmtpChannelAdapter().channelScope).toBe('tenant')
  })

  it('declares every credential field the schema requires', () => {
    const declared = integration.credentials?.fields.map((field) => field.key) ?? []
    expect(declared).toEqual(['host', 'port', 'tls', 'user', 'password', 'fromAddress'])
  })
})
