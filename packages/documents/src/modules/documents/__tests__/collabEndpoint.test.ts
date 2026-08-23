import { resolveDocumentsCollaborationEndpoint } from '../lib/collabEndpoint'

describe('resolveDocumentsCollaborationEndpoint', () => {
  it.each([
    'wss://collab.example.test/socket',
    'ws://collab.internal.test:4101',
  ])('accepts a browser-reachable WebSocket endpoint: %s', (endpoint) => {
    expect(resolveDocumentsCollaborationEndpoint(endpoint, { nodeEnv: 'production' })).toBe(endpoint)
  })

  it.each([
    '',
    ' ',
    'https://collab.example.test',
    'ws://localhost:4101',
    'ws://localhost.:4101',
    'wss://preview.localhost/socket',
    'wss://preview.localhost.:4101/socket',
    'ws://127.0.0.2:4101',
    'ws://[::1]:4101',
    'ws://[::ffff:127.0.0.1]:4101',
    'ws://0.0.0.0:4101',
  ])('disables an invalid production endpoint without aborting startup: %s', (endpoint) => {
    expect(resolveDocumentsCollaborationEndpoint(endpoint, { nodeEnv: 'production' })).toBeNull()
  })

  it('allows loopback for development and explicit integration environments', () => {
    const endpoint = 'ws://127.0.0.1:4101'

    expect(resolveDocumentsCollaborationEndpoint(endpoint, { nodeEnv: 'development' })).toBe(endpoint)
    expect(resolveDocumentsCollaborationEndpoint(endpoint, {
      nodeEnv: 'production',
      allowLoopback: true,
    })).toBe(endpoint)
  })
})
