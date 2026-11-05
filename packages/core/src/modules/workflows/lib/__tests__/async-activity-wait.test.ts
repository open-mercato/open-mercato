import { describe, test, expect } from '@jest/globals'
import { readPendingAsyncJobIds, resolveAsyncActivityWait } from '../async-activity-wait'

const completed = (jobId: string, extra: Record<string, unknown> = {}) => ({
  eventType: 'ACTIVITY_COMPLETED',
  eventData: { async: true, jobId, ...extra },
})
const failed = (jobId: string, extra: Record<string, unknown> = {}) => ({
  eventType: 'ACTIVITY_FAILED',
  eventData: { async: true, jobId, ...extra },
})

describe('readPendingAsyncJobIds', () => {
  test('reads the job ids a transition recorded, once each', () => {
    expect(
      readPendingAsyncJobIds([
        { activityId: 'a', jobId: 'job-1' },
        { activityId: 'b', jobId: 'job-2' },
        { activityId: 'a', jobId: 'job-1' },
      ])
    ).toEqual(['job-1', 'job-2'])
  })

  test('ignores missing or malformed entries', () => {
    expect(readPendingAsyncJobIds(undefined)).toEqual([])
    expect(readPendingAsyncJobIds({ jobId: 'job-1' })).toEqual([])
    expect(readPendingAsyncJobIds([null, { activityId: 'a' }, { jobId: '' }, { jobId: 7 }])).toEqual([])
  })
})

describe('resolveAsyncActivityWait', () => {
  test('settles only when every pending job has an outcome', () => {
    const pending = ['job-1', 'job-2']
    expect(resolveAsyncActivityWait(pending, [completed('job-1')]).settled).toBe(false)
    const resolution = resolveAsyncActivityWait(pending, [completed('job-1'), failed('job-2')])
    expect(resolution.settled).toBe(true)
    expect(resolution.completed.map((event) => event.eventData.jobId)).toEqual(['job-1'])
    expect(resolution.failed.map((event) => event.eventData.jobId)).toEqual(['job-2'])
  })

  test('ignores outcomes of jobs the wait did not queue', () => {
    const resolution = resolveAsyncActivityWait(['job-new'], [failed('job-old'), completed('job-other')])
    expect(resolution).toEqual({ settled: false, completed: [], failed: [] })
  })

  test('counts a duplicate delivery of the same job once', () => {
    const resolution = resolveAsyncActivityWait(['job-1', 'job-2'], [completed('job-1'), completed('job-1')])
    expect(resolution.settled).toBe(false)
    expect(resolution.completed).toHaveLength(1)
  })

  test('lets a completed attempt win over earlier failed attempts of the same job', () => {
    const resolution = resolveAsyncActivityWait(
      ['job-1'],
      [failed('job-1', { attemptNumber: 1 }), completed('job-1', { attemptNumber: 2 })]
    )
    expect(resolution.settled).toBe(true)
    expect(resolution.failed).toEqual([])
    expect(resolution.completed[0].eventData.attemptNumber).toBe(2)
  })

  test('uses the latest event when a job logged the same outcome twice', () => {
    const resolution = resolveAsyncActivityWait(
      ['job-1'],
      [completed('job-1', { output: 'first' }), completed('job-1', { output: 'second' })]
    )
    expect(resolution.completed[0].eventData.output).toBe('second')
  })

  test('settles an empty wait immediately', () => {
    expect(resolveAsyncActivityWait([], [failed('job-old')])).toEqual({ settled: true, completed: [], failed: [] })
  })
})
