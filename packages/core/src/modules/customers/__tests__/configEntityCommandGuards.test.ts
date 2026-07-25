/**
 * Phase 2 (record-locks customers): pipeline + pipeline-stage config-entity
 * command guards. These entities are edited through hand-written routes
 * (`api/customers/pipelines`, `api/customers/pipeline-stages`) that dispatch the
 * `customers.pipelines.update`/`customers.pipeline-stages.update` commands
 * WITHOUT the makeCrudRoute mutation-guard decorator — so the only place the OSS
 * optimistic-lock floor (and the optional enterprise record_locks enrichment)
 * can run is inside the command handler.
 *
 * These tests assert each migrated command awaits the async DI-aware seam
 * (`enforceCommandOptimisticLockWithGuards`) with the loaded entity's own
 * `updatedAt` BEFORE it mutates, and that a seam 409 aborts the write.
 */
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const enforceWithGuardsMock = jest.fn<Promise<void>, [unknown, Record<string, unknown>]>()
const recordGoneMock = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (container: unknown, input: Record<string, unknown>) =>
    enforceWithGuardsMock(container, input),
  enforceRecordGoneIsConflict: (input: unknown) => recordGoneMock(input),
}))

// `withAtomicFlush` runs the phases in order and is not under test here — run
// each phase so any mutation it would persist is exercised, but never touch a DB.
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) {
      await phase()
    }
  },
}))

// Keep the dictionary side-effect (pipeline_stage label) a no-op so the stage
// update command does not reach for a real EM during the atomic phase.
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, ensureDictionaryEntry: jest.fn(async () => undefined) }
})

// Pipeline-stage commands load via `findOneWithDecryption`; return the seeded
// record (or null) supplied through the EM fork's `findOne` mock so the same
// `makeCtx(loaded)` seam drives both pipeline and stage tests.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: { findOne: (...args: unknown[]) => Promise<unknown> }) => em.findOne(),
  findWithDecryption: async () => [],
}))

import { updatePipelineCommand, deletePipelineCommand } from '../commands/pipelines'
import { updatePipelineStageCommand, deletePipelineStageCommand } from '../commands/pipeline-stages'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PIPELINE_ID = '33333333-3333-4333-8333-333333333333'
const STAGE_ID = '44444444-4444-4444-8444-444444444444'
const UPDATED_AT = new Date('2026-06-01T00:00:00.000Z')

type LoadedRecord = Record<string, unknown> | null

function makeEm(loaded: LoadedRecord) {
  return {
    fork() {
      return {
        findOne: jest.fn(async () => loaded),
        count: jest.fn(async () => 0),
        nativeUpdate: jest.fn(async () => undefined),
        remove: jest.fn(),
        flush: jest.fn(async () => undefined),
        persist: jest.fn(),
      }
    },
  }
}

function makeCtx(loaded: LoadedRecord): CommandRuntimeContext {
  const em = makeEm(loaded)
  return {
    container: { resolve: (key: string) => (key === 'em' ? em : undefined) },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/customers/pipelines', { method: 'PUT' }),
  } as unknown as CommandRuntimeContext
}

beforeEach(() => {
  enforceWithGuardsMock.mockReset()
  enforceWithGuardsMock.mockResolvedValue(undefined)
  recordGoneMock.mockReset()
})

describe('customers.pipelines.update — command guard', () => {
  test('awaits the async seam with the pipeline updatedAt before mutating', async () => {
    const pipeline = { id: PIPELINE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, name: 'Old', isDefault: false, updatedAt: UPDATED_AT }
    const ctx = makeCtx(pipeline)

    await updatePipelineCommand.execute({ id: PIPELINE_ID, name: 'New' }, ctx)

    expect(enforceWithGuardsMock).toHaveBeenCalledTimes(1)
    const [, input] = enforceWithGuardsMock.mock.calls[0]
    expect(input).toMatchObject({ resourceKind: 'customers.pipeline', resourceId: PIPELINE_ID, current: UPDATED_AT })
    expect(pipeline.name).toBe('New')
  })

  test('a seam 409 aborts the write (no mutation applied)', async () => {
    const pipeline = { id: PIPELINE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, name: 'Old', isDefault: false, updatedAt: UPDATED_AT }
    const ctx = makeCtx(pipeline)
    enforceWithGuardsMock.mockRejectedValueOnce(new CrudHttpError(409, { code: 'record_modified', error: 'conflict' }))

    await expect(updatePipelineCommand.execute({ id: PIPELINE_ID, name: 'New' }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(pipeline.name).toBe('Old')
  })

  test('a missing pipeline surfaces the gone-as-conflict before the 404', async () => {
    const ctx = makeCtx(null)
    await expect(updatePipelineCommand.execute({ id: PIPELINE_ID, name: 'New' }, ctx)).rejects.toMatchObject({ status: 404 })
    expect(recordGoneMock).toHaveBeenCalledTimes(1)
    expect(enforceWithGuardsMock).not.toHaveBeenCalled()
  })
})

describe('customers.pipelines.delete — command guard', () => {
  test('awaits the async seam with the pipeline updatedAt before removing', async () => {
    const pipeline = { id: PIPELINE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, name: 'Old', isDefault: false, updatedAt: UPDATED_AT }
    const ctx = makeCtx(pipeline)

    await deletePipelineCommand.execute({ id: PIPELINE_ID }, ctx)

    expect(enforceWithGuardsMock).toHaveBeenCalledTimes(1)
    const [, input] = enforceWithGuardsMock.mock.calls[0]
    expect(input).toMatchObject({ resourceKind: 'customers.pipeline', resourceId: PIPELINE_ID, current: UPDATED_AT })
  })
})

describe('customers.pipeline-stages.update — command guard', () => {
  test('awaits the async seam with the stage updatedAt before mutating', async () => {
    const stage = { id: STAGE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, label: 'Old', order: 0, updatedAt: UPDATED_AT }
    const ctx = makeCtx(stage)

    await updatePipelineStageCommand.execute({ id: STAGE_ID, label: 'New' }, ctx)

    expect(enforceWithGuardsMock).toHaveBeenCalledTimes(1)
    const [, input] = enforceWithGuardsMock.mock.calls[0]
    expect(input).toMatchObject({ resourceKind: 'customers.pipelineStage', resourceId: STAGE_ID, current: UPDATED_AT })
    expect(stage.label).toBe('New')
  })

  test('a seam 409 aborts the write (no mutation applied)', async () => {
    const stage = { id: STAGE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, label: 'Old', order: 0, updatedAt: UPDATED_AT }
    const ctx = makeCtx(stage)
    enforceWithGuardsMock.mockRejectedValueOnce(new CrudHttpError(409, { code: 'record_modified', error: 'conflict' }))

    await expect(updatePipelineStageCommand.execute({ id: STAGE_ID, label: 'New' }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(stage.label).toBe('Old')
  })
})

describe('customers.pipeline-stages.delete — command guard', () => {
  test('awaits the async seam with the stage updatedAt before removing', async () => {
    const stage = { id: STAGE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, label: 'Old', order: 0, updatedAt: UPDATED_AT }
    const ctx = makeCtx(stage)

    await deletePipelineStageCommand.execute({ id: STAGE_ID }, ctx)

    expect(enforceWithGuardsMock).toHaveBeenCalledTimes(1)
    const [, input] = enforceWithGuardsMock.mock.calls[0]
    expect(input).toMatchObject({ resourceKind: 'customers.pipelineStage', resourceId: STAGE_ID, current: UPDATED_AT })
  })
})
