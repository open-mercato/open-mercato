/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  FAILURE_GROUP_LABEL_MAX,
  groupFailures,
  matchesFailureGroup,
  normalizeFailureMessage,
  resolveFailureMessage,
  type TriageInstanceInput,
} from '../failure-grouping'

function instance(overrides: Partial<TriageInstanceInput> & { id: string }): TriageInstanceInput {
  return { workflowId: 'checkout', status: 'FAILED', ...overrides }
}

describe('normalizeFailureMessage', () => {
  test('collapses per-instance identifiers so the shape survives', () => {
    const left = normalizeFailureMessage(
      'Order 11111111-1111-4111-8111-111111111111 not found'
    )
    const right = normalizeFailureMessage(
      'Order 22222222-2222-4222-8222-222222222222 not found'
    )
    expect(left).toBe(right)
    expect(left).toBe('Order {id} not found')
  })

  test('collapses numbers, quoted values, timestamps and hex blobs', () => {
    expect(normalizeFailureMessage('Retry 3 of 5 failed')).toBe('Retry {n} of {n} failed')
    expect(normalizeFailureMessage('Field "email" is required')).toBe('Field {value} is required')
    expect(normalizeFailureMessage("Field 'email' is required")).toBe('Field {value} is required')
    expect(normalizeFailureMessage('Expired at 2026-07-29T10:00:00.000Z')).toBe('Expired at {time}')
    expect(normalizeFailureMessage('Bad token deadbeefcafe1234')).toBe('Bad token {hex}')
  })

  test('collapses whitespace and trims', () => {
    expect(normalizeFailureMessage('  Timed   out\n while waiting ')).toBe('Timed out while waiting')
  })

  test('keeps genuinely different failures apart', () => {
    // Over-normalizing is worse than under-normalizing: a merged group hides
    // that half of it will fail again on replay.
    expect(normalizeFailureMessage('Payment gateway timeout')).not.toBe(
      normalizeFailureMessage('Inventory reservation failed')
    )
  })
})

describe('resolveFailureMessage', () => {
  test('prefers the error message', () => {
    expect(
      resolveFailureMessage(instance({ id: 'a', errorMessage: 'boom', attentionReason: 'parked' }))
    ).toBe('boom')
  })

  test('falls back to the park reason so parked runs are not one meaningless bucket', () => {
    expect(
      resolveFailureMessage(instance({ id: 'a', status: 'PAUSED', errorMessage: null, attentionReason: 'failureQueue: charge' }))
    ).toBe('failureQueue: charge')
  })

  test('returns null when neither is recorded', () => {
    expect(resolveFailureMessage(instance({ id: 'a', errorMessage: '   ' }))).toBeNull()
  })
})

describe('groupFailures', () => {
  test('collapses a batch of the same failure into one row', () => {
    const groups = groupFailures([
      instance({ id: 'a', errorMessage: 'Order 11111111-1111-4111-8111-111111111111 not found' }),
      instance({ id: 'b', errorMessage: 'Order 22222222-2222-4222-8222-222222222222 not found' }),
      instance({ id: 'c', errorMessage: 'Order 33333333-3333-4333-8333-333333333333 not found' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].instanceIds).toEqual(['a', 'b', 'c'])
  })

  test('keeps the first RAW message as the human label, not the normalized shape', () => {
    const groups = groupFailures([
      instance({ id: 'a', errorMessage: 'Order 11111111-1111-4111-8111-111111111111 not found' }),
    ])
    expect(groups[0].label).toBe('Order 11111111-1111-4111-8111-111111111111 not found')
    expect(groups[0].key).toBe('Order {id} not found')
  })

  test('orders the biggest group first and breaks ties deterministically', () => {
    const groups = groupFailures([
      instance({ id: 'a', errorMessage: 'Zebra failed' }),
      instance({ id: 'b', errorMessage: 'Alpha failed' }),
      instance({ id: 'c', errorMessage: 'Beta failed' }),
      instance({ id: 'd', errorMessage: 'Beta failed' }),
    ])

    expect(groups.map((group) => group.count)).toEqual([2, 1, 1])
    expect(groups[0].label).toBe('Beta failed')
    // Ties resolve on the key so two requests never disagree about the order.
    expect(groups[1].label).toBe('Alpha failed')
    expect(groups[2].label).toBe('Zebra failed')
  })

  test('records every distinct workflow so a cross-workflow failure is visible', () => {
    const groups = groupFailures([
      instance({ id: 'a', workflowId: 'checkout', errorMessage: 'Gateway timeout' }),
      instance({ id: 'b', workflowId: 'refund', errorMessage: 'Gateway timeout' }),
      instance({ id: 'c', workflowId: 'refund', errorMessage: 'Gateway timeout' }),
    ])

    expect(groups[0].workflowIds).toEqual(['checkout', 'refund'])
  })

  test('buckets instances with no message under an explicit unclassified group', () => {
    const groups = groupFailures([
      instance({ id: 'a', errorMessage: null, attentionReason: null }),
      instance({ id: 'b', errorMessage: null, attentionReason: null }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('unclassified')
    expect(groups[0].label).toBe('No error message recorded')
  })

  test('truncates a long label but never the key', () => {
    const long = `Failure ${'x'.repeat(400)}`
    const groups = groupFailures([instance({ id: 'a', errorMessage: long })])
    expect(groups[0].label.length).toBe(FAILURE_GROUP_LABEL_MAX)
    expect(groups[0].label.endsWith('…')).toBe(true)
    expect(groups[0].key.length).toBeGreaterThan(FAILURE_GROUP_LABEL_MAX)
  })

  test('an empty triage set groups to nothing', () => {
    expect(groupFailures([])).toEqual([])
  })
})

describe('matchesFailureGroup', () => {
  test('narrows the list to one root cause', () => {
    const target = instance({ id: 'a', errorMessage: 'Order 11111111-1111-4111-8111-111111111111 not found' })
    const other = instance({ id: 'b', errorMessage: 'Gateway timeout' })

    expect(matchesFailureGroup(target, 'Order {id} not found')).toBe(true)
    expect(matchesFailureGroup(other, 'Order {id} not found')).toBe(false)
  })

  test('matches the unclassified bucket', () => {
    expect(matchesFailureGroup(instance({ id: 'a', errorMessage: null }), 'unclassified')).toBe(true)
  })
})
