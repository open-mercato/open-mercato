import { resolveContact } from '../contact-resolver'
import type { ChannelAdapter, ChannelCapabilities, ContactHint } from '../adapter'

function baseCapabilities(): ChannelCapabilities {
  return {
    threading: false,
    richText: false,
    fileSharing: false,
    readReceipts: false,
    deliveryReceipts: false,
    typingIndicators: false,
    reactions: false,
    multiReactionPerUser: false,
    editMessage: false,
    deleteMessage: false,
    presence: false,
    richBlocks: false,
    interactiveComponents: false,
    inlineImages: false,
    conversationHistory: false,
    contactCards: false,
    locationSharing: false,
    voiceNotes: false,
    stickers: false,
    supportedBodyFormats: ['text'],
  }
}

function makeAdapter(resolveContactImpl?: (input: any) => Promise<ContactHint | null>): ChannelAdapter {
  return {
    providerKey: 'test',
    channelType: 'test',
    capabilities: baseCapabilities(),
    sendMessage: (() => Promise.resolve({} as any)) as any,
    verifyWebhook: (() => Promise.resolve({} as any)) as any,
    getStatus: (() => Promise.resolve({} as any)) as any,
    convertOutbound: (() => Promise.resolve({} as any)) as any,
    normalizeInbound: ((raw: any) => Promise.resolve(raw)) as any,
    resolveContact: resolveContactImpl as any,
  }
}

function makeContainer(queryRows: Record<string, unknown>[] = []) {
  return {
    resolve: (name: string) => {
      if (name === 'queryEngine') {
        return {
          query: jest.fn(async () => queryRows),
        }
      }
      throw new Error(`Unknown DI key: ${name}`)
    },
  }
}

const scope = { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: '22222222-2222-2222-2222-222222222222' }

describe('resolveContact', () => {
  const prevEncryption = process.env.TENANT_DATA_ENCRYPTION
  beforeEach(() => {
    // The CRM fast-path lookup filters `primary_email`/`primary_phone` by value,
    // which is only valid (and only runs) when tenant encryption is OFF. These
    // tests exercise that path.
    process.env.TENANT_DATA_ENCRYPTION = 'no'
  })
  afterEach(() => {
    if (prevEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = prevEncryption
  })

  it('returns null when adapter has no resolveContact and senderIdentifier is empty', async () => {
    const adapter = makeAdapter()
    const out = await resolveContact(
      {
        adapter,
        senderIdentifier: '',
        credentials: {},
        scope,
      },
      { container: makeContainer() },
    )
    expect(out).toBeNull()
  })

  it('returns adapter hint with no CRM match when no person found', async () => {
    const adapter = makeAdapter(async () => ({ email: 'jane@example.com', displayName: 'Jane' }))
    const out = await resolveContact(
      {
        adapter,
        senderIdentifier: 'jane@example.com',
        credentials: {},
        scope,
      },
      { container: makeContainer([]) },
    )
    expect(out?.email).toBe('jane@example.com')
    expect(out?.displayName).toBe('Jane')
    expect(out?.matchedPersonId).toBeUndefined()
  })

  it('populates matchedPersonId when QueryEngine returns a person', async () => {
    const adapter = makeAdapter(async () => ({ email: 'jane@example.com' }))
    const out = await resolveContact(
      {
        adapter,
        senderIdentifier: 'jane@example.com',
        credentials: {},
        scope,
      },
      { container: makeContainer([{ id: 'person-1', primary_email: 'jane@example.com', kind: 'person' }]) },
    )
    expect(out?.matchedPersonId).toBe('person-1')
  })

  it('uses email heuristic when adapter has no resolveContact and identifier looks like email', async () => {
    const adapter = makeAdapter() // no resolveContact
    const out = await resolveContact(
      {
        adapter,
        senderIdentifier: 'someone@example.com',
        credentials: {},
        scope,
      },
      { container: makeContainer([{ id: 'p-2' }]) },
    )
    expect(out?.email).toBe('someone@example.com')
    expect(out?.matchedPersonId).toBe('p-2')
  })

  it('uses phone heuristic when identifier matches +<digits>', async () => {
    const adapter = makeAdapter() // no resolveContact
    const out = await resolveContact(
      {
        adapter,
        senderIdentifier: '+14155551234',
        credentials: {},
        scope,
      },
      { container: makeContainer([{ id: 'p-3' }]) },
    )
    expect(out?.phone).toBe('+14155551234')
    expect(out?.matchedPersonId).toBe('p-3')
  })

  it('swallows adapter errors gracefully (resolveContact throws → fall back to heuristics)', async () => {
    const adapter = makeAdapter(async () => {
      throw new Error('adapter failure')
    })
    const out = await resolveContact(
      {
        adapter,
        senderIdentifier: 'jane@example.com',
        credentials: {},
        scope,
      },
      { container: makeContainer([]) },
    )
    expect(out?.email).toBe('jane@example.com') // heuristic worked
    expect(out?.matchedPersonId).toBeUndefined() // no CRM match
  })

  it('skips the plaintext CRM lookup under tenant encryption (§16 footgun guard)', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const queryMock = jest.fn(async () => [{ id: 'person-1', primary_email: 'jane@example.com' }])
    const container = {
      resolve: (name: string) => {
        if (name === 'queryEngine') return { query: queryMock }
        throw new Error(`Unknown DI key: ${name}`)
      },
    }
    const adapter = makeAdapter(async () => ({ email: 'jane@example.com' }))
    const out = await resolveContact(
      { adapter, senderIdentifier: 'jane@example.com', credentials: {}, scope },
      { container: container as any },
    )
    // Lookup is skipped — no plaintext query issued against the encrypted column,
    // and no (necessarily-empty) match is returned.
    expect(queryMock).not.toHaveBeenCalled()
    expect(out?.matchedPersonId).toBeUndefined()
  })

  it('swallows QueryEngine errors gracefully (lookup throws → matchedPersonId undefined)', async () => {
    const failingContainer = {
      resolve: () => ({
        query: jest.fn(async () => {
          throw new Error('queryEngine failure')
        }),
      }),
    }
    const adapter = makeAdapter(async () => ({ email: 'jane@example.com' }))
    const out = await resolveContact(
      {
        adapter,
        senderIdentifier: 'jane@example.com',
        credentials: {},
        scope,
      },
      { container: failingContainer as any },
    )
    expect(out?.email).toBe('jane@example.com')
    expect(out?.matchedPersonId).toBeUndefined()
  })
})
