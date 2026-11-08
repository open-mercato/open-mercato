/** @jest-environment node */

import { InboxEmail } from '../../../data/entities'
import { EMAIL_INTERNAL_FIELDS, serializeInboxEmail } from '../response'

function buildEmail(): InboxEmail {
  const email = new InboxEmail()
  Object.assign(email, {
    id: 'email-1',
    subject: 'Offer',
    forwardedByAddress: 'buyer@example.test',
    toAddress: 'inbox@example.test',
    receivedAt: new Date('2026-11-08T10:00:00.000Z'),
    status: 'processed',
    rawText: 'sensitive body',
    attachmentIds: ['attachment-1'],
    attachmentsStatus: 'completed',
    attachmentsClaimToken: '99999999-9999-4999-8999-999999999999',
    attachmentsClaimedAt: new Date('2026-11-08T10:01:00.000Z'),
    attachmentsFirstFailureAt: new Date('2026-11-08T10:02:00.000Z'),
    attachmentsReleaseRequestedAt: new Date('2026-11-08T10:03:00.000Z'),
    attachmentsReleasedAt: new Date('2026-11-08T10:04:00.000Z'),
    attachmentsIngestGeneration: 3,
    attachmentsCurrentGeneration: 2,
    attachmentsNextRunAt: new Date('2026-11-08T10:05:00.000Z'),
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  })
  return email
}

describe('serializeInboxEmail', () => {
  it('lists every internal attachment-ingest column', () => {
    expect([...EMAIL_INTERNAL_FIELDS].sort()).toEqual([
      'attachmentsClaimToken',
      'attachmentsClaimedAt',
      'attachmentsCurrentGeneration',
      'attachmentsFirstFailureAt',
      'attachmentsIngestGeneration',
      'attachmentsNextRunAt',
      'attachmentsReleaseRequestedAt',
      'attachmentsReleasedAt',
    ])
  })

  it.each([true, false])('never serializes the internal columns (includeContent: %s)', (includeContent) => {
    const email = buildEmail()
    const serialized = JSON.parse(JSON.stringify(serializeInboxEmail(email, includeContent))) as Record<string, unknown>

    for (const field of EMAIL_INTERNAL_FIELDS) {
      expect(serialized).not.toHaveProperty(field)
    }
    expect(JSON.stringify(serialized)).not.toContain('99999999-9999-4999-8999-999999999999')
    expect(serialized).toMatchObject({ id: 'email-1', subject: 'Offer', status: 'processed' })
    // The entity itself is not mutated.
    expect(email.attachmentsClaimToken).toBe('99999999-9999-4999-8999-999999999999')
  })

  it('returns attachmentsStatus and attachmentIds to content viewers', () => {
    expect(serializeInboxEmail(buildEmail(), true)).toMatchObject({
      attachmentsStatus: 'completed',
      attachmentIds: ['attachment-1'],
      rawText: 'sensitive body',
    })
  })

  it('redacts attachmentsStatus with the other content fields for log-only viewers', () => {
    expect(serializeInboxEmail(buildEmail(), false)).toMatchObject({
      attachmentsStatus: null,
      attachmentIds: null,
      rawText: null,
      tenantId: null,
      subject: 'Offer',
    })
  })
})
