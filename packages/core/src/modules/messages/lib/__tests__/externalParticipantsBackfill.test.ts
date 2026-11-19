import { buildBackfillParticipants, mapLinkDeliveryStatus } from '../externalParticipantsBackfill'

const systemMessage = {
  externalEmail: 'primary@example.com',
  externalEmailSentAt: null,
  externalEmailFailedAt: null,
}

describe('external participants backfill mapping', () => {
  it('maps link delivery statuses to participant statuses', () => {
    expect(mapLinkDeliveryStatus('sent')).toBe('sent')
    expect(mapLinkDeliveryStatus('delivered')).toBe('sent')
    expect(mapLinkDeliveryStatus('read')).toBe('sent')
    expect(mapLinkDeliveryStatus('failed')).toBe('failed')
    expect(mapLinkDeliveryStatus('pending')).toBeNull()
    expect(mapLinkDeliveryStatus(null)).toBeNull()
  })

  it('reads to/cc/bcc from outbound link metadata and ignores external_email then', () => {
    const participants = buildBackfillParticipants(systemMessage, [
      {
        deliveryStatus: 'delivered',
        channelMetadata: {
          to: ['a@example.com', 'Bee <b@example.com>'],
          cc: [{ address: 'c@example.com', name: 'Cee' }],
          bcc: ['d@example.com', 'not-an-address'],
        },
      },
    ])
    expect(participants).toEqual([
      { role: 'to', email: 'a@example.com', deliveryStatus: 'sent' },
      { role: 'to', email: 'b@example.com', deliveryStatus: 'sent' },
      { role: 'cc', email: 'c@example.com', deliveryStatus: 'sent' },
      { role: 'bcc', email: 'd@example.com', deliveryStatus: 'sent' },
    ])
  })

  it('de-duplicates the same address within a role', () => {
    const participants = buildBackfillParticipants(systemMessage, [
      { deliveryStatus: 'failed', channelMetadata: { to: ['a@example.com', 'A@example.com'] } },
    ])
    expect(participants).toEqual([{ role: 'to', email: 'a@example.com', deliveryStatus: 'failed' }])
  })

  it('falls back to external_email with its sent/failed stamps when there is no link', () => {
    expect(buildBackfillParticipants({ ...systemMessage, externalEmailSentAt: new Date() }, [])).toEqual([
      { role: 'to', email: 'primary@example.com', deliveryStatus: 'sent' },
    ])
    expect(buildBackfillParticipants({ ...systemMessage, externalEmailFailedAt: new Date() }, [])).toEqual([
      { role: 'to', email: 'primary@example.com', deliveryStatus: 'failed' },
    ])
    expect(buildBackfillParticipants(systemMessage, [])).toEqual([
      { role: 'to', email: 'primary@example.com', deliveryStatus: null },
    ])
    expect(buildBackfillParticipants({ ...systemMessage, externalEmail: null }, [])).toEqual([])
  })
})
