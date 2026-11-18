/** @jest-environment node */
import type { Booking, Lease, LeaseProposal } from '../data/entities'

jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import { emitPropertyManagementEvent } from '../events'
import { emitLeaseEvent, emitProposalEvent } from '../lib/leaseEvents'
import { emitBookingEvent } from '../lib/bookingEvents'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const trustedScope = { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId }

beforeEach(() => jest.clearAllMocks())

describe('lease and booking lifecycle events', () => {
  it('emits lease events persistently with the trusted tenant and organization', async () => {
    const lease = { id: 'lease-1', ...scope, reference: 'L-2026-001', unitId: 'u1', buildingId: 'b1', status: 'ended', endsOn: '2026-06-30' } as unknown as Lease
    await emitLeaseEvent('property_management.lease.ended', lease)
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.lease.ended',
      expect.objectContaining({ leaseId: 'lease-1', ...scope }),
      trustedScope,
    )
  })

  it('emits proposal events persistently with the trusted tenant and organization', async () => {
    const proposal = { id: 'p1', ...scope, leaseId: 'lease-1', kind: 'new', status: 'withdrawn' } as unknown as LeaseProposal
    await emitProposalEvent('property_management.lease_proposal.withdrawn', proposal)
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.lease_proposal.withdrawn',
      expect.objectContaining({ proposalId: 'p1', ...scope }),
      trustedScope,
    )
  })

  it('emits booking events persistently with the trusted tenant and organization', async () => {
    const booking = {
      id: 'booking-1',
      ...scope,
      unitId: 'u1',
      buildingId: 'b1',
      status: 'cancelled',
      startsAt: '2026-06-01T09:00',
      endsAt: '2026-06-01T10:00',
      bookedByPersonId: 'person-1',
    } as unknown as Booking
    await emitBookingEvent('property_management.booking.cancelled', booking)
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.booking.cancelled',
      expect.objectContaining({ bookingId: 'booking-1', ...scope }),
      trustedScope,
    )
  })

  it('reports a failed emit instead of failing the caller', async () => {
    jest.mocked(emitPropertyManagementEvent).mockRejectedValueOnce(new Error('bus down'))
    const lease = { id: 'lease-1', ...scope } as unknown as Lease
    await expect(emitLeaseEvent('property_management.lease.activated', lease)).resolves.toBeUndefined()
  })
})
