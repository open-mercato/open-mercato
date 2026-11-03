/** @jest-environment node */
/**
 * The three setup hooks, and the property that distinguishes them.
 *
 * `onTenantCreated` gets no container, so it must do its work with `em` alone.
 * `seedDefaults` and `seedExamples` both get one, and differ in whether
 * `mercato init --no-examples` runs them — which is why demo todos live in the
 * latter and reference rows in the former.
 */
const installCustomEntitiesFromModules = jest.fn(async () => ({}))
const seedExampleTodos = jest.fn(async () => true)

jest.mock('@open-mercato/core/modules/entities/lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: (...args: unknown[]) =>
    installCustomEntitiesFromModules(...(args as [])),
}))

jest.mock('../cli', () => ({
  seedExampleTodos: (...args: unknown[]) => seedExampleTodos(...(args as [])),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { InitSetupContext, TenantSetupContext } from '@open-mercato/shared/modules/setup'
import setup from '../setup'
import {
  CALENDAR_REFERENCE_SEEDS,
  EXAMPLE_CALENDAR_ENTITY_ID,
  buildCalendarReferenceRecords,
  stableExampleRecordId,
} from '../lib/exampleSeeds'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const TENANT_B = '00000000-0000-4000-8000-00000000000b'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'
const ORG_A2 = '00000000-0000-4000-8000-0000000000a2'

const fakeEm = { name: 'em' }
const em = fakeEm as unknown as EntityManager

function createEngineContainer() {
  const createCustomEntityRecord = jest.fn(async () => ({ id: 'rec' }))
  const container = {
    resolve: jest.fn((token: string) => {
      if (token !== 'dataEngine') throw new Error(`[internal] unexpected token ${token}`)
      return { createCustomEntityRecord }
    }),
  }
  return { container, createCustomEntityRecord }
}

type EngineContainer = ReturnType<typeof createEngineContainer>['container']

function tenantCtx(): TenantSetupContext {
  return { em, tenantId: TENANT_A, organizationId: ORG_A1 }
}

function initCtx(container: EngineContainer): InitSetupContext {
  return { ...tenantCtx(), container: container as unknown as AwilixContainer }
}

describe('example setup hooks', () => {
  beforeEach(() => jest.clearAllMocks())

  it('declares all three hooks alongside the default role grants', () => {
    expect(typeof setup.onTenantCreated).toBe('function')
    expect(typeof setup.seedDefaults).toBe('function')
    expect(typeof setup.seedExamples).toBe('function')
    expect(setup.defaultRoleFeatures?.employee).toContain('example.*')
  })

  it('installs only this module custom entities for the new tenant, with no container and no cache', async () => {
    await setup.onTenantCreated!(tenantCtx())

    expect(installCustomEntitiesFromModules).toHaveBeenCalledTimes(1)
    const [em, cache, options] = installCustomEntitiesFromModules.mock.calls[0] as [
      unknown,
      unknown,
      { entityIds: string[]; tenantIds: string[]; includeGlobal: boolean },
    ]
    expect(em).toBe(fakeEm)
    expect(cache).toBeNull()
    expect(options.entityIds).toEqual(['example:calendar_entity', 'example:todo'])
    expect(options.tenantIds).toEqual([TENANT_A])
    expect(options.includeGlobal).toBe(false)
  })

  it('writes every calendar reference row through the DI-resolved data engine, scoped', async () => {
    const { container, createCustomEntityRecord } = createEngineContainer()

    await setup.seedDefaults!(initCtx(container))

    expect(createCustomEntityRecord).toHaveBeenCalledTimes(CALENDAR_REFERENCE_SEEDS.length)
    for (const call of createCustomEntityRecord.mock.calls) {
      expect(call[0]).toMatchObject({
        entityId: EXAMPLE_CALENDAR_ENTITY_ID,
        tenantId: TENANT_A,
        organizationId: ORG_A1,
        notify: false,
      })
    }
  })

  it('re-runs to exactly the same record ids, so a second seed upserts instead of duplicating', async () => {
    const first = createEngineContainer()
    const second = createEngineContainer()
    await setup.seedDefaults!(initCtx(first.container))
    await setup.seedDefaults!(initCtx(second.container))

    const idsOf = (calls: unknown[][]) =>
      calls.map((call) => (call[0] as { recordId?: unknown }).recordId)
    const expected = buildCalendarReferenceRecords({
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    }).map((record) => record.recordId)

    expect(expected.every((value) => typeof value === 'string' && value.length > 0)).toBe(true)
    expect(idsOf(first.createCustomEntityRecord.mock.calls)).toEqual(expected)
    expect(idsOf(second.createCustomEntityRecord.mock.calls)).toEqual(expected)
  })

  it('derives a different record id for every scope', () => {
    const idsFor = (tenantId: string, organizationId: string) =>
      buildCalendarReferenceRecords({ tenantId, organizationId }).map((record) => record.recordId)

    const base = idsFor(TENANT_A, ORG_A1)
    expect(new Set(base).size).toBe(CALENDAR_REFERENCE_SEEDS.length)
    expect(idsFor(TENANT_A, ORG_A2)).not.toEqual(base)
    expect(idsFor(TENANT_B, ORG_A1)).not.toEqual(base)
  })

  it('emits record ids in the UUID shape the custom entity storage requires', () => {
    for (const record of buildCalendarReferenceRecords({ tenantId: TENANT_A, organizationId: ORG_A1 })) {
      expect(record.recordId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
  })

  it('separates the id namespaces of two entities sharing a slug', () => {
    const scope = { tenantId: TENANT_A, organizationId: ORG_A1 }
    expect(stableExampleRecordId(scope, 'example:calendar_entity', 'shared')).not.toBe(
      stableExampleRecordId(scope, 'example:todo', 'shared'),
    )
  })

  it('routes demo todos through the shared CLI seeder, not a second implementation', async () => {
    const { container } = createEngineContainer()

    await setup.seedExamples!(initCtx(container))

    expect(seedExampleTodos).toHaveBeenCalledTimes(1)
    expect(seedExampleTodos.mock.calls[0]).toEqual([
      fakeEm,
      container,
      { organizationId: ORG_A1, tenantId: TENANT_A },
    ])
  })

  it('keeps demo todos out of the always-run hooks', async () => {
    const { container } = createEngineContainer()

    await setup.onTenantCreated!(tenantCtx())
    await setup.seedDefaults!(initCtx(container))

    expect(seedExampleTodos).not.toHaveBeenCalled()
  })
})
