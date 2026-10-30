/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { AgentEvalAssertion, AgentEvalCase } from '../data/entities'

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (em: { flush?: () => Promise<void> }, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
    await em.flush?.()
  },
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (entity: unknown, where: unknown) => unknown }, entity: unknown, where: unknown) =>
    em.find(entity, where),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../lib/eval/evalSetAccess', () => ({
  EVAL_SET_IMPORT_FEATURES: ['agent_orchestrator.eval.manage'],
  hasEvalSetFeatures: jest.fn(async () => true),
}))

const invalidateCrudCacheMock = jest.fn(async () => {})
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...(args as [])),
}))

import { canonicalizeResourceTag } from '@open-mercato/shared/lib/crud/cache'
import {
  EVAL_SET_RESOURCE_KIND,
  importEvalSetCommand,
  type EvalSetImportUndoPayload,
  type ImportEvalSetCommandResult,
} from '../commands/evalSets'
import { canonicalInputKey } from '../lib/eval/canonicalInputKey'
import { hasEvalSetFeatures } from '../lib/eval/evalSetAccess'
import { EVAL_SET_FORMAT, deterministicCaseId } from '../lib/eval/manifest'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const USER = '33333333-3333-4333-8333-333333333333'
const AGENT = 'content_review.validator'

type Row = Record<string, unknown>

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && '$in' in expected) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  return (actual ?? null) === expected
}

function createFakeEm() {
  const stores = new Map<unknown, Row[]>()
  const pending: Row[] = []
  const storeFor = (entity: unknown): Row[] => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const em = {
    fork: () => em,
    create(entity: unknown, data: Row) {
      return { ...data, __entity: entity }
    },
    persist(row: Row) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        const store = storeFor(row.__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async find(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => Object.entries(where).every(([key, value]) => matchesValue(row[key], value)))
    },
  }
  return { em: em as unknown as EntityManager, storeFor, flush: jest.spyOn(em, 'flush') }
}

function makeCtx(em: EntityManager, overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container: {
      resolve(name: string) {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected resolve(${name})`)
      },
    },
    auth: { sub: USER, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    ...overrides,
  } as unknown as CommandRuntimeContext
}

function sampleFile(overrides: Record<string, unknown> = {}) {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId: AGENT,
    label: 'regression',
    assertions: [
      { key: 'present', scorerKey: 'output_present', severity: 'gate', title: 'Output present', config: {} },
      {
        key: 'confident',
        scorerKey: 'confidence_threshold',
        severity: 'warn',
        title: 'Confident enough',
        config: { threshold: 0.6, direction: 'gte' },
      },
    ],
    cases: [
      {
        key: 'banned-01',
        name: 'Guaranteed returns',
        input: { content: 'Guaranteed 20% returns' },
        expected: { overall: 'fail' },
        assertions: [{ key: 'present' }, { key: 'confident', configOverride: { threshold: 0.8 } }],
      },
      { key: 'clean-01', input: { content: 'Capital at risk.' } },
    ],
    ...overrides,
  }
}

async function runImport(em: EntityManager, file: unknown, approve = false) {
  return importEvalSetCommand.execute(
    { tenantId: TENANT, organizationId: ORG, userId: USER, file, approve },
    makeCtx(em),
  )
}

async function logEntryFor(result: ImportEvalSetCommandResult, em: EntityManager): Promise<CommandUndoLogEntry> {
  const log = await importEvalSetCommand.buildLog!({
    input: { tenantId: TENANT, organizationId: ORG, file: null },
    result,
    ctx: makeCtx(em),
    snapshots: {},
  })
  return { commandPayload: log?.payload }
}

describe('agent_orchestrator.evalSets.import command', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates file-sourced draft cases and agent-scoped assertions', async () => {
    const { em, storeFor } = createFakeEm()
    const result = await runImport(em, sampleFile())

    expect(result.created).toEqual({ cases: 2, assertions: 2 })
    expect(result.updated).toEqual({ cases: 0, assertions: 0 })
    expect(result.version).toMatch(/^sha256:[0-9a-f]{64}$/)

    const assertions = storeFor(AgentEvalAssertion)
    expect(assertions).toHaveLength(2)
    expect(assertions[0]).toMatchObject({ tenantId: TENANT, organizationId: ORG, appliesTo: AGENT, key: 'present', type: 'deterministic', enabled: true })

    const cases = storeFor(AgentEvalCase)
    expect(cases).toHaveLength(2)
    const banned = cases.find((row) => row.name === 'Guaranteed returns')!
    expect(banned).toMatchObject({
      tenantId: TENANT,
      organizationId: ORG,
      sourceType: 'file',
      sourceId: deterministicCaseId(AGENT, 'banned-01'),
      agentDefinitionId: AGENT,
      status: 'draft',
      approvedByUserId: null,
      inputKey: canonicalInputKey({ content: 'Guaranteed 20% returns' }),
    })
    const presentId = assertions.find((row) => row.key === 'present')!.id
    const confidentId = assertions.find((row) => row.key === 'confident')!.id
    expect(banned.assertions).toEqual([
      { assertionId: presentId },
      { assertionId: confidentId, configOverride: { threshold: 0.8 } },
    ])
    expect(cases.find((row) => row.name === null)!.assertions).toBeNull()
  })

  it('is idempotent: re-importing the same file writes nothing', async () => {
    const { em, flush } = createFakeEm()
    await runImport(em, sampleFile())
    flush.mockClear()
    const again = await runImport(em, sampleFile())
    expect(again.created).toEqual({ cases: 0, assertions: 0 })
    expect(again.updated).toEqual({ cases: 0, assertions: 0 })
    expect(again.unchanged).toEqual({ cases: 2, assertions: 2 })
    expect(again.undo.updatedCases).toEqual([])
    expect(flush).not.toHaveBeenCalled()
  })

  it('updates changed rows by key and demotes an edited approved case back to draft', async () => {
    const { em, storeFor } = createFakeEm()
    await runImport(em, sampleFile(), true)
    const before = storeFor(AgentEvalCase).find((row) => row.name === 'Guaranteed returns')!
    expect(before).toMatchObject({ status: 'approved', approvedByUserId: USER })
    const presentRow = storeFor(AgentEvalAssertion).find((row) => row.key === 'present')!
    const presentVersion = presentRow.version

    const edited = sampleFile()
    edited.cases[0] = { ...edited.cases[0], expected: { overall: 'pass' } }
    edited.assertions[1] = { ...edited.assertions[1], config: { threshold: 0.7, direction: 'gte' } }
    edited.assertions[0] = { ...edited.assertions[0], title: 'Has output' }
    const result = await runImport(em, edited)

    expect(result.created).toEqual({ cases: 0, assertions: 0 })
    expect(result.updated).toEqual({ cases: 1, assertions: 2 })
    expect(storeFor(AgentEvalCase)).toHaveLength(2)
    expect(before).toMatchObject({ expected: { overall: 'pass' }, status: 'draft', approvedByUserId: null })
    expect(presentRow.title).toBe('Has output')
    expect(presentRow.version).toBe(presentVersion)
    const confidentRow = storeFor(AgentEvalAssertion).find((row) => row.key === 'confident')!
    expect(confidentRow.config).toEqual({ threshold: 0.7, direction: 'gte' })
  })

  it('approve stamps the caller on new and existing drafts', async () => {
    const { em, storeFor } = createFakeEm()
    await runImport(em, sampleFile())
    const result = await runImport(em, sampleFile(), true)
    expect(result.updated.cases).toBe(2)
    expect(result.cases.every((entry) => entry.status === 'approved')).toBe(true)
    expect(storeFor(AgentEvalCase).every((row) => row.status === 'approved' && row.approvedByUserId === USER)).toBe(true)
  })

  it('updates an existing case when the key is its id (current export round trip)', async () => {
    const { em, storeFor } = createFakeEm()
    const existingId = '44444444-4444-4444-8444-444444444444'
    storeFor(AgentEvalCase).push({
      __entity: AgentEvalCase,
      id: existingId,
      tenantId: TENANT,
      organizationId: ORG,
      sourceType: 'correction',
      sourceId: '55555555-5555-4555-8555-555555555555',
      agentDefinitionId: AGENT,
      name: null,
      input: { content: 'old' },
      expected: null,
      assertions: null,
      status: 'approved',
      approvedByUserId: USER,
      deletedAt: null,
    })
    const result = await runImport(em, sampleFile({ assertions: [], cases: [{ key: existingId, input: { content: 'new' } }] }))
    expect(result.cases).toEqual([{ key: existingId, id: existingId, status: 'draft', change: 'updated' }])
    expect(storeFor(AgentEvalCase)).toHaveLength(1)
    expect(storeFor(AgentEvalCase)[0]).toMatchObject({ sourceType: 'correction', input: { content: 'new' }, status: 'draft' })
  })

  it('does not touch rows of another organization', async () => {
    const { em, storeFor } = createFakeEm()
    storeFor(AgentEvalAssertion).push({
      __entity: AgentEvalAssertion,
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: TENANT,
      organizationId: OTHER_ORG,
      appliesTo: AGENT,
      key: 'present',
      scorerKey: 'contains',
      title: 'Other org',
      type: 'deterministic',
      severity: 'warn',
      config: {},
      enabled: true,
      version: 1,
      deletedAt: null,
    })
    const result = await runImport(em, sampleFile())
    expect(result.created.assertions).toBe(2)
    expect(storeFor(AgentEvalAssertion).find((row) => row.organizationId === OTHER_ORG)).toMatchObject({ title: 'Other org' })
  })

  it('refuses an invalid file with field-level issues (422)', async () => {
    const { em } = createFakeEm()
    const invalid = sampleFile()
    invalid.assertions[1] = { ...invalid.assertions[1], config: { threshold: 'high', direction: 'gte' } }
    await expect(runImport(em, invalid)).rejects.toMatchObject({
      status: 422,
      body: {
        code: 'eval_set_file_invalid',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid_scorer_config', path: 'assertions.1.config' })]),
      },
    })
  })

  it('refuses a case name longer than the column', async () => {
    const { em } = createFakeEm()
    const file = sampleFile({ cases: [{ key: 'long', name: 'x'.repeat(201), input: {} }] })
    await expect(runImport(em, file)).rejects.toMatchObject({
      status: 422,
      body: { issues: [expect.objectContaining({ code: 'schema', path: 'cases.0.name' })] },
    })
  })

  it('rejects a scope outside the actor', async () => {
    const { em } = createFakeEm()
    await expect(
      importEvalSetCommand.execute(
        { tenantId: TENANT, organizationId: OTHER_ORG, userId: USER, file: sampleFile() },
        makeCtx(em),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('logs an undoable entry scoped to the agent and undo reverts the import', async () => {
    const { em, storeFor } = createFakeEm()
    await runImport(em, sampleFile())
    const caseRow = storeFor(AgentEvalCase).find((row) => row.name === 'Guaranteed returns')!
    const presentRow = storeFor(AgentEvalAssertion).find((row) => row.key === 'present')!

    const edited = sampleFile({
      assertions: [{ key: 'present', scorerKey: 'output_present', severity: 'gate', title: 'Renamed', config: {} }],
      cases: [
        { key: 'banned-01', name: 'Guaranteed returns', input: { content: 'changed' } },
        { key: 'new-01', input: { content: 'fresh' } },
      ],
    })
    const result = await runImport(em, edited)
    expect(importEvalSetCommand.isUndoable).toBe(true)
    const log = await importEvalSetCommand.buildLog!({
      input: { tenantId: TENANT, organizationId: ORG, file: edited },
      result,
      ctx: makeCtx(em),
      snapshots: {},
    })
    expect(log).toMatchObject({ resourceKind: EVAL_SET_RESOURCE_KIND, resourceId: AGENT, tenantId: TENANT, organizationId: ORG })
    const undoPayload = (log?.payload as { undo: EvalSetImportUndoPayload }).undo
    expect(undoPayload.createdCaseIds).toHaveLength(1)
    expect(undoPayload.updatedCases.map((entry) => entry.id)).toEqual([caseRow.id])
    expect(undoPayload.updatedAssertions.map((entry) => entry.id)).toEqual([presentRow.id])

    const logEntry = await logEntryFor(result, em)
    await importEvalSetCommand.authorizeReplay!({ operation: 'undo', input: { tenantId: TENANT, organizationId: ORG, file: null }, ctx: makeCtx(em), logEntry })
    await importEvalSetCommand.undo!({ input: { tenantId: TENANT, organizationId: ORG, file: null }, ctx: makeCtx(em), logEntry })

    expect(caseRow.input).toEqual({ content: 'Guaranteed 20% returns' })
    expect(presentRow.title).toBe('Output present')
    const created = storeFor(AgentEvalCase).find((row) => row.id === undoPayload.createdCaseIds[0])!
    expect(created.deletedAt).toBeInstanceOf(Date)
  })

  it('undo of a first import soft-deletes created assertions and a re-import revives them', async () => {
    const { em, storeFor } = createFakeEm()
    const first = await runImport(em, sampleFile())
    const logEntry = await logEntryFor(first, em)
    await importEvalSetCommand.undo!({ input: { tenantId: TENANT, organizationId: ORG, file: null }, ctx: makeCtx(em), logEntry })
    expect(storeFor(AgentEvalAssertion).every((row) => row.deletedAt instanceof Date)).toBe(true)
    expect(storeFor(AgentEvalCase).every((row) => row.deletedAt instanceof Date)).toBe(true)

    const again = await runImport(em, sampleFile())
    expect(again.updated.assertions).toBe(2)
    expect(again.created.cases).toBe(2)
    expect(storeFor(AgentEvalAssertion)).toHaveLength(2)
    expect(storeFor(AgentEvalAssertion).every((row) => row.deletedAt === null)).toBe(true)
  })

  it('refuses undo without the eval.manage feature', async () => {
    const { em } = createFakeEm()
    const result = await runImport(em, sampleFile())
    const logEntry = await logEntryFor(result, em)
    ;(hasEvalSetFeatures as jest.Mock).mockResolvedValueOnce(false)
    await expect(
      importEvalSetCommand.authorizeReplay!({ operation: 'undo', input: { tenantId: TENANT, organizationId: ORG, file: null }, ctx: makeCtx(em), logEntry }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('flushes the eval-case and eval-assertion list caches after a writing import and its undo, not after a no-op', async () => {
    const { em } = createFakeEm()
    const flushedResources = () =>
      invalidateCrudCacheMock.mock.calls.map((call) => (call as unknown[])[1]).sort()
    const expected = [
      canonicalizeResourceTag(AgentEvalAssertion.name),
      canonicalizeResourceTag(AgentEvalCase.name),
    ].sort()

    const first = await runImport(em, sampleFile())
    expect(flushedResources()).toEqual(expected)
    expect(invalidateCrudCacheMock.mock.calls[0]).toEqual([
      expect.anything(),
      expect.any(String),
      { id: null, tenantId: TENANT, organizationId: ORG },
      TENANT,
      expect.any(String),
    ])

    invalidateCrudCacheMock.mockClear()
    await runImport(em, sampleFile())
    expect(invalidateCrudCacheMock).not.toHaveBeenCalled()

    const logEntry = await logEntryFor(first, em)
    await importEvalSetCommand.undo!({ input: { tenantId: TENANT, organizationId: ORG, file: null }, ctx: makeCtx(em), logEntry })
    expect(flushedResources()).toEqual(expected)
  })
})
