// Mock the encryption helper so the lib's reads return fixtures without a real
// EntityManager / DB. All three reads (interactions, links, messages) go through
// findWithDecryption — interactions included, because `customer_interaction.title`
// / `body` are encrypted at rest.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { buildPersonEmailThreads } from '../personEmailThreads'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerInteraction } from '../../data/entities'

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const links = [
  {
    id: 'L1',
    messageId: 'M1',
    direction: 'inbound',
    providerKey: 'gmail',
    channelPayload: {
      from: [{ address: 'alice@example.com', name: 'Alice' }],
      to: ['me@org.com'],
      subject: 'Project kickoff',
      text: 'Hi, can we schedule the kickoff?',
      messageId: '<a1@example.com>',
      references: [],
    },
    channelMetadata: {},
    createdAt: new Date('2026-05-20T10:00:00.000Z'),
  },
  {
    id: 'L2',
    messageId: 'M2',
    direction: 'outbound',
    providerKey: 'gmail',
    channelPayload: { text: 'Sure, how about Tuesday?' },
    channelMetadata: {
      to: ['alice@example.com'],
      subject: 'Re: Project kickoff',
      inReplyTo: '<a1@example.com>',
      references: ['<a1@example.com>'],
      messageId: '<r1@org.com>',
    },
    createdAt: new Date('2026-05-20T11:00:00.000Z'),
  },
  {
    id: 'L3',
    messageId: 'M3',
    direction: 'inbound',
    providerKey: 'imap',
    channelPayload: {
      from: [{ address: 'bob@vendor.com' }],
      to: ['me@org.com'],
      subject: 'Quote request',
      text: 'Please send a quote.',
      messageId: '<b1@vendor.com>',
    },
    channelMetadata: {},
    createdAt: new Date('2026-05-21T09:00:00.000Z'),
  },
]

const messages = [
  { id: 'M1', threadId: 'T1', subject: 'Project kickoff', body: 'Hi, can we schedule the kickoff?', sentAt: '2026-05-20T10:00:00.000Z' },
  { id: 'M2', threadId: 'T1', subject: 'Re: Project kickoff', body: 'Sure, how about Tuesday?', sentAt: '2026-05-20T11:00:00.000Z' },
  { id: 'M3', threadId: 'T2', subject: 'Quote request', body: 'Please send a quote.', sentAt: '2026-05-21T09:00:00.000Z' },
]

const interactions = [
  { externalMessageId: 'L3', occurredAt: new Date('2026-05-21T09:00:00.000Z'), createdAt: new Date('2026-05-21T09:00:00.000Z'), visibility: 'shared', authorUserId: 'u1' },
  { externalMessageId: 'L2', occurredAt: new Date('2026-05-20T11:00:00.000Z'), createdAt: new Date('2026-05-20T11:00:00.000Z'), visibility: 'private', authorUserId: 'u1' },
  { externalMessageId: 'L1', occurredAt: new Date('2026-05-20T10:00:00.000Z'), createdAt: new Date('2026-05-20T10:00:00.000Z'), visibility: 'shared', authorUserId: 'u1' },
]

/**
 * Dispatch the lib's three findWithDecryption reads by entity:
 *   - CustomerInteraction (entity class) → the Person's email interactions
 *   - 'MessageChannelLink' (string)      → hub links
 *   - 'Message' (string)                 → hub messages
 */
function mockHubReads(interactionRows: unknown[]) {
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === CustomerInteraction) return interactionRows as never
    if (entity === 'MessageChannelLink') return links as never
    if (entity === 'Message') return messages as never
    return [] as never
  })
}

/** The `where` the lib passed to the CustomerInteraction read (for visibility assertions). */
function interactionWhere(): Record<string, unknown> | undefined {
  const call = mockFindWithDecryption.mock.calls.find((c) => c[1] === CustomerInteraction)
  return call?.[2] as Record<string, unknown> | undefined
}

const baseOpts = {
  personId: 'P1',
  tenantId: 'tenant-1',
  organizationId: 'org-1' as string | null,
  viewerUserId: 'u1' as string | null,
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('buildPersonEmailThreads', () => {
  it('groups messages into threads, newest thread first, messages chronological', async () => {
    mockHubReads(interactions)
    const threads = await buildPersonEmailThreads({} as never, { ...baseOpts, userFeatures: [] })

    expect(threads).toHaveLength(2)
    // T2 (2026-05-21) is more recent than T1 (2026-05-20)
    expect(threads[0].threadKey).toBe('T2')
    expect(threads[1].threadKey).toBe('T1')

    const t1 = threads[1]
    expect(t1.subject).toBe('Project kickoff')
    expect(t1.messageCount).toBe(2)
    expect(t1.lastDirection).toBe('outbound')
    expect(t1.messages.map((m) => m.id)).toEqual(['L1', 'L2'])
    expect(t1.participants).toEqual(['alice@example.com'])
    expect(t1.preview).toBe('Sure, how about Tuesday?')
  })

  it('extracts direction, sender, and recipients per message', async () => {
    mockHubReads(interactions)
    const threads = await buildPersonEmailThreads({} as never, { ...baseOpts, userFeatures: [] })
    const t1 = threads.find((t) => t.threadKey === 'T1')!
    const [inbound, outbound] = t1.messages

    expect(inbound.direction).toBe('inbound')
    expect(inbound.fromEmail).toBe('alice@example.com')
    expect(inbound.fromName).toBe('Alice')
    expect(inbound.bodyText).toBe('Hi, can we schedule the kickoff?')

    expect(outbound.direction).toBe('outbound')
    expect(outbound.to).toEqual(['alice@example.com'])
    expect(outbound.bodyText).toBe('Sure, how about Tuesday?')
  })

  it('exposes reply threading fields (parent messageId, RFC Message-ID, references)', async () => {
    mockHubReads(interactions)
    const threads = await buildPersonEmailThreads({} as never, { ...baseOpts, userFeatures: [] })
    const t1 = threads.find((t) => t.threadKey === 'T1')!
    const outbound = t1.messages[1]
    expect(outbound.messageId).toBe('M2')
    expect(outbound.rfcMessageId).toBe('<r1@org.com>')
    expect(outbound.references).toEqual(['<a1@example.com>'])
  })

  it('applies per-email visibility — shared to everyone, private to its author (v1)', async () => {
    mockHubReads(interactions)
    await buildPersonEmailThreads({} as never, { ...baseOpts, userFeatures: [] })
    const where = interactionWhere()!
    // A viewer sees shared emails (visibility != 'private'), legacy/unset rows,
    // and their OWN private emails (authorUserId = viewer). Another user's
    // private threads stay hidden.
    expect(where.$or).toEqual([
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
      { authorUserId: 'u1' },
    ])
  })

  it('keeps the threads fail-closed for a null viewer (API-key caller)', async () => {
    mockHubReads(interactions)
    await buildPersonEmailThreads({} as never, { ...baseOpts, viewerUserId: null, userFeatures: [] })
    const where = interactionWhere()!
    // A null viewer gets NO author clause, so it can only ever match shared or
    // legacy/unset rows — never any user's private email.
    expect(where.$or).toEqual([
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
    ])
  })

  it('grants admins NO bypass — a teammate\'s private email stays hidden (v1)', async () => {
    mockHubReads(interactions)
    await buildPersonEmailThreads({} as never, { ...baseOpts, userFeatures: ['customers.*'] })
    const where = interactionWhere()!
    // Personal mailbox privacy v1 — even a superadmin gets the plain visibility
    // filter: shared + legacy + their OWN private. No view_private bypass arm.
    expect(where.$or).toEqual([
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
      { authorUserId: 'u1' },
    ])
  })

  it('returns an empty list when the person has no email interactions', async () => {
    mockHubReads([])
    const threads = await buildPersonEmailThreads({} as never, { ...baseOpts, userFeatures: [] })
    expect(threads).toEqual([])
  })
})
