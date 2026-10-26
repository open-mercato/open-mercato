import { inspectRecentJobs, redactJobPayload } from '../lib/queue-job-inspector'
import * as registry from '../lib/queue-status-registry'

jest.mock('../lib/queue-status-registry')

const mockResolveStatusQueue = registry.resolveStatusQueue as jest.Mock

function makeAudit() {
  return { log: jest.fn(async () => undefined) }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('redactJobPayload', () => {
  it('redacts known-sensitive keys at any depth, leaves ordinary fields visible', () => {
    const result = redactJobPayload({
      email: 'alice@example.com',
      password: 'super-secret',
      nested: { apiKey: 'abc123', note: 'fine' },
      items: [{ token: 'xyz' }, { ok: true }],
    })

    expect(result).toEqual({
      email: 'alice@example.com',
      password: '«redacted»',
      nested: { apiKey: '«redacted»', note: 'fine' },
      items: [{ token: '«redacted»' }, { ok: true }],
    })
  })

  it('handles non-object payloads without throwing', () => {
    expect(redactJobPayload('a string')).toBe('a string')
    expect(redactJobPayload(42)).toBe(42)
    expect(redactJobPayload(null)).toBeNull()
  })
})

describe('inspectRecentJobs — tenant isolation (#3105 R1, critical)', () => {
  const tenantAJob = { id: 'job-a', queue: 'q', data: { tenantId: 'tenant-a', secret: 'a-secret' }, timestamp: 2000 }
  const tenantBJob = { id: 'job-b', queue: 'q', data: { tenantId: 'tenant-b', secret: 'b-secret' }, timestamp: 3000 }
  const noTenantJob = { id: 'job-none', queue: 'q', data: { secret: 'no-tenant' }, timestamp: 1000 }

  function queueWith(jobs: unknown[], overrides: Record<string, unknown> = {}) {
    return {
      name: 'q',
      strategy: 'async',
      getJobCounts: jest.fn(),
      getRecentJobs: jest.fn(async () => jobs),
      ...overrides,
    }
  }

  it('a tenant-A actor sees ZERO tenant-B jobs from a shared queue, even when tenant-B is newest', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([tenantBJob, tenantAJob]))
    const audit = makeAudit()

    const result = await inspectRecentJobs({
      queue: 'q',
      limit: 20,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit,
    })

    expect(result.jobs.map((j) => j.id)).toEqual(['job-a'])
    expect(result.crossTenant).toBe(false)
    expect(audit.log).toHaveBeenCalledTimes(1)
  })

  it('a job with no determinable tenant is withheld from a non-superadmin (fail closed)', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([noTenantJob, tenantAJob]))

    const result = await inspectRecentJobs({
      queue: 'q',
      limit: 20,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit: makeAudit(),
    })

    expect(result.jobs.map((j) => j.id)).toEqual(['job-a'])
  })

  it('a superadmin sees jobs across tenants, each tagged with its own tenant', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([tenantBJob, tenantAJob]))

    const result = await inspectRecentJobs({
      queue: 'q',
      limit: 20,
      actor: { actorUserId: 'root', tenantId: null, isSuperAdmin: true },
      audit: makeAudit(),
    })

    expect(result.crossTenant).toBe(true)
    expect(result.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'job-a', tenantId: 'tenant-a' }),
        expect.objectContaining({ id: 'job-b', tenantId: 'tenant-b' }),
      ]),
    )
  })

  it('applies the limit AFTER the tenant filter, not before', async () => {
    const manyTenantB = Array.from({ length: 10 }, (_, i) => ({ id: `b-${i}`, queue: 'q', data: { tenantId: 'tenant-b' } }))
    mockResolveStatusQueue.mockReturnValue(queueWith([...manyTenantB, tenantAJob]))

    const result = await inspectRecentJobs({
      queue: 'q',
      limit: 5,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit: makeAudit(),
    })

    // Even though tenant-B jobs fill the bounded raw window, the tenant-A actor's own
    // job still surfaces — the limit is applied to the FILTERED set, not the raw one.
    expect(result.jobs.map((j) => j.id)).toEqual(['job-a'])
  })

  it('the single-id click-through path returns an empty result for a foreign-tenant id requested by a non-superadmin (fail-closed)', async () => {
    const getRecentJobs = jest.fn(async (opts: { id?: string }) => (opts.id === 'job-b' ? [tenantBJob] : []))
    mockResolveStatusQueue.mockReturnValue(queueWith([], { getRecentJobs }))

    const result = await inspectRecentJobs({
      queue: 'q',
      id: 'job-b',
      limit: 1,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit: makeAudit(),
    })

    expect(result.jobs).toEqual([])
    expect(getRecentJobs).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-b', limit: 1 }))
  })

  it('the single-id click-through path resolves an own-tenant id for a non-superadmin', async () => {
    const getRecentJobs = jest.fn(async () => [tenantAJob])
    mockResolveStatusQueue.mockReturnValue(queueWith([], { getRecentJobs }))

    const result = await inspectRecentJobs({
      queue: 'q',
      id: 'job-a',
      limit: 1,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit: makeAudit(),
    })

    expect(result.jobs.map((j) => j.id)).toEqual(['job-a'])
  })

  it('redacts sensitive payload fields so no un-redacted sensitive field leaves the server', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([tenantAJob]))

    const result = await inspectRecentJobs({
      queue: 'q',
      limit: 20,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit: makeAudit(),
    })

    expect(JSON.stringify(result)).not.toContain('a-secret')
  })

  it('writes an audit record for every call, including a zero-result call', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([tenantBJob]))
    const audit = makeAudit()

    await inspectRecentJobs({
      queue: 'q',
      limit: 20,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit,
    })

    expect(audit.log).toHaveBeenCalledTimes(1)
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'queue.job',
      resourceId: 'q',
      accessType: 'configs.queues_status.inspect_payloads',
      actorUserId: 'user-a',
      tenantId: 'tenant-a',
    }))
  })

  it('returns empty jobs when the strategy does not implement getRecentJobs', async () => {
    mockResolveStatusQueue.mockReturnValue({ name: 'q', strategy: 'local', getJobCounts: jest.fn() })

    const result = await inspectRecentJobs({
      queue: 'q',
      limit: 20,
      actor: { actorUserId: 'user-a', tenantId: 'tenant-a', isSuperAdmin: false },
      audit: makeAudit(),
    })

    expect(result.jobs).toEqual([])
  })
})

describe('inspectRecentJobs — producer envelopes, redaction and audit scope (#3105)', () => {
  function queueWith(jobs: unknown[], overrides: Record<string, unknown> = {}) {
    return { name: 'q', strategy: 'async', getJobCounts: jest.fn(), getRecentJobs: jest.fn(async () => jobs), ...overrides }
  }
  const tenantAdmin = { actorUserId: 'user-a', tenantId: 'tenant-a', organizationId: 'org-1', isSuperAdmin: false }

  // The real communication_channels inbound producer shape: tenant lives under `scope`.
  const inboundJob = {
    id: 'inbound-1',
    queue: 'communication-channels-inbound',
    state: 'waiting',
    data: {
      providerKey: 'imap',
      channelId: 'c1',
      channelType: 'email',
      raw: { body: 'hello', apiKey: 'k' },
      scope: { tenantId: 'tenant-a', organizationId: 'org-1' },
    },
  }

  it('normalizes the nested scope envelope: an own-tenant communication_channels job is visible to its tenant admin', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([inboundJob]))

    const result = await inspectRecentJobs({ queue: 'q', limit: 20, actor: tenantAdmin, audit: makeAudit() })

    expect(result.jobs).toEqual([
      expect.objectContaining({ id: 'inbound-1', tenantId: 'tenant-a', organizationId: 'org-1' }),
    ])
  })

  it('hides a nested-scope job of another tenant, and labels the tenant for a superadmin instead of "unknown"', async () => {
    const foreign = { ...inboundJob, id: 'inbound-2', data: { ...inboundJob.data, scope: { tenantId: 'tenant-b', organizationId: null } } }
    mockResolveStatusQueue.mockReturnValue(queueWith([inboundJob, foreign]))

    const own = await inspectRecentJobs({ queue: 'q', limit: 20, actor: tenantAdmin, audit: makeAudit() })
    const root = await inspectRecentJobs({
      queue: 'q', limit: 20, actor: { actorUserId: 'root', tenantId: null, isSuperAdmin: true }, audit: makeAudit(),
    })

    expect(own.jobs.map((job) => job.id)).toEqual(['inbound-1'])
    expect(root.jobs.map((job) => [job.id, job.tenantId])).toEqual([['inbound-1', 'tenant-a'], ['inbound-2', 'tenant-b']])
  })

  it('treats conflicting top-level and nested tenants as unowned — a payload cannot pick who sees it', async () => {
    const conflicting = {
      id: 'conflict',
      queue: 'q',
      data: { tenantId: 'tenant-a', scope: { tenantId: 'tenant-b' }, note: 'x' },
    }
    mockResolveStatusQueue.mockReturnValue(queueWith([conflicting]))

    const asA = await inspectRecentJobs({ queue: 'q', limit: 20, actor: tenantAdmin, audit: makeAudit() })
    const asB = await inspectRecentJobs({
      queue: 'q', limit: 20, actor: { ...tenantAdmin, tenantId: 'tenant-b' }, audit: makeAudit(),
    })
    const root = await inspectRecentJobs({
      queue: 'q', limit: 20, actor: { actorUserId: 'root', tenantId: null, isSuperAdmin: true }, audit: makeAudit(),
    })

    expect(asA.jobs).toEqual([])
    expect(asB.jobs).toEqual([])
    expect(root.jobs[0].tenantId).toBeNull()
  })

  it('accepts a top-level tenant that agrees with the nested scope', async () => {
    const agreeing = { id: 'ok', queue: 'q', data: { tenantId: 'tenant-a', scope: { tenantId: 'tenant-a' } } }
    mockResolveStatusQueue.mockReturnValue(queueWith([agreeing]))

    const result = await inspectRecentJobs({ queue: 'q', limit: 20, actor: tenantAdmin, audit: makeAudit() })

    expect(result.jobs.map((job) => job.id)).toEqual(['ok'])
  })

  it('redacts credentials out of the raw failure text before it leaves the server', async () => {
    const failed = {
      id: 'f1',
      queue: 'q',
      state: 'failed',
      failedReason: 'connect postgres://user:hunter2@db.internal/app failed; password=hunter2 Bearer abcdefghijkl',
      data: { tenantId: 'tenant-a' },
    }
    mockResolveStatusQueue.mockReturnValue(queueWith([failed]))

    const result = await inspectRecentJobs({ queue: 'q', limit: 20, actor: tenantAdmin, audit: makeAudit() })

    expect(result.jobs[0].failedReason).toBeDefined()
    expect(result.jobs[0].failedReason).not.toContain('hunter2')
    expect(result.jobs[0].failedReason).not.toContain('abcdefghijkl')
  })

  it('does not pass a caller state through on a direct-id read, so the queue resolves the actual state', async () => {
    const getRecentJobs = jest.fn(async () => [{ id: 'j', queue: 'q', state: 'failed', data: { tenantId: 'tenant-a' } }])
    mockResolveStatusQueue.mockReturnValue(queueWith([], { getRecentJobs }))

    const result = await inspectRecentJobs({ queue: 'q', id: 'j', state: 'waiting', limit: 1, actor: tenantAdmin, audit: makeAudit() })

    expect(getRecentJobs).toHaveBeenCalledWith({ id: 'j', limit: 1 })
    expect(result.jobs[0].state).toBe('failed')
  })

  it('records the actor organization on the access-log row so it stays visible under an org filter', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([]))
    const audit = makeAudit()

    await inspectRecentJobs({ queue: 'q', limit: 20, actor: tenantAdmin, audit })

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', organizationId: 'org-1' }))
  })

  it('fails closed when the access-log write fails: nothing is returned', async () => {
    mockResolveStatusQueue.mockReturnValue(queueWith([inboundJob]))
    const audit = { log: jest.fn(async () => { throw new Error('db down') }) }

    await expect(
      inspectRecentJobs({ queue: 'q', limit: 20, actor: tenantAdmin, audit }),
    ).rejects.toThrow('db down')
  })
})
