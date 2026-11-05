/** @jest-environment node */

import { enrichOrderPayload } from '../payloadEnrichment'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const mockFindOneWithDecryption = findOneWithDecryption as jest.Mock

describe('enrichOrderPayload (#6272 sales-channel currency fallback)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  const baseCtx = {
    em: {} as never,
    scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
    contactMatches: [],
    catalogProducts: [],
    senderEmail: 'buyer@example.com',
    salesChannelClass: {} as never,
  }

  it('never fills currencyCode from the resolved channel, even when the channel row carries an extra currencyCode-shaped field', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'channel-1',
      name: 'Web Store',
      // A real SalesChannel row never has this column; simulates a stale/legacy row
      // that still happens to carry the field to prove enrichment never reads it.
      currencyCode: 'EUR',
    })

    const result = await enrichOrderPayload({ lineItems: [] }, baseCtx)

    expect(result.payload.channelId).toBe('channel-1')
    expect(result.payload.currencyCode).toBeUndefined()
    expect(result.warnings).toContain('no_currency_resolved')
  })

  it('still resolves channelId from the channel lookup without touching currency', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'channel-2', name: 'POS' })

    const result = await enrichOrderPayload({ channelId: undefined, lineItems: [] }, baseCtx)

    expect(result.payload.channelId).toBe('channel-2')
    expect(result.warnings).not.toContain('no_channel_resolved')
  })

  it('does not warn about currency when the payload already states one', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'channel-1', name: 'Web Store' })

    const result = await enrichOrderPayload({ currencyCode: 'USD', lineItems: [] }, baseCtx)

    expect(result.payload.currencyCode).toBe('USD')
    expect(result.warnings).not.toContain('no_currency_resolved')
  })
})
