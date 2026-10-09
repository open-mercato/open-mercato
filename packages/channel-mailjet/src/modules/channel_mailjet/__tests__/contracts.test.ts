import { features } from '../acl'
import { mailjetCapabilities } from '../capabilities'
import { integration } from '../integration'
import { metadata } from '../index'

describe('channel_mailjet contracts', () => {
  it('declares supported module metadata and coordinated versions', () => {
    expect(metadata).toEqual(expect.objectContaining({
      id: 'channel_mailjet',
      version: '0.1.0',
      requires: ['communication_channels', 'integrations'],
    }))
    expect(integration).toEqual(expect.objectContaining({
      version: '0.1.0',
      healthCheck: { service: 'channelMailjetHealthCheck' },
    }))
    expect(metadata).not.toHaveProperty('dependencies')
  })

  it('exports catalog-compatible ACL features and honest capabilities', () => {
    expect(features).toEqual([
      { id: 'channel_mailjet.view', title: expect.any(String), module: 'channel_mailjet' },
      { id: 'channel_mailjet.configure', title: expect.any(String), module: 'channel_mailjet' },
    ])
    expect(mailjetCapabilities.fileSharing).toBe(false)
  })
})
