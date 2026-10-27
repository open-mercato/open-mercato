import { buildQueueTargetPayload, buildSchedulerIdempotencyKey } from '../queueTargetPayload'

describe('buildQueueTargetPayload', () => {
  it('spreads targetPayload fields onto the payload root', () => {
    const payload = buildQueueTargetPayload({
      targetPayload: { connectionId: 'connection-id', scope: 'organization' },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      idempotencyKey: 'scheduler-s1-key',
    })
    expect(payload).toEqual({
      connectionId: 'connection-id',
      scope: 'organization',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      _idempotencyKey: 'scheduler-s1-key',
    })
  })

  it('lets scheduler-owned scope and idempotency fields win over colliding targetPayload fields', () => {
    const payload = buildQueueTargetPayload({
      targetPayload: {
        tenantId: 'spoofed-tenant',
        organizationId: 'spoofed-org',
        _idempotencyKey: 'spoofed-key',
      },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      idempotencyKey: 'scheduler-s1-key',
    })
    expect(payload.tenantId).toBe('tenant-1')
    expect(payload.organizationId).toBe('org-1')
    expect(payload._idempotencyKey).toBe('scheduler-s1-key')
  })

  it('handles empty and non-object targetPayload values', () => {
    for (const targetPayload of [null, undefined, {}, 'text', 42, ['array']]) {
      const payload = buildQueueTargetPayload({
        targetPayload,
        tenantId: null,
        organizationId: null,
        idempotencyKey: 'scheduler-s1-key',
      })
      expect(payload).toEqual({
        tenantId: null,
        organizationId: null,
        _idempotencyKey: 'scheduler-s1-key',
      })
    }
  })

  it('preserves a literal application field named payload on the root', () => {
    const payload = buildQueueTargetPayload({
      targetPayload: { payload: { nested: true }, other: 1 },
      tenantId: 'tenant-1',
      organizationId: null,
      idempotencyKey: 'scheduler-s1-key',
    })
    expect(payload.payload).toEqual({ nested: true })
    expect(payload.other).toBe(1)
  })

  it('does not mutate the configured targetPayload', () => {
    const configured = { connectionId: 'connection-id' }
    buildQueueTargetPayload({
      targetPayload: configured,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      idempotencyKey: 'scheduler-s1-key',
    })
    expect(configured).toEqual({ connectionId: 'connection-id' })
  })
})

describe('buildSchedulerIdempotencyKey', () => {
  it('is deterministic for one logical execution key', () => {
    expect(buildSchedulerIdempotencyKey('s1', 'job-1')).toBe('scheduler-s1-job-1')
    expect(buildSchedulerIdempotencyKey('s1', 'job-1')).toBe(buildSchedulerIdempotencyKey('s1', 'job-1'))
  })

  it('differs across schedules and executions', () => {
    expect(buildSchedulerIdempotencyKey('s1', 'job-1')).not.toBe(buildSchedulerIdempotencyKey('s2', 'job-1'))
    expect(buildSchedulerIdempotencyKey('s1', 'job-1')).not.toBe(buildSchedulerIdempotencyKey('s1', 'job-2'))
  })
})
