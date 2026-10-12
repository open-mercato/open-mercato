/** @jest-environment node */

/**
 * #7174 review (major): outbound-dispatch's fail-closed fix only forwards webhooks for events
 * that carry trusted tenantId/organizationId in EmitOptions. `sales.document.totals.calculated`
 * emitted its payload (which already carried tenantId/organizationId) without passing them as
 * options, so a webhook subscribed to it would have silently stopped firing under the fix.
 */

import { emitTotalsCalculated } from '../documents'
import type { EventBus } from '@open-mercato/events/types'

describe('emitTotalsCalculated', () => {
  it('forwards the document scope as trusted EmitOptions, not just in the payload', async () => {
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const eventBus = { emitEvent } as unknown as EventBus

    await emitTotalsCalculated(eventBus, {
      documentKind: 'order',
      documentId: 'doc-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      totals: {} as never,
      lineCount: 3,
    })

    expect(emitEvent).toHaveBeenCalledWith(
      'sales.document.totals.calculated',
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('is a no-op when no event bus is available', async () => {
    await expect(emitTotalsCalculated(null, {
      documentKind: 'order',
      documentId: 'doc-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      totals: {} as never,
      lineCount: 0,
    })).resolves.toBeUndefined()
  })
})
