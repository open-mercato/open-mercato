const mockFindWithDecryption = jest.fn()
const mockRegister = jest.fn<Promise<void>, [Record<string, unknown>]>(async () => undefined)
let mockSchedulerRegistered = true

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return { fork: () => ({ forked: true }) }
      if (key === 'schedulerService') return { register: mockRegister }
      return undefined
    },
    hasRegistration: (key: string) => key === 'schedulerService' && mockSchedulerRegistered,
  })),
}))

import cliCommands from '../cli'
import { AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE } from '../lib/queue'
import { stableScheduleUuid } from '../lib/trace/contentRetentionSchedule'

function scheduleCommand() {
  const command = cliCommands.find((entry) => entry.command === 'trace-retention:schedule')
  if (!command) throw new Error('[test] trace-retention:schedule command missing')
  return command
}

describe('trace-retention:schedule CLI', () => {
  let log: jest.SpyInstance
  let error: jest.SpyInstance

  beforeEach(() => {
    mockFindWithDecryption.mockReset()
    mockRegister.mockReset()
    mockRegister.mockResolvedValue(undefined)
    mockSchedulerRegistered = true
    process.exitCode = undefined
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    log.mockRestore()
    error.mockRestore()
    process.exitCode = undefined
  })

  it('registers the per-organization schedule that setup registers, for every selected organization', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: 'org-A', tenant: { id: 'tenant-A' } },
      { id: 'org-B', tenant: { id: 'tenant-B' } },
    ])

    await scheduleCommand().run([])

    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual({ deletedAt: null })
    expect(mockRegister).toHaveBeenCalledTimes(2)
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        id: stableScheduleUuid('agent_orchestrator:trace-content-retention:org-A'),
        scopeType: 'organization',
        tenantId: 'tenant-A',
        organizationId: 'org-A',
        scheduleType: 'interval',
        scheduleValue: '86400s',
        targetType: 'queue',
        targetQueue: AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE,
        targetPayload: { scope: { tenantId: 'tenant-A', organizationId: 'org-A' } },
        sourceType: 'module',
        sourceModule: 'agent_orchestrator',
      }),
    )
    expect(mockRegister.mock.calls[1][0]).toMatchObject({
      tenantId: 'tenant-B',
      organizationId: 'org-B',
      targetPayload: { scope: { tenantId: 'tenant-B', organizationId: 'org-B' } },
    })
    expect(log.mock.calls.map((call) => call[0])).toContain('Done. 2 organization(s): 2 registered, 0 failed.')
    expect(process.exitCode).toBeUndefined()
  })

  it('narrows the organizations with --tenant and --org', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([{ id: 'org-A', tenant: { id: 'tenant-A' } }])

    await scheduleCommand().run(['--tenant', 'tenant-A', '--org', 'org-A'])

    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual({ deletedAt: null, tenant: 'tenant-A', id: 'org-A' })
    expect(mockRegister).toHaveBeenCalledTimes(1)
  })

  it('keeps registering after one organization fails and exits non-zero', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: 'org-A', tenant: { id: 'tenant-A' } },
      { id: 'org-B', tenant: { id: 'tenant-B' } },
    ])
    mockRegister.mockRejectedValueOnce(new Error('boom'))

    await scheduleCommand().run([])

    expect(mockRegister).toHaveBeenCalledTimes(2)
    expect(log.mock.calls.map((call) => call[0])).toContain('Done. 2 organization(s): 1 registered, 1 failed.')
    expect(process.exitCode).toBe(1)
  })

  it('exits non-zero without registering when no organization matches or the scheduler is absent', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    await scheduleCommand().run(['--tenant', 'missing'])
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    mockSchedulerRegistered = false
    mockFindWithDecryption.mockResolvedValueOnce([{ id: 'org-A', tenant: { id: 'tenant-A' } }])
    await scheduleCommand().run([])
    expect(process.exitCode).toBe(1)
    expect(mockRegister).not.toHaveBeenCalled()
  })
})
