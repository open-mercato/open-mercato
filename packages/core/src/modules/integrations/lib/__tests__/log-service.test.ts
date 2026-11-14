/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { IntegrationLog } from '../../data/entities'
import { createIntegrationLogService, findLatestIntegrationLogsByCodes, IntegrationLogError } from '../log-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

type Reported = {
  error: unknown
  context?: { module?: string; code?: string; attributes?: Record<string, string | number | boolean | undefined> }
}

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

function entityManagerStub() {
  const flush = jest.fn(async () => undefined)
  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(() => ({ flush })),
  } as unknown as EntityManager
  return { em, flush }
}

function runtimeStub(options?: { throws?: boolean }) {
  const reported: Reported[] = []
  const runtime = {
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({}),
    continueTrace: <T>(_carrier: unknown, _name: string, fn: () => T) => fn(),
    recordHttpDuration: () => {},
    reportError: (error: unknown, context?: Reported['context']) => {
      if (options?.throws) throw new Error('[internal] telemetry exporter is down')
      reported.push({ error, context })
    },
    shutdown: async () => {},
  } as unknown as TelemetryRuntime
  return { runtime, reported }
}

describe('integration log service error reporting', () => {
  afterEach(() => {
    resetTelemetryRuntime()
    jest.clearAllMocks()
  })

  it('reports an error row outward with its code and ids', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    const { em, flush } = entityManagerStub()

    await createIntegrationLogService(em).write({
      integrationId: 'sync_akeneo',
      runId: 'run-1',
      scopeEntityType: 'sync_run',
      scopeEntityId: 'run-1',
      level: 'error',
      message: 'Failed to import item product-1: media file missing',
      code: 'data_sync.item_failed',
      payload: { errorMessage: 'media file missing', customerEmail: 'buyer@example.test' },
    }, scope)

    expect(flush).toHaveBeenCalled()
    expect(reported).toHaveLength(1)
    expect(reported[0]?.error).toBeInstanceOf(IntegrationLogError)
    expect((reported[0]?.error as Error).message).toBe('Failed to import item product-1: media file missing')
    expect(reported[0]?.context?.module).toBe('integrations')
    expect(reported[0]?.context?.code).toBe('data_sync.item_failed')
    expect(reported[0]?.context?.attributes).toEqual({
      integrationId: 'sync_akeneo',
      runId: 'run-1',
      scopeEntityType: 'sync_run',
      scopeEntityId: 'run-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
  })

  it('never lets the row payload leave the database', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    const { em } = entityManagerStub()

    await createIntegrationLogService(em).write({
      integrationId: 'gateway_stripe',
      level: 'error',
      message: 'Webhook processing failed',
      payload: { rawEvent: 'PAYLOAD-MARKER-DO-NOT-EXPORT', cardholder: 'Jan Kowalski' },
    }, scope)

    const serialized = JSON.stringify(reported)
    expect(serialized).not.toContain('PAYLOAD-MARKER-DO-NOT-EXPORT')
    expect(serialized).not.toContain('Jan Kowalski')
  })

  it('falls back to a real code so grouping still works', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    const { em } = entityManagerStub()

    await createIntegrationLogService(em).write({
      integrationId: 'sync_akeneo',
      level: 'error',
      message: 'Sync run failed',
    }, scope)

    expect(reported[0]?.context?.code).toBe('integrations.log_error')
  })

  it('falls back rather than trusting a code that is not a groupable fingerprint', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    const { em } = entityManagerStub()

    // Any module resolving this service can write a `code`, third-party ones
    // included. An interpolated one would open an `om.errors` series per value —
    // and metric labels, unlike attributes, never pass through redaction.
    await createIntegrationLogService(em).write({
      integrationId: 'sync_akeneo',
      level: 'error',
      message: 'Failed to import item product-1',
      code: 'http_404_https://erp.example.com/api/products/jan.kowalski@example.com',
    }, scope)

    expect(reported[0]?.context?.code).toBe('integrations.log_error')
  })

  it('keeps the row\'s own code when it is a groupable fingerprint', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    const { em } = entityManagerStub()

    await createIntegrationLogService(em).write({
      integrationId: 'gateway_stripe',
      level: 'error',
      message: 'Stripe webhook processing failed: signature mismatch',
      code: 'gateway_stripe.webhook_processing_failed',
    }, scope)

    expect(reported[0]?.context?.code).toBe('gateway_stripe.webhook_processing_failed')
  })

  it('does not report info or warn rows', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    const { em } = entityManagerStub()
    const service = createIntegrationLogService(em)

    await service.write({ integrationId: 'sync_akeneo', level: 'info', message: 'Processed import batch 1' }, scope)
    await service.write({ integrationId: 'sync_akeneo', level: 'warn', message: 'Sync run cancelled' }, scope)

    expect(reported).toHaveLength(0)
  })

  it('reports rows written through the scoped helper', async () => {
    const { runtime, reported } = runtimeStub()
    registerTelemetryRuntime(runtime)
    const { em } = entityManagerStub()

    await createIntegrationLogService(em).scoped('gateway_stripe', scope).error('Payment status polling failed')

    expect(reported).toHaveLength(1)
    expect(reported[0]?.context?.attributes?.integrationId).toBe('gateway_stripe')
  })

  it('keeps the row when telemetry throws — observability never alters behaviour', async () => {
    const { runtime } = runtimeStub({ throws: true })
    registerTelemetryRuntime(runtime)
    const { em, flush } = entityManagerStub()

    const row = await createIntegrationLogService(em).write({
      integrationId: 'sync_akeneo',
      level: 'error',
      message: 'Failed to import item product-2',
    }, scope)

    expect(flush).toHaveBeenCalled()
    expect(row).toMatchObject({ level: 'error', message: 'Failed to import item product-2' })
  })

  it('is a no-op with telemetry off', async () => {
    const { em, flush } = entityManagerStub()

    await expect(createIntegrationLogService(em).write({
      integrationId: 'sync_akeneo',
      level: 'error',
      message: 'Failed to import item product-3',
    }, scope)).resolves.toMatchObject({ level: 'error' })
    expect(flush).toHaveBeenCalled()
  })
})

describe('findLatestIntegrationLogsByCodes', () => {
  const em = {} as EntityManager
  const codes = ['integrations.oauth_disconnected', 'integrations.oauth_revocation_confirmed'] as const

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('reads newest first through findWithDecryption, scoped and filtered by code, one row by default', async () => {
    const rows = [{ id: 'log-1' }] as IntegrationLog[]
    mockFindWithDecryption.mockResolvedValue(rows)

    await expect(findLatestIntegrationLogsByCodes(em, 'test_oauth_grant', codes, scope)).resolves.toBe(rows)

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      IntegrationLog,
      {
        integrationId: 'test_oauth_grant',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        code: { $in: [...codes] },
      },
      { orderBy: { createdAt: 'DESC' }, limit: 1 },
      scope,
    )
  })

  it('narrows to a disconnectId in the payload', async () => {
    await findLatestIntegrationLogsByCodes(em, 'test_oauth_grant', codes, scope, { disconnectId: 'disconnect-1', limit: 5 })

    const [, , where, options] = mockFindWithDecryption.mock.calls[0] ?? []
    expect(where).toMatchObject({ payload: { disconnectId: 'disconnect-1' } })
    expect(options).toEqual({ orderBy: { createdAt: 'DESC' }, limit: 5 })
  })

  it('narrows to rows created at or after createdFrom', async () => {
    const createdFrom = new Date('2026-01-01T00:00:00.000Z')

    await findLatestIntegrationLogsByCodes(em, 'test_oauth_grant', codes, scope, { disconnectId: 'disconnect-1', createdFrom })

    const [, , where] = mockFindWithDecryption.mock.calls[0] ?? []
    expect(where).toMatchObject({ payload: { disconnectId: 'disconnect-1' }, createdAt: { $gte: createdFrom } })
  })

  it('clamps the limit to 1-20', async () => {
    await findLatestIntegrationLogsByCodes(em, 'test_oauth_grant', codes, scope, { limit: 500 })
    await findLatestIntegrationLogsByCodes(em, 'test_oauth_grant', codes, scope, { limit: 0 })

    expect(mockFindWithDecryption.mock.calls.map((call) => (call[3] as { limit?: number }).limit)).toEqual([20, 1])
  })

  it('does not query without codes', async () => {
    await expect(findLatestIntegrationLogsByCodes(em, 'test_oauth_grant', [], scope)).resolves.toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})
