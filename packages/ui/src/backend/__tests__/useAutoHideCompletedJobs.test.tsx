/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { renderHook, act } from '@testing-library/react'
import { useAutoHideCompletedJobs } from '../progress/useAutoHideCompletedJobs'
import type { ProgressJobDto } from '../progress/useProgressPoll'

function makeJob(overrides: Partial<ProgressJobDto> = {}): ProgressJobDto {
  return {
    id: 'job-1',
    jobType: 'bulk-delete',
    name: 'Delete selected',
    status: 'completed',
    progressPercent: 100,
    processedCount: 5,
    cancellable: false,
    finishedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('useAutoHideCompletedJobs', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('hides a completed job after the timeout elapses', () => {
    const jobs = [makeJob({ id: 'j1', finishedAt: new Date().toISOString() })]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 10_000))

    expect(result.current).toHaveLength(1)

    act(() => { jest.advanceTimersByTime(10_000) })

    expect(result.current).toHaveLength(0)
  })

  it('keeps failed jobs visible after the timeout', () => {
    const jobs = [
      makeJob({ id: 'j-ok', status: 'completed', finishedAt: new Date().toISOString() }),
      makeJob({ id: 'j-fail', status: 'failed', finishedAt: new Date().toISOString() }),
    ]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 10_000))

    act(() => { jest.advanceTimersByTime(10_000) })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('j-fail')
  })

  it('keeps cancelled jobs visible after the timeout', () => {
    const jobs = [
      makeJob({ id: 'j-cancel', status: 'cancelled', finishedAt: new Date().toISOString() }),
    ]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 10_000))

    act(() => { jest.advanceTimersByTime(10_000) })

    expect(result.current).toHaveLength(1)
  })

  it('hides each job based on its own finishedAt (no false-positive cascade)', () => {
    const now = Date.now()
    const jobs = [
      makeJob({ id: 'j-early', finishedAt: new Date(now - 8_000).toISOString() }), // finished 8s ago
      makeJob({ id: 'j-late', finishedAt: new Date(now).toISOString() }),           // just finished
    ]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 10_000))

    // After 2s more, the early job (8s+2s=10s) should expire
    act(() => { jest.advanceTimersByTime(2_000) })
    expect(result.current.map((j) => j.id)).toEqual(['j-late'])

    // After another 8s, the late job expires too
    act(() => { jest.advanceTimersByTime(8_000) })
    expect(result.current).toHaveLength(0)
  })

  it('immediately hides completed jobs whose finishedAt is already past the timeout', () => {
    const pastFinishedAt = new Date(Date.now() - 15_000).toISOString() // finished 15s ago
    const jobs = [makeJob({ id: 'j-old', finishedAt: pastFinishedAt })]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 10_000))

    // No timer needed — should already be filtered out
    expect(result.current).toHaveLength(0)
  })

  it('does not hide when timeoutMs is false', () => {
    const jobs = [makeJob({ id: 'j1' })]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, false))

    act(() => { jest.advanceTimersByTime(60_000) })

    expect(result.current).toHaveLength(1)
  })

  it('does not hide when timeoutMs is 0', () => {
    const jobs = [makeJob({ id: 'j1' })]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 0))

    act(() => { jest.advanceTimersByTime(60_000) })

    expect(result.current).toHaveLength(1)
  })

  it('respects a custom timeout', () => {
    const jobs = [makeJob({ id: 'j1', finishedAt: new Date().toISOString() })]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 3_000))

    act(() => { jest.advanceTimersByTime(2_999) })
    expect(result.current).toHaveLength(1)

    act(() => { jest.advanceTimersByTime(1) })
    expect(result.current).toHaveLength(0)
  })

  it('does not re-schedule a timer when jobs list updates with the same completed job', () => {
    const job = makeJob({ id: 'j1', finishedAt: new Date().toISOString() })
    const { result, rerender } = renderHook(
      ({ jobs }: { jobs: ProgressJobDto[] }) => useAutoHideCompletedJobs(jobs, 10_000),
      { initialProps: { jobs: [job] } },
    )

    act(() => { jest.advanceTimersByTime(5_000) })
    // Simulate poll refresh — same job still in list
    rerender({ jobs: [job] })

    // Timer should expire at original 10s mark, not reset to 15s
    act(() => { jest.advanceTimersByTime(5_000) })
    expect(result.current).toHaveLength(0)
  })

  it('clears timers on unmount without errors', () => {
    const jobs = [makeJob({ id: 'j1', finishedAt: new Date().toISOString() })]
    const { unmount } = renderHook(() => useAutoHideCompletedJobs(jobs, 10_000))

    expect(() => {
      unmount()
      jest.advanceTimersByTime(15_000)
    }).not.toThrow()
  })

  it('treats a malformed finishedAt as "just finished" — does not error and hides after full timeout', () => {
    const jobs = [makeJob({ id: 'j-bad', finishedAt: 'not-a-date' })]
    const { result } = renderHook(() => useAutoHideCompletedJobs(jobs, 10_000))

    // Should be visible initially (malformed → treated as now)
    expect(result.current).toHaveLength(1)

    act(() => { jest.advanceTimersByTime(10_000) })

    expect(result.current).toHaveLength(0)
  })

  it('stays hidden when list cycles through empty — does not restart timer', () => {
    const job = makeJob({ id: 'j1', finishedAt: new Date().toISOString() })
    const { result, rerender } = renderHook(
      ({ jobs }: { jobs: ProgressJobDto[] }) => useAutoHideCompletedJobs(jobs, 10_000),
      { initialProps: { jobs: [job] } },
    )

    // Advance past the timeout so job expires
    act(() => { jest.advanceTimersByTime(10_000) })
    expect(result.current).toHaveLength(0)

    // List goes empty then comes back with the same job
    rerender({ jobs: [] })
    rerender({ jobs: [job] })

    // Job should stay hidden — scheduledRef prevents re-scheduling
    expect(result.current).toHaveLength(0)
  })
})
