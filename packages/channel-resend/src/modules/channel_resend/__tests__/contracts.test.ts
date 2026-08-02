import { features } from '../acl'
import { resendCapabilities } from '../capabilities'
import { integration } from '../integration'
import { metadata } from '../index'

describe('channel_resend contracts', () => {
  it('declares supported module metadata and coordinated versions', () => {
    expect(metadata).toEqual(expect.objectContaining({
      id: 'channel_resend',
      version: '0.6.6',
      requires: ['communication_channels', 'integrations'],
    }))
    expect(integration).toEqual(expect.objectContaining({
      version: '0.6.6',
      healthCheck: { service: 'channelResendHealthCheck' },
    }))
    expect(metadata).not.toHaveProperty('dependencies')
  })

  it('exports catalog-compatible ACL features and honest capabilities', () => {
    expect(features).toEqual([
      { id: 'channel_resend.view', title: expect.any(String), module: 'channel_resend' },
      { id: 'channel_resend.configure', title: expect.any(String), module: 'channel_resend' },
    ])
    expect(resendCapabilities.fileSharing).toBe(false)
  })
})
