const resolveMessageContextMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn(async () => [])
const applyResponseEnricherToRecordMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/enricher-runner', () => ({
  applyResponseEnricherToRecord: (...args: unknown[]) => applyResponseEnricherToRecordMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  // Keep the real feature helpers — only the request-context entry points are stubbed.
  ...jest.requireActual('@open-mercato/core/modules/messages/lib/routeHelpers'),
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  hasOrganizationAccess: () => true,
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageTypeOrDefault: () => ({
    labelKey: 'messages.type.default',
    icon: 'mail',
    color: 'gray',
    allowReply: true,
    allowForward: true,
    ui: {},
  }),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-objects-registry', () => ({
  getMessageObjectType: () => null,
}))

jest.mock('@open-mercato/core/modules/messages/lib/actions', () => ({
  buildResolvedMessageActions: () => [],
}))

jest.mock('@open-mercato/core/modules/messages/lib/operationMetadata', () => ({
  attachOperationMetadataHeader: (response: Response) => response,
}))

import { GET } from '@open-mercato/core/modules/messages/api/[id]/route'

const tenantId = '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7'
const organizationId = '2045013f-8977-4f57-a1cc-9bb7d2f42a0e'
const userId = '5be8e4d6-14d2-4352-8f55-b95f95fd9205'
const messageId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

function makeMessage() {
  return {
    id: messageId,
    organizationId,
    tenantId,
    senderUserId: userId,
    type: 'channel.imap',
    subject: 'Quote #123',
    body: 'Hello',
    bodyFormat: 'text',
    priority: 'normal',
    isDraft: false,
    visibility: 'public',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId: 'conv-1',
    externalEmail: 'jane@example.com',
    externalName: 'Jane Doe',
    sentAt: new Date('2026-05-21T10:00:00Z'),
    updatedAt: new Date('2026-05-21T10:00:00Z'),
    threadId: null,
    parentMessageId: null,
    actionData: null,
    actionTaken: null,
    actionTakenAt: null,
    actionTakenByUserId: null,
  }
}

const getGrantedFeaturesMock = jest.fn(async () => ['messages.view', 'communication_channels.view'])

function makeCtx() {
  const em = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
    persist: jest.fn(),
  }
  const rbacService = { getGrantedFeatures: getGrantedFeaturesMock }
  return {
    ctx: {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'rbacService') return rbacService
          return null
        },
      },
      // Deliberately WITHOUT `features` — the real session token carries only
      // `roles`. Reading features off auth would yield an empty list and the
      // ACL gate would drop every feature-gated enricher.
      auth: { sub: userId, tenantId, orgId: organizationId, roles: ['admin'] },
    },
    scope: { tenantId, organizationId, userId },
  }
}

describe('GET /api/messages/[id] — response enrichers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveMessageContextMock.mockImplementation(async () => makeCtx())
    findOneWithDecryptionMock.mockImplementation(async () => makeMessage())
    findWithDecryptionMock.mockImplementation(async () => [])
    applyResponseEnricherToRecordMock.mockImplementation(async (record: Record<string, unknown>) => ({
      record: { ...record, _channelPayload: { sanitizedHtml: '<p>Hello</p>' } },
      _meta: { enrichedBy: ['communication_channels.message-channel'] },
    }))
  })

  it('runs enrichers targeting messages.message and returns their output', async () => {
    // The shipped channel-payload renderer widget reads `_channelPayload` off the
    // detail response. Without this call it never has anything to render, so the
    // sanitized email HTML / Block Kit payload silently disappears from the UI.
    const res = await GET(new Request(`http://localhost/api/messages/${messageId}`), {
      params: { id: messageId },
    })
    const body = await res.json()

    expect(applyResponseEnricherToRecordMock).toHaveBeenCalledTimes(1)
    const [record, targetEntity, context] = applyResponseEnricherToRecordMock.mock.calls[0]
    expect(targetEntity).toBe('messages.message')
    expect((record as { id: string }).id).toBe(messageId)
    expect(context).toEqual(
      expect.objectContaining({ tenantId, organizationId, userId }),
    )
    expect(body._channelPayload).toEqual({ sanitizedHtml: '<p>Hello</p>' })
    expect(body._meta).toEqual({ enrichedBy: ['communication_channels.message-channel'] })
  })

  it('omits _meta when no enricher ran', async () => {
    applyResponseEnricherToRecordMock.mockImplementationOnce(async (record: Record<string, unknown>) => ({
      record,
      _meta: { enrichedBy: [] },
    }))

    const res = await GET(new Request(`http://localhost/api/messages/${messageId}`), {
      params: { id: messageId },
    })
    const body = await res.json()

    expect(body.id).toBe(messageId)
    expect(body._meta).toBeUndefined()
  })

  it('reports a non-critical enricher failure through _meta.enricherErrors', async () => {
    // The runner isolates non-critical failures itself: it merges the enricher's
    // `fallback` and records the id. The route only has to pass that envelope on.
    applyResponseEnricherToRecordMock.mockImplementationOnce(async (record: Record<string, unknown>) => ({
      record: { ...record, _channelPayload: null },
      _meta: { enrichedBy: [], enricherErrors: ['communication_channels.message-channel'] },
    }))

    const res = await GET(new Request(`http://localhost/api/messages/${messageId}`), {
      params: { id: messageId },
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.subject).toBe('Quote #123')
    expect(body._channelPayload).toBeNull()
    expect(body._meta.enricherErrors).toEqual(['communication_channels.message-channel'])
  })

  it('resolves enricher features from RBAC, not from the session token', async () => {
    // Regression: the token carries `roles`, never `features`. Sourcing them
    // from auth left `userFeatures` empty, so the runner's ACL gate silently
    // dropped `communication_channels.message-channel` (gated on
    // `communication_channels.view`) and the response looked well-formed but
    // carried no enrichment at all.
    await GET(new Request(`http://localhost/api/messages/${messageId}`), {
      params: { id: messageId },
    })

    expect(getGrantedFeaturesMock).toHaveBeenCalledWith(userId, { tenantId, organizationId })
    const [, , context] = applyResponseEnricherToRecordMock.mock.calls[0]
    expect(context).toEqual(
      expect.objectContaining({
        userFeatures: expect.arrayContaining(['communication_channels.view']),
      }),
    )
  })

  it('denies feature-gated enrichers when RBAC is unavailable', async () => {
    // `undefined` makes the runner treat every gated enricher as denied — the
    // safe direction when we cannot establish what the caller may see.
    getGrantedFeaturesMock.mockRejectedValueOnce(new Error('rbac down'))

    await GET(new Request(`http://localhost/api/messages/${messageId}`), {
      params: { id: messageId },
    })

    const [, , context] = applyResponseEnricherToRecordMock.mock.calls[0]
    expect((context as { userFeatures?: string[] }).userFeatures).toBeUndefined()
  })

  it('propagates a critical enricher failure instead of degrading silently', async () => {
    // `critical: true` is specified as "enricher errors propagate as HTTP errors"
    // (`response-enricher.ts`), and it is the only error the runner re-throws.
    // Catching it here would turn a declared hard failure into a well-formed
    // response that is quietly missing data.
    applyResponseEnricherToRecordMock.mockRejectedValueOnce(new Error('critical enricher blew up'))

    await expect(
      GET(new Request(`http://localhost/api/messages/${messageId}`), { params: { id: messageId } }),
    ).rejects.toThrow('critical enricher blew up')
  })
})
