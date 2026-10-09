import { features } from '../acl'
import { brevoCapabilities } from '../capabilities'
import { integration } from '../integration'
import { metadata } from '../index'

describe('channel_brevo contracts', () => {
  it('declares supported module metadata and coordinated versions', () => {
    expect(metadata).toEqual(expect.objectContaining({
      id: 'channel_brevo',
      version: '0.1.0',
      requires: ['communication_channels', 'integrations'],
    }))
    expect(integration).toEqual(expect.objectContaining({
      version: '0.1.0',
      healthCheck: { service: 'channelBrevoHealthCheck' },
    }))
    expect(metadata).not.toHaveProperty('dependencies')
  })

  it('exports catalog-compatible ACL features and honest capabilities', () => {
    expect(features).toEqual([
      { id: 'channel_brevo.view', title: expect.any(String), module: 'channel_brevo' },
      { id: 'channel_brevo.configure', title: expect.any(String), module: 'channel_brevo' },
    ])
    expect(brevoCapabilities.fileSharing).toBe(false)
  })
})
