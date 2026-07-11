import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CLAIM_STATUS_TRANSITIONS } from '../data/constants'
import type { WarrantyClaimLineStatus, WarrantyClaimStatus } from '../data/validators'
import {
  assertTransition,
  canResolveWithLineStatuses,
  canTransition,
  computeHeaderRollups,
  isTerminal,
  lineStatusGuards,
  nextStatuses,
} from '../lib/stateMachine'

const allStatuses = Object.keys(CLAIM_STATUS_TRANSITIONS) as WarrantyClaimStatus[]

describe('warranty claim state machine', () => {
  test('allows every declared transition', () => {
    for (const [from, targets] of Object.entries(CLAIM_STATUS_TRANSITIONS) as Array<[WarrantyClaimStatus, WarrantyClaimStatus[]]>) {
      for (const to of targets) {
        expect(canTransition(from, to)).toBe(true)
        expect(() => assertTransition(from, to)).not.toThrow()
      }
    }
  })

  test('rejects representative illegal transitions with a 400', () => {
    const illegalTransitions: Array<[WarrantyClaimStatus, WarrantyClaimStatus]> = [
      ['draft', 'approved'],
      ['submitted', 'resolved'],
      ['received', 'cancelled'],
      ['closed', 'approved'],
      ['cancelled', 'submitted'],
    ]

    for (const [from, to] of illegalTransitions) {
      expect(canTransition(from, to)).toBe(false)
      expect(() => assertTransition(from, to)).toThrow(CrudHttpError)
      try {
        assertTransition(from, to)
      } catch (error) {
        expect(error).toMatchObject({ status: 400 })
      }
    }
  })

  test('reports terminal statuses from empty next-status sets', () => {
    expect(isTerminal('closed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('resolved')).toBe(false)
    expect(nextStatuses('closed')).toEqual(['in_review'])
  })

  test('allows cancellation only before received', () => {
    const cancellable = new Set<WarrantyClaimStatus>(['draft', 'submitted', 'in_review', 'info_requested', 'approved', 'awaiting_return'])

    for (const status of allStatuses) {
      expect(canTransition(status, 'cancelled')).toBe(cancellable.has(status))
    }
  })

  test('requires all non-rejected active lines to be resolved before header resolution', () => {
    expect(canResolveWithLineStatuses([
      { lineStatus: 'resolved' },
      { lineStatus: 'rejected' },
      { lineStatus: 'approved', deletedAt: new Date() },
    ])).toBe(true)
    expect(canResolveWithLineStatuses([{ lineStatus: 'inspected' }])).toBe(false)
    expect(canResolveWithLineStatuses([{ line_status: 'pending' }])).toBe(false)
  })

  test('defines legal line-status moves', () => {
    const expected: Record<WarrantyClaimLineStatus, readonly WarrantyClaimLineStatus[]> = {
      pending: ['approved', 'rejected'],
      approved: ['received', 'resolved'],
      rejected: [],
      received: ['inspected'],
      inspected: ['resolved'],
      resolved: [],
    }
    expect(lineStatusGuards).toEqual(expected)
  })

  test('computes claimed and approved header rollups from non-deleted lines', () => {
    expect(computeHeaderRollups([
      { lineStatus: 'pending', credit_amount: '10' },
      { lineStatus: 'approved', credit_amount: '20', restocking_fee: '5', core_credit_amount: '2' },
      { lineStatus: 'resolved', creditAmount: 30, restockingFee: 1, coreCreditAmount: 4 },
      { lineStatus: 'rejected', credit_amount: '100' },
      { lineStatus: 'received', credit_amount: '500', deleted_at: new Date() },
    ])).toEqual({
      totalClaimedAmount: 160,
      totalApprovedAmount: 50,
    })
  })

  test('clamps negative approved line contributions and rounds float artifacts', () => {
    expect(computeHeaderRollups([
      { lineStatus: 'approved', credit_amount: '5', restocking_fee: '8' },
      { lineStatus: 'approved', credit_amount: '0.1' },
      { lineStatus: 'approved', credit_amount: '0.2' },
    ])).toEqual({
      totalClaimedAmount: 5.3,
      totalApprovedAmount: 0.3,
    })
  })
})
