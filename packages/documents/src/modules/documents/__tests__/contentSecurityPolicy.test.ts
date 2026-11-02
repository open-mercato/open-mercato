const mockWarn = jest.fn()
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}))

let resolveDocumentsCollaborationCspOrigins: typeof import('../../../contentSecurityPolicy').resolveDocumentsCollaborationCspOrigins

function configure(environment: Record<string, string | undefined>) {
  jest.replaceProperty(process, 'env', {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: undefined,
    OM_DOCUMENTS_COLLAB_INTEGRATION: undefined,
    ...environment,
  })
}

beforeEach(() => {
  jest.resetModules()
  mockWarn.mockClear()
  const policy = require('../../../contentSecurityPolicy') as typeof import('../../../contentSecurityPolicy')
  resolveDocumentsCollaborationCspOrigins = policy.resolveDocumentsCollaborationCspOrigins
})

afterEach(() => jest.restoreAllMocks())

it('allows only the configured collaboration origin, without its path or query', () => {
  configure({ NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: 'wss://collab.example.com/documents?workspace=preview' })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual(['wss://collab.example.com'])
})

it.each(['ws://127.0.0.1:4101', 'ws://localhost:4101', 'ws://[::1]:4101'])('preserves the production loopback gate for %s', (endpoint) => {
  configure({ NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: endpoint })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual([])
})

it('honors the existing integration-only loopback permission with an exact origin', () => {
  configure({ NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: 'ws://127.0.0.1:4101/documents', OM_DOCUMENTS_COLLAB_INTEGRATION: '1' })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual(['ws://127.0.0.1:4101'])
})

it('keeps configured development websocket endpoints working', () => {
  configure({ NODE_ENV: 'development', NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: 'ws://localhost:4101' })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual(['ws://localhost:4101'])
})

it.each([undefined, 'invalid', 'https://collab.example.com', 'wss://collab.example.com;script-src', 'wss://user:demo@collab.example.com'])('does not add missing, invalid or unsafe endpoint %s', (endpoint) => {
  configure({ NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: endpoint })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual([])
})

it.each(['wss://collab_internal.example.com/documents?token=private', 'wss://user:private@collab.example.com'])('warns without disclosing an excluded configured endpoint', (endpoint) => {
  configure({ NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: endpoint })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual([])
  expect(mockWarn).toHaveBeenCalledTimes(1)
  expect(mockWarn).toHaveBeenCalledWith(
    '[internal] Collaboration endpoint excluded from CSP; use a credential-free DNS or IPv6 URL',
    { configuration: 'NEXT_PUBLIC_DOCUMENTS_COLLAB_URL' },
  )
})

it('warns once across repeated requests and excluded endpoint changes', () => {
  configure({ NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: 'wss://collab_internal.example.com/documents' })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual([])
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual([])
  configure({ NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: 'wss://user:private@collab.example.com' })
  expect(resolveDocumentsCollaborationCspOrigins()).toEqual([])
  expect(mockWarn).toHaveBeenCalledTimes(1)
})
