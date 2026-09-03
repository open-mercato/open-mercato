/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { processRunOutcomeSchema, type ProcessRunOutcome } from '../data/validators'
import {
  declaredOutcomeOf,
  outcomeDisplayLabel,
  outcomeEntityName,
  outcomeModuleId,
  parseDeclaredOutcome,
  readProcessRunOutcome,
} from '../lib/tasks/outcome'
import { resolveOutcomeHref, type OutcomeModuleLike } from '../lib/tasks/outcomeLink'
import { resolveWorkflowProcessRun } from '../lib/tasks/resolveWorkflowProcessRun'

/**
 * Phase 4 of the triggered process model — the OPTIONAL outcome a completed run
 * produced (`.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md`
 * §Outcome), and the soft-optional link resolution that degrades to its label
 * snapshot when the owning module is absent.
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

const OUTCOME: ProcessRunOutcome = { type: 'claims:claim', id: 'claim-9', label: 'CASE-2026-04417' }

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn().mockResolvedValue(undefined) }))

describe('processRunOutcomeSchema', () => {
  it('round-trips the persisted shape', () => {
    expect(processRunOutcomeSchema.parse(OUTCOME)).toEqual(OUTCOME)
  })

  it('makes the LABEL optional — the snapshot is a nicety, the reference is not', () => {
    expect(processRunOutcomeSchema.safeParse({ type: 'claims:claim', id: 'claim-9' }).success).toBe(true)
    expect(processRunOutcomeSchema.safeParse({ type: 'claims:claim' }).success).toBe(false)
    expect(processRunOutcomeSchema.safeParse({ id: 'claim-9' }).success).toBe(false)
  })

  it('bounds every field to its column width', () => {
    expect(processRunOutcomeSchema.safeParse({ ...OUTCOME, type: 'x'.repeat(151) }).success).toBe(false)
    expect(processRunOutcomeSchema.safeParse({ ...OUTCOME, id: 'x'.repeat(201) }).success).toBe(false)
    expect(processRunOutcomeSchema.safeParse({ ...OUTCOME, label: 'x'.repeat(201) }).success).toBe(false)
  })

  it('does NOT pattern-bound `type` — storage accepts whatever a producing module declares', () => {
    expect(processRunOutcomeSchema.safeParse({ type: 'legacy-claim', id: 'claim-9' }).success).toBe(true)
  })
})

describe('reading the columns', () => {
  it('reads both the ORM casing and the raw list projection', () => {
    expect(readProcessRunOutcome({ outcomeType: 'claims:claim', outcomeId: 'claim-9', outcomeLabel: 'CASE-1' }))
      .toEqual({ type: 'claims:claim', id: 'claim-9', label: 'CASE-1' })
    expect(readProcessRunOutcome({ outcome_type: 'claims:claim', outcome_id: 'claim-9' }))
      .toEqual({ type: 'claims:claim', id: 'claim-9' })
  })

  it('returns null for a run that produced nothing — the normal case, not an error', () => {
    expect(readProcessRunOutcome(null)).toBeNull()
    expect(readProcessRunOutcome({})).toBeNull()
    expect(readProcessRunOutcome({ outcomeType: null, outcomeId: null, outcomeLabel: null })).toBeNull()
  })

  it('treats a half-written pair as no outcome at all', () => {
    expect(readProcessRunOutcome({ outcomeType: 'claims:claim' })).toBeNull()
    expect(readProcessRunOutcome({ outcomeId: 'claim-9' })).toBeNull()
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

type FakeRun = {
  id: string
  status: 'running' | 'completed' | 'failed'
  workflowInstanceId: string
  tenantId: string
  organizationId: string
  processDefinitionId: string
  targetType: string
  completedAt: Date | null
  failureReason: string | null
  outcomeType: string | null
  outcomeId: string | null
  outcomeLabel: string | null
}

function fakeRun(overrides: Partial<FakeRun> = {}): FakeRun {
  return {
    id: 'run-1',
    status: 'running',
    workflowInstanceId: 'instance-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    processDefinitionId: 'def-1',
    targetType: 'workflow',
    completedAt: null,
    failureReason: null,
    outcomeType: null,
    outcomeId: null,
    outcomeLabel: null,
    ...overrides,
  }
}

function fakeEm(run: FakeRun | null) {
  return { findOne: jest.fn().mockResolvedValue(run), flush: jest.fn().mockResolvedValue(undefined) }
}

function fakeResolver(instance: unknown) {
  return {
    resolve: jest.fn((name: string) => {
      if (name !== 'workflowExecutor') throw new Error(`[internal] unexpected token ${name}`)
      return { getWorkflowInstance: jest.fn().mockResolvedValue(instance) }
    }),
  }
}

const PAYLOAD = { id: 'instance-1', tenantId: 'tenant-1', organizationId: 'org-1' }

describe('the outcome is written ON COMPLETION, and is nullable', () => {
  it('stamps the three columns from the completed instance’s declared outcome', async () => {
    const run = fakeRun()
    const em = fakeEm(run)
    const resolver = fakeResolver({ tenantId: 'tenant-1', organizationId: 'org-1', context: { outcome: OUTCOME } })
    await resolveWorkflowProcessRun(em as never, PAYLOAD, 'completed', undefined, resolver as never)
    expect(run.status).toBe('completed')
    expect(run.outcomeType).toBe('claims:claim')
    expect(run.outcomeId).toBe('claim-9')
    expect(run.outcomeLabel).toBe('CASE-2026-04417')
  })

  it('leaves the columns NULL when the process produced nothing — a valid completion', async () => {
    const run = fakeRun()
    const em = fakeEm(run)
    const resolver = fakeResolver({ tenantId: 'tenant-1', organizationId: 'org-1', context: { findings: 3 } })
    await resolveWorkflowProcessRun(em as never, PAYLOAD, 'completed', undefined, resolver as never)
    expect(run.status).toBe('completed')
    expect(run.outcomeType).toBeNull()
    expect(run.outcomeId).toBeNull()
    expect(run.outcomeLabel).toBeNull()
  })

  it('writes NO outcome on a failed run — nothing was produced', async () => {
    const run = fakeRun()
    const em = fakeEm(run)
    const resolver = fakeResolver({ tenantId: 'tenant-1', organizationId: 'org-1', context: { outcome: OUTCOME } })
    await resolveWorkflowProcessRun(em as never, PAYLOAD, 'failed', undefined, resolver as never)
    expect(run.status).toBe('failed')
    expect(run.outcomeType).toBeNull()
  })

  it('completes with no outcome when the `workflows` peer is absent — never throws', async () => {
    const run = fakeRun()
    const em = fakeEm(run)
    const absent = { resolve: jest.fn(() => { throw new Error('[internal] module not registered') }) }
    await resolveWorkflowProcessRun(em as never, PAYLOAD, 'completed', undefined, absent as never)
    expect(run.status).toBe('completed')
    expect(run.outcomeType).toBeNull()
    await resolveWorkflowProcessRun(em as never, PAYLOAD, 'completed', undefined, null)
    expect(run.outcomeType).toBeNull()
  })

  it('refuses an instance whose own scope does not match the run’s', async () => {
    const run = fakeRun()
    const em = fakeEm(run)
    const foreign = fakeResolver({ tenantId: 'tenant-2', organizationId: 'org-1', context: { outcome: OUTCOME } })
    await resolveWorkflowProcessRun(em as never, PAYLOAD, 'completed', undefined, foreign as never)
    expect(run.status).toBe('completed')
    expect(run.outcomeType).toBeNull()
  })

  it('is idempotent — a redelivered event never re-stamps a terminal run', async () => {
    const run = fakeRun({ status: 'completed', outcomeType: 'claims:claim', outcomeId: 'claim-1' })
    const em = fakeEm(run)
    const resolver = fakeResolver({ tenantId: 'tenant-1', organizationId: 'org-1', context: { outcome: OUTCOME } })
    await resolveWorkflowProcessRun(em as never, PAYLOAD, 'completed', undefined, resolver as never)
    expect(run.outcomeId).toBe('claim-1')
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('the executor writes the agent target’s declared outcome', () => {
  const source = fs.readFileSync(path.join(MODULE_ROOT, 'workers', 'task-run-executor.ts'), 'utf8')

  it('reads it off a researcher result only — a proposal has produced nothing yet', () => {
    expect(source).toContain("result.kind === 'researcher' ? declaredOutcomeOf(result.data) : null")
  })

  it('stamps the columns only on a COMPLETED run', () => {
    expect(source).toContain("if (outcome.status === 'completed' && outcome.produced)")
  })
})

describe('the Phase 4 migration', () => {
  const migrationsDir = path.join(MODULE_ROOT, 'migrations')
  const migration = fs.readFileSync(
    path.join(migrationsDir, 'Migration20260811180000_agent_orchestrator.ts'),
    'utf8',
  )

  it('adds the three nullable columns and drops them again', () => {
    expect(migration).toContain(
      `alter table "agent_process_runs" add "outcome_type" varchar(150) null, add "outcome_id" varchar(200) null, add "outcome_label" varchar(200) null;`,
    )
    expect(migration).toContain(`drop column "outcome_type"`)
  })

  it('is its OWN file — the three committed migrations are untouched', () => {
    for (const committed of [
      'Migration20260811150000_agent_orchestrator.ts',
      'Migration20260811160000_agent_orchestrator.ts',
      'Migration20260811170000_agent_orchestrator.ts',
    ]) {
      expect(fs.readFileSync(path.join(migrationsDir, committed), 'utf8')).not.toContain('outcome_')
    }
  })

  it('ships the regenerated snapshot alongside it, with every column nullable', () => {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, '.snapshot-open-mercato.json'), 'utf8'),
    ) as { tables: Array<{ name: string; columns: Record<string, { type: string; nullable: boolean }> }> }
    const table = snapshot.tables.find((one) => one.name === 'agent_process_runs')
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

  it('keeps the reference PLAINTEXT, like agent_processes.subject_label', () => {
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
