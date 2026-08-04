/** @jest-environment node */

import { executeIncidentBulkOpsWithProgress } from '../lib/bulkOps'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { bridgeLegacyGuard, type MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/mutation-guard-registry')
  return {
    ...actual,
    bridgeLegacyGuard: jest.fn(() => null),
  }
})

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const INCIDENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const UPDATED_AT = '2026-07-01T12:00:00.000Z'

function buildHarness(options: { guard?: MutationGuard } = {}) {
  ;(getAllMutationGuardInstances as jest.Mock).mockReturnValue(options.guard ? [options.guard] : [])
  ;(bridgeLegacyGuard as jest.Mock).mockReturnValue(null)

  const commandBus = {
    execute: jest.fn(async () => ({
      incidentId: INCIDENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })),
  }
  const progressService = {
    startJob: jest.fn(async () => undefined),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === 'commandBus') return commandBus
      if (key === 'progressService') return progressService
      throw new Error(`unexpected resolve(${key})`)
    }),
  }

  return { commandBus, container, progressService }
}

describe('incident bulk operations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('passes per-row optimistic-lock tokens into command context and runs guard after success after the command', async () => {
    const guard: MutationGuard = {
      id: 'test.guard',
      targetEntity: 'incidents.incident',
      operations: ['update'],
      validate: jest.fn(async () => ({
        ok: true,
        shouldRunAfterSuccess: true,
        metadata: { guard: 'ok' },
      })),
      afterSuccess: jest.fn(async () => undefined),
    }
    const { commandBus, container } = buildHarness({ guard })

    const summary = await executeIncidentBulkOpsWithProgress({
      container: container as never,
      progressJobId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      action: 'acknowledge',
      ids: [INCIDENT_ID],
      expectedUpdatedAtById: { [INCIDENT_ID]: UPDATED_AT },
      requestHeaders: { 'x-request-id': 'req-1' },
      scope: {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        userFeatures: ['incidents.incident.manage'],
      },
    })

    expect(summary).toMatchObject({ affectedCount: 1, failedCount: 0 })
    expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: INCIDENT_ID,
      requestHeaders: expect.any(Headers),
      mutationPayload: expect.objectContaining({
        action: 'acknowledge',
        expectedUpdatedAt: UPDATED_AT,
        id: INCIDENT_ID,
      }),
    }))
    expect(commandBus.execute).toHaveBeenCalledWith('incidents.incident.acknowledge', expect.objectContaining({
      ctx: expect.objectContaining({
        incidentOptimisticLockExpectedUpdatedAtById: { [INCIDENT_ID]: UPDATED_AT },
      }),
    }))
    expect(guard.afterSuccess).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { guard: 'ok' },
      resourceId: INCIDENT_ID,
    }))
    expect(commandBus.execute.mock.invocationCallOrder[0]).toBeLessThan(
      (guard.afterSuccess as jest.Mock).mock.invocationCallOrder[0],
    )
  })

  test('records a per-row failure without running the command or after-success callbacks when a guard blocks', async () => {
    const guard: MutationGuard = {
      id: 'test.block',
      targetEntity: 'incidents.incident',
      operations: ['update'],
      validate: jest.fn(async () => ({
        ok: false,
        status: 423,
        body: { error: 'blocked by guard' },
      })),
      afterSuccess: jest.fn(async () => undefined),
    }
    const { commandBus, container } = buildHarness({ guard })

    const summary = await executeIncidentBulkOpsWithProgress({
      container: container as never,
      progressJobId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      action: 'close',
      ids: [INCIDENT_ID],
      expectedUpdatedAtById: { [INCIDENT_ID]: UPDATED_AT },
      scope: {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        userFeatures: ['incidents.incident.manage', 'incidents.incident.close'],
      },
    })

    expect(summary).toMatchObject({
      affectedCount: 0,
      failedCount: 1,
      failures: [{ id: INCIDENT_ID, message: 'blocked by guard' }],
    })
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(guard.afterSuccess).not.toHaveBeenCalled()
  })
})
