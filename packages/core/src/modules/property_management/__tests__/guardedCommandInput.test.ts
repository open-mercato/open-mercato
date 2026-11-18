/** @jest-environment node */
import { z } from 'zod'
import type { RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { guardedCommandInput } from '../api/routeContext'

const schema = z.object({ id: z.string(), tenantId: z.string(), organizationId: z.string(), reason: z.string() })
const input = { id: 'booking-1', tenantId: 'tenant-1', organizationId: 'org-1', reason: 'manager' }
const pinned = { id: 'booking-1', tenantId: 'tenant-1', organizationId: 'org-1', reason: 'manager' }

function passed(modifiedPayload?: Record<string, unknown>): RouteMutationGuardResult {
  return { ok: true, modifiedPayload, runAfterSuccess: async () => undefined }
}

describe('guardedCommandInput', () => {
  it('keeps the validated input when no guard rewrote the payload', () => {
    expect(guardedCommandInput(schema, passed(), input, pinned)).toBe(input)
  })

  it('re-pins scope and route identity over a rewritten payload', () => {
    const rewritten = { id: 'booking-2', tenantId: 'tenant-2', organizationId: 'org-2', reason: 'customer' }
    expect(guardedCommandInput(schema, passed(rewritten), input, pinned)).toEqual(input)
  })

  it('restores scope a guard dropped from the payload', () => {
    expect(guardedCommandInput(schema, passed({ reason: 'manager' }), input, pinned)).toEqual(input)
  })
})
