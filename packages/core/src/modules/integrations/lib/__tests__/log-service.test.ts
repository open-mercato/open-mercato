/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { createIntegrationLogService, IntegrationLogError } from '../log-service'

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
