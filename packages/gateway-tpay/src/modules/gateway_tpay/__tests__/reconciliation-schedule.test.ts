import { z } from 'zod'
const mockReportError = jest.fn()
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
const mockIsEnabled = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => mockLogger,
}))
jest.mock('@open-mercato/core/modules/integrations/lib/state-service', () => ({
  createIntegrationStateService: () => ({ isEnabled: mockIsEnabled }),
}))
jest.mock('@open-mercato/core/modules/integrations/lib/credentials-service', () => ({
  createCredentialsService: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/integrations/lib/log-service', () => ({
  createIntegrationLogService: jest.fn(),
}))
jest.mock('../lib/preset', () => ({
  applyTpayEnvPreset: jest.fn(),
}))

import {
  buildTpayReconciliationSchedule,
  syncTpayReconciliationSchedule,
  tpayReconciliationScheduleId,
} from '../lib/reconciliation-schedule'
import handler, { metadata as subscriberMetadata } from '../subscribers/integration-state-updated'
import { metadata as workerMetadata } from '../workers/status-poller'
import setup from '../setup'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'
const TENANT = '22222222-2222-4222-8222-222222222222'
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function buildContainer(register = jest.fn().mockResolvedValue(undefined), hasScheduler = true) {
  return {
    register,
    container: {
      hasRegistration: jest.fn((name: string) => hasScheduler && name === 'schedulerService'),
      resolve: jest.fn().mockReturnValue({ register }),
    },
  }
}

describe('gateway_tpay reconciliation schedule', () => {
  beforeEach(() => jest.clearAllMocks())

  it('derives a deterministic id that differs per scope', () => {
    const first = tpayReconciliationScheduleId({ tenantId: TENANT, organizationId: ORG })
    const second = tpayReconciliationScheduleId({ tenantId: TENANT, organizationId: ORG })
    const other = tpayReconciliationScheduleId({ tenantId: TENANT, organizationId: OTHER_ORG })
    expect(first).toMatch(UUID_SHAPE)
    expect(first).toBe(second)
    expect(other).not.toBe(first)
  })

  it('derives an RFC 4122 UUID accepted by the scheduler trigger API', () => {
    const id = tpayReconciliationScheduleId({ tenantId: TENANT, organizationId: ORG })
    expect(z.uuid().safeParse(id).success).toBe(true)
    expect(id[14]).toBe('5')
  })

  it('registers the exact module-owned schedule', async () => {
    const { register, container } = buildContainer()
    const scope = { tenantId: TENANT, organizationId: ORG }
    await expect(syncTpayReconciliationSchedule({ container, scope, enabled: true })).resolves.toBe(true)
    expect(register).toHaveBeenCalledWith({
      id: tpayReconciliationScheduleId(scope),
      name: 'Tpay payment status reconciliation',
      description: 'Poll Tpay for the status of pending payments that did not receive a notification.',
      scopeType: 'organization',
      tenantId: TENANT,
      organizationId: ORG,
      scheduleType: 'interval',
      scheduleValue: '5m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'gateway-tpay-status-poller',
      targetPayload: { limit: 100 },
      sourceType: 'module',
      sourceModule: 'gateway_tpay',
      isEnabled: true,
    })
  })

  it('registers a disabled schedule when the integration is disabled', async () => {
    const { register, container } = buildContainer()
    await syncTpayReconciliationSchedule({ container, scope: { tenantId: TENANT, organizationId: ORG }, enabled: false })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false, sourceType: 'module' }))
  })

  it('skips without throwing when the scheduler is not registered', async () => {
    const { register, container } = buildContainer(jest.fn(), false)
    const scope = { tenantId: TENANT, organizationId: ORG }
    await expect(syncTpayReconciliationSchedule({ container, scope, enabled: true })).resolves.toBe(false)
    await expect(syncTpayReconciliationSchedule({ container: undefined, scope, enabled: true })).resolves.toBe(false)
    const resolveOnly = { resolve: jest.fn(() => { throw new Error('not registered') }) }
    await expect(syncTpayReconciliationSchedule({ container: resolveOnly, scope, enabled: true })).resolves.toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('targets a worker owned by the schedule source module', () => {
    const registration = buildTpayReconciliationSchedule({ tenantId: TENANT, organizationId: ORG }, true)
    expect(workerMetadata.queue).toBe(registration.targetQueue)
    expect(workerMetadata.id?.split(':')[0]).toBe(registration.sourceModule)
  })
})

describe('gateway_tpay integration-state-updated subscriber', () => {
  beforeEach(() => jest.clearAllMocks())

  it('subscribes to integration state changes', () => {
    expect(subscriberMetadata).toEqual({
      event: 'integrations.state.updated',
      persistent: true,
      id: 'gateway_tpay:integration-state-updated',
    })
  })

  it('ignores other integrations', async () => {
    const { register, container } = buildContainer()
    await handler({ integrationId: 'gateway_stripe', isEnabled: true, tenantId: TENANT, organizationId: ORG }, container)
    expect(register).not.toHaveBeenCalled()
  })

  it.each([true, false])('syncs the schedule with isEnabled=%s', async (isEnabled) => {
    const { register, container } = buildContainer()
    await handler({ integrationId: 'gateway_tpay', isEnabled, tenantId: TENANT, organizationId: ORG }, container)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG, isEnabled }),
    )
  })

  it('prefers trusted scope from the subscriber context', async () => {
    const { register, container } = buildContainer()
    await handler(
      { integrationId: 'gateway_tpay', isEnabled: true, tenantId: TENANT, organizationId: ORG },
      { ...container, tenantId: TENANT, organizationId: OTHER_ORG },
    )
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ organizationId: OTHER_ORG }))
  })

  it('logs and reports registration failures, then rethrows so the persistent delivery is retried', async () => {
    const { container } = buildContainer(jest.fn().mockRejectedValue(new Error('boom')))
    expect(subscriberMetadata.persistent).toBe(true)
    await expect(
      handler({ integrationId: 'gateway_tpay', isEnabled: true, tenantId: TENANT, organizationId: ORG }, container),
    ).rejects.toThrow('boom')
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'gateway_tpay',
      code: 'gateway_tpay.reconciliation_schedule_failed',
    })
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})

describe('gateway_tpay setup seedDefaults', () => {
  beforeEach(() => jest.clearAllMocks())

  function runSeed(container: unknown) {
    return setup.seedDefaults?.({ em: {}, container, tenantId: TENANT, organizationId: ORG } as never)
  }

  it('registers the schedule when the integration is enabled', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const { register, container } = buildContainer()
    await runSeed(container)
    expect(mockIsEnabled).toHaveBeenCalledWith('gateway_tpay', { tenantId: TENANT, organizationId: ORG })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: true, organizationId: ORG }))
  })

  it('does not register when the integration is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const { register, container } = buildContainer()
    await runSeed(container)
    expect(register).not.toHaveBeenCalled()
  })

  it('never throws out of tenant setup', async () => {
    mockIsEnabled.mockRejectedValue(new Error('db down'))
    const { container } = buildContainer()
    await expect(runSeed(container)).resolves.toBeUndefined()
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'gateway_tpay',
      code: 'gateway_tpay.reconciliation_schedule_failed',
    })
  })

  it('keeps the existing default role features', () => {
    expect(setup.defaultRoleFeatures?.admin).toEqual(['gateway_tpay.view', 'gateway_tpay.configure'])
  })
})
