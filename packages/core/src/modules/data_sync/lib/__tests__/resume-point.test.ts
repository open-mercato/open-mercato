/** @jest-environment node */

import { isRetryableRunStatus, resolveResumePoint, type ResumePointRun } from '../resume-point'

function buildRun(overrides: Partial<ResumePointRun> = {}): ResumePointRun {
  return {
    status: 'failed',
    cursor: 'updated_at:2026-09-12T04:15:07Z',
    batchesCompleted: 41,
    ...overrides,
  }
}

describe('resolveResumePoint', () => {
  it('resolves a failed run with a committed cursor', () => {
    expect(resolveResumePoint(buildRun())).toEqual({
      kind: 'resumes',
      batchesCompleted: 41,
      cursor: 'updated_at:2026-09-12T04:15:07Z',
    })
  })

  it('resolves a cancelled run the same way — both states are retryable', () => {
    expect(resolveResumePoint(buildRun({ status: 'cancelled' }))).toEqual({
      kind: 'resumes',
      batchesCompleted: 41,
      cursor: 'updated_at:2026-09-12T04:15:07Z',
    })
  })

  it.each(['pending', 'running', 'completed', 'paused'])(
    'returns none for a %s run, which cannot be retried at all',
    (status) => {
      expect(resolveResumePoint(buildRun({ status }))).toEqual({ kind: 'none' })
    },
  )

  it('returns none for an unrecognised status rather than guessing', () => {
    expect(resolveResumePoint(buildRun({ status: 'something-new' }))).toEqual({ kind: 'none' })
  })

  it('reports a null cursor as noCommittedBatch', () => {
    expect(resolveResumePoint(buildRun({ cursor: null }))).toEqual({ kind: 'noCommittedBatch' })
  })

  it('treats an empty-string cursor as nothing committed', () => {
    expect(resolveResumePoint(buildRun({ cursor: '' }))).toEqual({ kind: 'noCommittedBatch' })
  })

  /**
   * The whole point of the `noCommittedBatch` kind: the retry endpoint falls
   * back to `resolveStartCursor(...)`, which reads the shared cursor row, so a
   * run row with no cursor of its own still cannot promise a run from scratch.
   */
  it('never reports a position for a run that committed no batch', () => {
    const point = resolveResumePoint(buildRun({ cursor: null, batchesCompleted: 0 }))
    expect(point).toEqual({ kind: 'noCommittedBatch' })
    expect(point).not.toHaveProperty('cursor')
    expect(point).not.toHaveProperty('batchesCompleted')
  })

  it('reports a zero batch count as-is when a cursor was committed', () => {
    expect(resolveResumePoint(buildRun({ batchesCompleted: 0 }))).toEqual({
      kind: 'resumes',
      batchesCompleted: 0,
      cursor: 'updated_at:2026-09-12T04:15:07Z',
    })
  })

  it('takes no batch-total argument — no batch denominator is derivable', () => {
    expect(resolveResumePoint.length).toBe(1)
  })
})

describe('isRetryableRunStatus', () => {
  it.each(['failed', 'cancelled'])('accepts %s', (status) => {
    expect(isRetryableRunStatus(status)).toBe(true)
  })

  it.each(['pending', 'running', 'completed', 'paused', 'nonsense'])('rejects %s', (status) => {
    expect(isRetryableRunStatus(status)).toBe(false)
  })

  // `status` arrives on an API payload, so an object-literal lookup would have
  // answered truthy here and offered Retry on a run in an unknown state.
  it.each(['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'])(
    'rejects the inherited property name %s',
    (status) => {
      expect(isRetryableRunStatus(status)).toBe(false)
      expect(resolveResumePoint(buildRun({ status }))).toEqual({ kind: 'none' })
    },
  )

  it('agrees with resolveResumePoint about which statuses qualify', () => {
    for (const status of ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused']) {
      const retryable = isRetryableRunStatus(status)
      const resolved = resolveResumePoint(buildRun({ status }))
      expect(resolved.kind === 'none').toBe(!retryable)
    }
  })
})
