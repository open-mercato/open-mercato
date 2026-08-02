import { features } from '../acl'
import { sesCapabilities } from '../capabilities'
import { integration } from '../integration'
import { metadata } from '../index'

describe('channel_ses contracts', () => {
  it('declares supported module metadata and coordinated versions', () => {
    expect(metadata).toEqual(expect.objectContaining({
      id: 'channel_ses',
      version: '0.6.6',
      requires: ['communication_channels', 'integrations'],
    }))
    expect(integration).toEqual(expect.objectContaining({
      version: '0.6.6',
      healthCheck: { service: 'channelSesHealthCheck' },
    }))
    expect(metadata).not.toHaveProperty('dependencies')
  })

  it('exports catalog-compatible ACL features and honest capabilities', () => {
    expect(features).toEqual([
      { id: 'channel_ses.view', title: expect.any(String), module: 'channel_ses' },
      { id: 'channel_ses.configure', title: expect.any(String), module: 'channel_ses' },
    ])
    expect(sesCapabilities.fileSharing).toBe(false)
  })
})
