import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enrichers } = require('../enrichers') as typeof import('../enrichers')

const PAYLOAD_ENRICHER_ID = 'communication_channels.message-channel'

function getPayloadEnricher(): ResponseEnricher {
  const enricher = enrichers.find((e) => e.id === PAYLOAD_ENRICHER_ID)
  if (!enricher) throw new Error('[internal] payload enricher not registered')
  return enricher
}

function makeContext(messageId: string): EnricherContext {
  const joinBuilder: any = {
    onRef: jest.fn(() => joinBuilder),
    on: jest.fn(() => joinBuilder),
  }
  const participantQuery: any = {
    selectFrom: jest.fn(() => participantQuery),
    leftJoin: jest.fn((_table: string, join: (builder: any) => unknown) => {
      join(joinBuilder)
      return participantQuery
    }),
    select: jest.fn(() => participantQuery),
    distinct: jest.fn(() => participantQuery),
    where: jest.fn(() => participantQuery),
    execute: jest.fn(async () => [{ id: messageId }]),
  }
  return {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    em: { getKysely: () => participantQuery },
    container: {},
  }
}

async function enrichOne(record: Record<string, unknown>): Promise<Record<string, unknown>> {
  const enricher = getPayloadEnricher()
  const [out] = await enricher.enrichMany!([record], makeContext(String(record.id)))
  return out as Record<string, unknown>
}

describe('communication_channels message-channel-payload enricher', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('sanitizes email HTML on the server and exposes a sanitizedHtml field with scripts stripped', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        messageId: 'msg-1',
        channelContentType: 'email/rfc822',
        channelPayload: { html: '<p>Hello</p><script>alert(1)</script>' },
        interactiveState: null,
        channelMetadata: null,
      },
    ])

    const out = await enrichOne({ id: 'msg-1' })
    const payload = out._channelPayload as { sanitizedHtml?: unknown }

    expect(typeof payload.sanitizedHtml).toBe('string')
    expect(payload.sanitizedHtml as string).toContain('<p>Hello</p>')
    expect(payload.sanitizedHtml as string).not.toContain('<script>')
    expect(payload.sanitizedHtml as string).not.toContain('alert(1)')
  })

  it('leaves sanitizedHtml null for non-email payloads', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        messageId: 'msg-2',
        channelContentType: 'slack/blocks',
        channelPayload: { blocks: [{ type: 'section' }] },
        interactiveState: null,
        channelMetadata: null,
      },
    ])

    const out = await enrichOne({ id: 'msg-2' })
    const payload = out._channelPayload as { sanitizedHtml?: unknown }

    expect(payload.sanitizedHtml).toBeNull()
  })

  it('leaves sanitizedHtml null for email payloads without an html body', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        messageId: 'msg-3',
        channelContentType: 'email/rfc822',
        channelPayload: { text: 'plain only' },
        interactiveState: null,
        channelMetadata: null,
      },
    ])

    const out = await enrichOne({ id: 'msg-3' })
    const payload = out._channelPayload as { sanitizedHtml?: unknown }

    expect(payload.sanitizedHtml).toBeNull()
  })
})
