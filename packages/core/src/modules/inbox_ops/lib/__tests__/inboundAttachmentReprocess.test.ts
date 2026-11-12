/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  isInboundAttachmentClaimExpired,
  planInboundAttachmentReprocess,
  resolveInboundAttachmentsRetryable,
} from '../inboundAttachmentReprocess'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const NOW = new Date('2026-11-09T12:00:00.000Z')
const LEASE_MS = 10 * 60 * 1000

function emailAt(id: string, claimedAgoMs: number | null) {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'received' as const,
    attachmentsStatus: 'processing' as const,
    attachmentsClaimedAt: claimedAgoMs === null ? null : new Date(NOW.getTime() - claimedAgoMs),
  }
}

describe('attachmentsRetryable for a processing ingest', () => {
  const em = { getKysely: jest.fn() } as unknown as EntityManager
  const options = { config: { leaseMs: LEASE_MS }, now: () => NOW }

  it('expires a claim only past the configured lease', () => {
    expect(isInboundAttachmentClaimExpired(null, LEASE_MS, NOW)).toBe(true)
    expect(isInboundAttachmentClaimExpired(new Date(NOW.getTime() - LEASE_MS), LEASE_MS, NOW)).toBe(false)
    expect(isInboundAttachmentClaimExpired(new Date(NOW.getTime() - LEASE_MS - 1), LEASE_MS, NOW)).toBe(true)
  })

  it('agrees with the reprocess plan: no retry for a live claim, a retry for an expired or missing one', async () => {
    const emails = [emailAt('live', LEASE_MS - 1000), emailAt('expired', LEASE_MS + 1000), emailAt('unclaimed', null)]
    const retryable = await resolveInboundAttachmentsRetryable(em, scope, emails, options)
    expect(Object.fromEntries(retryable)).toEqual({ live: false, expired: true, unclaimed: true })
    for (const email of emails) {
      const plan = await planInboundAttachmentReprocess(em, email, options)
      expect(plan === 'requeue_ingest').toBe(retryable.get(email.id))
    }
    // No finished ingest on the page: no ledger query.
    expect(em.getKysely).not.toHaveBeenCalled()
  })
})
