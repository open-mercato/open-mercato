/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { processOutcomeSchema, type ProcessOutcome } from '../data/validators'
import {
  declaredOutcomeOf,
  outcomeDisplayLabel,
  outcomeEntityName,
  outcomeModuleId,
  parseDeclaredOutcome,
  readProcessOutcome,
} from '../lib/tasks/outcome'
import { resolveOutcomeHref, type OutcomeModuleLike } from '../lib/tasks/outcomeLink'
import { readSquashMigrationSql } from './helpers/squashMigration'

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn(async () => {}) }))

// Imported after the mock so the projection's own emit is inert here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recomputeProcessInstance } = require('../lib/processes/processProjection') as
  typeof import('../lib/processes/processProjection')

/**
 * The OPTIONAL outcome a completed BUSINESS EXECUTION produced
 * (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md`
 * §Outcome), and the soft-optional link resolution that degrades to its label
 * snapshot when the owning module is absent.
 *
 * It belongs to the execution's completion, never to a single agent run: at the
 * moment an agent finishes, a proposal's record does not exist yet.
 */

const MODULE_ROOT = path.join(__dirname, '..')
const LOCALES = ['en', 'es', 'de', 'pl', 'ko'] as const

const CLAIMS_MODULE: OutcomeModuleLike = {
  id: 'claims',
  backendRoutes: [
    { pattern: '/backend/claims' },
    { pattern: '/backend/claims/[id]' },
    { pattern: '/backend/claims/settings' },
  ],
}

const OUTCOME: ProcessOutcome = { type: 'claims:claim', id: 'claim-9', label: 'CASE-2026-04417' }

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn().mockResolvedValue(undefined) }))

describe('processOutcomeSchema', () => {
  it('round-trips the persisted shape', () => {
    expect(processOutcomeSchema.parse(OUTCOME)).toEqual(OUTCOME)
  })

  it('makes the LABEL optional — the snapshot is a nicety, the reference is not', () => {
    expect(processOutcomeSchema.safeParse({ type: 'claims:claim', id: 'claim-9' }).success).toBe(true)
    expect(processOutcomeSchema.safeParse({ type: 'claims:claim' }).success).toBe(false)
    expect(processOutcomeSchema.safeParse({ id: 'claim-9' }).success).toBe(false)
  })

  it('bounds every field to its column width', () => {
    expect(processOutcomeSchema.safeParse({ ...OUTCOME, type: 'x'.repeat(151) }).success).toBe(false)
    expect(processOutcomeSchema.safeParse({ ...OUTCOME, id: 'x'.repeat(201) }).success).toBe(false)
    expect(processOutcomeSchema.safeParse({ ...OUTCOME, label: 'x'.repeat(201) }).success).toBe(false)
  })

  it('does NOT pattern-bound `type` — storage accepts whatever a producing module declares', () => {
    expect(processOutcomeSchema.safeParse({ type: 'legacy-claim', id: 'claim-9' }).success).toBe(true)
  })
})

describe('reading the columns', () => {
  it('reads both the ORM casing and the raw list projection', () => {
    expect(readProcessOutcome({ outcomeType: 'claims:claim', outcomeId: 'claim-9', outcomeLabel: 'CASE-1' }))
      .toEqual({ type: 'claims:claim', id: 'claim-9', label: 'CASE-1' })
    expect(readProcessOutcome({ outcome_type: 'claims:claim', outcome_id: 'claim-9' }))
      .toEqual({ type: 'claims:claim', id: 'claim-9' })
  })

  it('returns null for a run that produced nothing — the normal case, not an error', () => {
    expect(readProcessOutcome(null)).toBeNull()
    expect(readProcessOutcome({})).toBeNull()
    expect(readProcessOutcome({ outcomeType: null, outcomeId: null, outcomeLabel: null })).toBeNull()
  })

  it('treats a half-written pair as no outcome at all', () => {
    expect(readProcessOutcome({ outcomeType: 'claims:claim' })).toBeNull()
    expect(readProcessOutcome({ outcomeId: 'claim-9' })).toBeNull()
  })

  it('shows the label snapshot in preference to the raw id', () => {
    expect(outcomeDisplayLabel(OUTCOME)).toBe('CASE-2026-04417')
    expect(outcomeDisplayLabel({ type: 'claims:claim', id: 'claim-9' })).toBe('claim-9')
  })

  it('splits the `<module>:<entity>` type, and declines when there is no prefix', () => {
    expect(outcomeModuleId('claims:claim')).toBe('claims')
    expect(outcomeEntityName('claims:claim')).toBe('claim')
    expect(outcomeModuleId('legacy-claim')).toBeNull()
    expect(outcomeModuleId(':claim')).toBeNull()
    expect(outcomeEntityName('claims:')).toBeNull()
  })
})

describe('outcomes DECLARED by the terminating source', () => {
  it('accepts the declared shape under the `outcome` key', () => {
    expect(declaredOutcomeOf({ claimId: 'claim-9', outcome: OUTCOME })).toEqual(OUTCOME)
  })

  it('ignores a malformed declaration rather than failing an otherwise successful run', () => {
    expect(declaredOutcomeOf({ outcome: { type: 'claims:claim' } })).toBeNull()
    expect(declaredOutcomeOf({ outcome: 'claim-9' })).toBeNull()
    expect(declaredOutcomeOf({})).toBeNull()
    expect(declaredOutcomeOf(null)).toBeNull()
    expect(parseDeclaredOutcome([OUTCOME])).toBeNull()
  })
})

describe('resolving the link soft-optionally', () => {
  it('links to the owning module’s own declared record route when it is present', () => {
    expect(resolveOutcomeHref(OUTCOME, [CLAIMS_MODULE])).toBe('/backend/claims/claim-9')
  })

  it('DEGRADES to the label snapshot when the owning module is absent from the deployment', () => {
    expect(resolveOutcomeHref(OUTCOME, [{ id: 'sales', backendRoutes: [{ pattern: '/backend/sales/orders/[id]' }] }]))
      .toBeNull()
    // ...and the label is still there for the reader, which is the whole point
    // of persisting a snapshot rather than only an FK id.
    expect(outcomeDisplayLabel(OUTCOME)).toBe('CASE-2026-04417')
  })

  it('returns null — never throws — when the registry has not been bootstrapped', () => {
    expect(resolveOutcomeHref(OUTCOME, null)).toBeNull()
  })

  it('declines rather than guessing when the module declares no matching record route', () => {
    expect(resolveOutcomeHref(OUTCOME, [{ id: 'claims', backendRoutes: [{ pattern: '/backend/claims' }] }])).toBeNull()
    expect(resolveOutcomeHref(OUTCOME, [{ id: 'claims' }])).toBeNull()
    expect(resolveOutcomeHref({ type: 'legacy-claim', id: 'claim-9' }, [CLAIMS_MODULE])).toBeNull()
  })

  it('matches the entity segment singular or simply pluralized, and never a catch-all route', () => {
    const sales: OutcomeModuleLike = { id: 'sales', backendRoutes: [{ pattern: '/backend/sales/orders/[id]' }] }
    expect(resolveOutcomeHref({ type: 'sales:order', id: 'o-1' }, [sales])).toBe('/backend/sales/orders/o-1')
    const catchAll: OutcomeModuleLike = { id: 'claims', backendRoutes: [{ pattern: '/backend/claims/[...rest]/[id]' }] }
    expect(resolveOutcomeHref(OUTCOME, [catchAll])).toBeNull()
  })

  it('encodes the id so a slash-bearing reference cannot forge a path', () => {
    expect(resolveOutcomeHref({ type: 'claims:claim', id: 'a/b' }, [CLAIMS_MODULE])).toBe('/backend/claims/a%2Fb')
  })
})

type FakeExecution = {
  id: string
  status: string
  workflowInstanceId: string
  tenantId: string
  organizationId: string
  processDefinitionId: string | null
  completedAt: Date | null
  failureReason: string | null
  outcomeType: string | null
  outcomeId: string | null
  outcomeLabel: string | null
  openedAt: Date
  lastActivityAt: Date
}

function fakeExecution(overrides: Partial<FakeExecution> = {}): FakeExecution {
  return {
    id: 'execution-1',
    status: 'running',
    workflowInstanceId: 'instance-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    processDefinitionId: 'def-1',
    completedAt: null,
    failureReason: null,
    outcomeType: null,
    outcomeId: null,
    outcomeLabel: null,
    openedAt: new Date('2026-09-06T09:00:00.000Z'),
    lastActivityAt: new Date('2026-09-06T09:00:00.000Z'),
    ...overrides,
  }
}

/** No proposals, no runs — the projection under test here is the terminal stamp. */
function fakeEm(execution: FakeExecution | null) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(execution),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

function fakeResolver(instance: unknown) {
  return {
    resolve: jest.fn((name: string) => {
      if (name !== 'workflowExecutor') throw new Error(`[internal] unexpected token ${name}`)
      return { getWorkflowInstance: jest.fn().mockResolvedValue(instance) }
    }),
  }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('the outcome is written ON COMPLETION, and is nullable', () => {
  it('stamps the three columns from the completed instance\u2019s declared outcome', async () => {
    const execution = fakeExecution()
    const resolver = fakeResolver({ ...SCOPE, context: { outcome: OUTCOME } })
    await recomputeProcessInstance(fakeEm(execution) as never, SCOPE, 'instance-1', {
      terminal: 'completed',
      resolver: resolver as never,
    })
    expect(execution.status).toBe('completed')
    expect(execution.outcomeType).toBe('claims:claim')
    expect(execution.outcomeId).toBe('claim-9')
    expect(execution.outcomeLabel).toBe('CASE-2026-04417')
  })

  it('leaves the columns NULL when the process produced nothing — a valid completion', async () => {
    const execution = fakeExecution()
    const resolver = fakeResolver({ ...SCOPE, context: { findings: 3 } })
    await recomputeProcessInstance(fakeEm(execution) as never, SCOPE, 'instance-1', {
      terminal: 'completed',
      resolver: resolver as never,
    })
    expect(execution.status).toBe('completed')
    expect(execution.outcomeType).toBeNull()
    expect(execution.outcomeId).toBeNull()
    expect(execution.outcomeLabel).toBeNull()
  })

  it('writes NO outcome on a failed execution — nothing was produced', async () => {
    const execution = fakeExecution()
    const resolver = fakeResolver({ ...SCOPE, context: { outcome: OUTCOME } })
    await recomputeProcessInstance(fakeEm(execution) as never, SCOPE, 'instance-1', {
      terminal: 'failed',
      failureReason: 'step blew up',
      resolver: resolver as never,
    })
    expect(execution.status).toBe('failed')
    expect(execution.outcomeType).toBeNull()
    expect(execution.failureReason).toBe('step blew up')
  })

  it('completes with no outcome when the `workflows` peer is absent — never throws', async () => {
    const execution = fakeExecution()
    const absent = { resolve: jest.fn(() => { throw new Error('[internal] module not registered') }) }
    await recomputeProcessInstance(fakeEm(execution) as never, SCOPE, 'instance-1', {
      terminal: 'completed',
      resolver: absent as never,
    })
    expect(execution.status).toBe('completed')
    expect(execution.outcomeType).toBeNull()

    const second = fakeExecution()
    await recomputeProcessInstance(fakeEm(second) as never, SCOPE, 'instance-1', { terminal: 'completed' })
    expect(second.outcomeType).toBeNull()
  })

  it('refuses an instance whose own scope does not match the execution\u2019s', async () => {
    const execution = fakeExecution()
    const foreign = fakeResolver({ tenantId: 'tenant-2', organizationId: 'org-1', context: { outcome: OUTCOME } })
    await recomputeProcessInstance(fakeEm(execution) as never, SCOPE, 'instance-1', {
      terminal: 'completed',
      resolver: foreign as never,
    })
    expect(execution.status).toBe('completed')
    expect(execution.outcomeType).toBeNull()
  })

  it('is idempotent — a redelivered event never re-stamps an already terminal execution', async () => {
    const execution = fakeExecution({
      status: 'completed',
      outcomeType: 'claims:claim',
      outcomeId: 'claim-1',
      completedAt: new Date('2026-09-06T09:30:00.000Z'),
    })
    const resolver = fakeResolver({ ...SCOPE, context: { outcome: OUTCOME } })
    await recomputeProcessInstance(fakeEm(execution) as never, SCOPE, 'instance-1', {
      terminal: 'completed',
      resolver: resolver as never,
    })
    // The terminal latch means the stamp happens once, on the transition.
    expect(execution.outcomeId).toBe('claim-1')
    expect(execution.completedAt).toEqual(new Date('2026-09-06T09:30:00.000Z'))
  })
})

describe('the squashed migration carries the outcome columns', () => {
  const migration = readSquashMigrationSql()

  it('declares all three as nullable on the execution read model', () => {
    expect(migration).toContain('"outcome_type" varchar(150) null')
    expect(migration).toContain('"outcome_id" varchar(200) null')
    expect(migration).toContain('"outcome_label" varchar(200) null')
  })

  it('ships the regenerated snapshot alongside it, with every column nullable', () => {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, 'migrations', '.snapshot-open-mercato.json'), 'utf8'),
    ) as { tables: Array<{ name: string; columns: Record<string, { type: string; nullable: boolean }> }> }
    const table = snapshot.tables.find((one) => one.name === 'process_instances')
    expect(table?.columns.outcome_type).toMatchObject({ type: 'varchar(150)', nullable: true })
    expect(table?.columns.outcome_id).toMatchObject({ type: 'varchar(200)', nullable: true })
    expect(table?.columns.outcome_label).toMatchObject({ type: 'varchar(200)', nullable: true })
  })
})

describe('the outcome is never an ORM relation, and never encrypted-by-omission', () => {
  it('declares three plain varchar properties, no ManyToOne', () => {
    const entities = fs.readFileSync(path.join(MODULE_ROOT, 'data', 'entities.ts'), 'utf8')
    const block = entities.slice(entities.indexOf('outcome_type'), entities.indexOf('outcome_label') + 200)
    expect(block).not.toContain('ManyToOne')
    expect(block).not.toContain('OneToOne')
  })

  it('keeps the reference PLAINTEXT, like process_instances.subject_label', () => {
    const encryption = fs.readFileSync(path.join(MODULE_ROOT, 'encryption.ts'), 'utf8')
    expect(encryption).not.toContain('outcome_label')
    expect(encryption).not.toContain('outcome_type')
  })
})

describe('i18n coverage for the outcome', () => {
  const requiredKeys = [
    'agent_orchestrator.process.factOutcome',
    'agent_orchestrator.process.outcomeUnlinked',
    'agent_orchestrator.processDefinitions.runs.col.outcome',
  ]

  it.each(LOCALES)('%s carries every outcome key', (locale) => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, 'i18n', `${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of requiredKeys) {
      expect(catalog[key]).toBeTruthy()
    }
  })
})
