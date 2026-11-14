import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'
import { resolveImpliedCaptureStatus } from '../status-machine'

describe('resolveImpliedCaptureStatus', () => {
  it.each<[UnifiedPaymentStatus, UnifiedPaymentStatus]>([
    ['pending', 'refunded'],
    ['pending', 'partially_refunded'],
    ['authorized', 'refunded'],
    ['authorized', 'partially_refunded'],
  ])('bridges %s to %s through captured', (from, to) => {
    expect(resolveImpliedCaptureStatus(from, to)).toBe('captured')
  })

  it.each<[UnifiedPaymentStatus, UnifiedPaymentStatus]>([
    ['captured', 'refunded'],
    ['partially_captured', 'partially_refunded'],
    ['partially_refunded', 'refunded'],
    ['refunded', 'partially_refunded'],
    ['cancelled', 'refunded'],
    ['failed', 'refunded'],
    ['expired', 'partially_refunded'],
    ['pending', 'captured'],
    ['authorized', 'cancelled'],
    ['pending', 'unknown'],
  ])('does not bridge %s to %s', (from, to) => {
    expect(resolveImpliedCaptureStatus(from, to)).toBeNull()
  })
})
