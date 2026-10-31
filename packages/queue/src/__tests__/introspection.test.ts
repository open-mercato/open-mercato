import {
  buildCompletedRetentionEnvelope,
  classifyFailureReason,
  resolveJobType,
  resolveOffset,
  resolveWindowSize,
} from '../introspection'

describe('queue introspection helpers (#3105)', () => {
  it('classifies failure text into stable codes without echoing it', () => {
    expect(classifyFailureReason(undefined)).toBeUndefined()
    expect(classifyFailureReason('')).toBeUndefined()
    expect(classifyFailureReason('job stalled more than allowable limit')).toBe('queue.job_stalled')
    expect(classifyFailureReason('job started more than allowable limit')).toBe('queue.job_start_limit')
    expect(classifyFailureReason('Request timed out after 30s')).toBe('queue.timeout')
    expect(classifyFailureReason('connect ECONNREFUSED 10.0.0.1:5432')).toBe('queue.connection_error')
    expect(classifyFailureReason('duplicate key for tenant acme password=hunter2')).toBe('queue.handler_error')
  })

  it('resolves windows: default for missing, empty for zero/negative, capped above the max', () => {
    expect(resolveWindowSize(undefined, 20, 50)).toBe(20)
    expect(resolveWindowSize(Number.NaN, 20, 50)).toBe(20)
    expect(resolveWindowSize(0, 20, 50)).toBe(0)
    expect(resolveWindowSize(-3, 20, 50)).toBe(0)
    expect(resolveWindowSize(999, 20, 50)).toBe(50)
    expect(resolveOffset(-1)).toBe(0)
    expect(resolveOffset(2.9)).toBe(2)
    expect(resolveOffset(1e9)).toBe(1000)
  })

  it('reads the job type from envelope metadata first, then payload.jobType, never from anything else', () => {
    expect(resolveJobType({ payload: { jobType: 'a' }, metadata: { jobType: 'b' } })).toBe('b')
    expect(resolveJobType({ payload: { jobType: 'a' } })).toBe('a')
    expect(resolveJobType({ payload: { jobType: 42 } })).toBeUndefined()
    expect(resolveJobType({ payload: { jobType: 'x'.repeat(500) } })).toBeUndefined()
    expect(resolveJobType(undefined)).toBeUndefined()
  })

  it('keeps only ownership and type on a retained completed envelope', () => {
    const envelope = {
      id: 'j1',
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: { jobType: 'index' },
      payload: { tenantId: 't', organizationId: null, secret: 's', scope: { tenantId: 't', organizationId: 'o', raw: 'body' } },
    }

    expect(buildCompletedRetentionEnvelope(envelope).payload).toEqual({
      tenantId: 't',
      organizationId: null,
      jobType: 'index',
      scope: { tenantId: 't', organizationId: 'o' },
    })
  })
})
