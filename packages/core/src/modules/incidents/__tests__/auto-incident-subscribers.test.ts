/** @jest-environment node */

import handleDataSyncFailure from '../subscribers/auto-incident-data-sync'
import { Incident, IncidentSettings, IncidentSeverity, IncidentType } from '../data/entities'

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RUN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const INCIDENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SEVERITY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const TYPE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const EVENT_ID = 'data_sync.run.failed'
const SOURCE_EVENT_REF = `${EVENT_ID}:${RUN_ID}`

type MockState = {
  triggerEnabled?: boolean
  existingIncident?: Record<string, unknown> | null
  severity?: Record<string, unknown> | null
  incidentType?: Record<string, unknown> | null
  incidentToStamp?: Record<string, unknown> | null
}

function buildSettings(enabled: boolean) {
  return {
    autoIncidentTriggers: {
      [EVENT_ID]: {
        enabled,
        severity_key: 'sev2',
        type_key: 'operational',
      },
    },
  }
}

function buildMockEm(state: MockState = {}) {
  const incidentToStamp = state.incidentToStamp ?? {
    id: INCIDENT_ID,
    sourceEventRef: null,
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
  }

  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === IncidentSettings) return buildSettings(state.triggerEnabled === true)
      if (entity === Incident && where.sourceEventRef === SOURCE_EVENT_REF) return state.existingIncident ?? null
      if (entity === Incident && where.id === INCIDENT_ID) return incidentToStamp
      if (entity === IncidentSeverity) {
        return state.severity === undefined ? { id: SEVERITY_ID, key: 'sev2' } : state.severity
      }
      if (entity === IncidentType) {
        return state.incidentType === undefined ? { id: TYPE_ID, key: 'operational' } : state.incidentType
      }
      return null
    }),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(function fork() {
      return this
    }),
  }

  return { em, incidentToStamp }
}

function buildCtx(em: unknown, commandBus = { execute: jest.fn() }) {
  return {
    commandBus,
    ctx: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        throw new Error(`unexpected resolve(${name})`)
      }),
    },
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    integrationId: 'integration-1',
    entityType: 'orders',
    direction: 'pull',
    error: 'Data sync run failed',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...overrides,
  }
}

describe('incidents auto-incident data-sync subscriber', () => {
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    jest.clearAllMocks()
  })

  it('does not dispatch when the data_sync trigger is disabled in settings', async () => {
    const { em } = buildMockEm({ triggerEnabled: false })
    const commandBus = { execute: jest.fn() }
    const { ctx } = buildCtx(em, commandBus)

    await handleDataSyncFailure(payload(), ctx)

    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('dispatches one incident create carrying the source event ref when enabled', async () => {
    const { em } = buildMockEm({ triggerEnabled: true })
    const commandBus = {
      execute: jest.fn(async () => ({ result: { incidentId: INCIDENT_ID } })),
    }
    const { ctx } = buildCtx(em, commandBus)

    await handleDataSyncFailure(payload(), ctx)

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'incidents.incidents.create',
      expect.objectContaining({
        input: expect.objectContaining({
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          title: 'Data sync run failed: orders pull',
          description: expect.stringContaining(`Run: ${RUN_ID}`),
          incidentTypeId: TYPE_ID,
          severityId: SEVERITY_ID,
          sourceEventRef: SOURCE_EVENT_REF,
        }),
      }),
    )
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not dispatch again when an incident already has the source event ref', async () => {
    const { em } = buildMockEm({
      triggerEnabled: true,
      existingIncident: { id: INCIDENT_ID, sourceEventRef: SOURCE_EVENT_REF },
    })
    const commandBus = { execute: jest.fn() }
    const { ctx } = buildCtx(em, commandBus)

    await handleDataSyncFailure(payload(), ctx)

    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('does not dispatch and does not throw when configured severity or type cannot be resolved', async () => {
    const { em } = buildMockEm({
      triggerEnabled: true,
      severity: null,
      incidentType: null,
    })
    const commandBus = { execute: jest.fn() }
    const { ctx } = buildCtx(em, commandBus)

    await expect(handleDataSyncFailure(payload(), ctx)).resolves.toBeUndefined()

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[incidents:auto-incident-data-sync] configured severity/type not found',
      expect.objectContaining({
        severityKey: 'sev2',
        typeKey: 'operational',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
    )
  })
})
