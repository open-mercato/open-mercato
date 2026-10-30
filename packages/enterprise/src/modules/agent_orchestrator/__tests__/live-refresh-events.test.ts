/**
 * UX consistency pass, Area 1 — live-refresh coherence.
 *
 * (1) The run lifecycle events are clientBroadcast so the Traces list, an open
 *     trace detail, and the tasks list can live-update (the flag set is a
 *     contract surface: additive-only per BACKWARD_COMPATIBILITY.md).
 * (2) The tasks list route attaches a `last_run` projection per row (one
 *     grouped query, newest run per definition, tenant/org-scoped).
 * (3) Source-level invariants: the pages actually subscribe (coalesced), so
 *     the broadcast flags never regress into dead SSE traffic again.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventsConfig } from '../events'
import { attachLastExecutionProjection } from '../api/processes/route'

const MODULE_ROOT = path.resolve(__dirname, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(MODULE_ROOT, relativePath), 'utf8')
}

function eventById(id: string) {
  const event = eventsConfig.events.find((entry) => entry.id === id)
  if (!event) throw new Error(`event not declared: ${id}`)
  return event as { id: string; clientBroadcast?: boolean }
}

describe('run lifecycle broadcast flags (Area 1)', () => {
  it('run.completed and run.ingested are clientBroadcast', () => {
    expect(eventById('agent_orchestrator.run.completed').clientBroadcast).toBe(true)
    expect(eventById('agent_orchestrator.run.ingested').clientBroadcast).toBe(true)
  })

  it('keeps the pre-existing broadcast set intact', () => {
    for (const id of [
      'agent_orchestrator.proposal.created',
      'agent_orchestrator.proposal.disposed',
      'agent_orchestrator.proposal.ready',
      'agent_orchestrator.guardrail.tripped',
      'agent_orchestrator.process.execution.started',
      'agent_orchestrator.process.execution.completed',
      'agent_orchestrator.process.execution.failed',
      'agent_orchestrator.process.updated',
    ]) {
      expect(eventById(id).clientBroadcast).toBe(true)
    }
  })

  it('leaves non-broadcast lifecycle events alone (run.created, run.evaluated)', () => {
    expect(eventById('agent_orchestrator.run.created').clientBroadcast).toBeUndefined()
    expect(eventById('agent_orchestrator.run.evaluated').clientBroadcast).toBeUndefined()
  })
})

describe('process list last_execution projection', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  function makeEm(rows: Array<Record<string, unknown>>, calls: unknown[][] = []) {
    return {
      getConnection: () => ({
        execute: async (...args: unknown[]) => {
          calls.push(args)
          return rows
        },
      }),
    } as never
  }

  it('attaches the newest execution per definition and null when none exists', async () => {
    const finished = new Date('2026-07-12T10:00:00Z')
    const items: Array<Record<string, unknown>> = [
      { id: 'task-a', name: 'A' },
      { id: 'task-b', name: 'B' },
    ]
    const em = makeEm([
      { process_definition_id: 'task-a', status: 'failed', completed_at: finished },
    ])
    await attachLastExecutionProjection(em, scope, items)
    expect(items[0].last_execution).toEqual({ status: 'failed', completed_at: finished.toISOString() })
    expect(items[1].last_execution).toBeNull()
  })

  it('keeps completed_at null for an execution still in flight', async () => {
    const items: Array<Record<string, unknown>> = [{ id: 'task-a' }]
    const em = makeEm([{ process_definition_id: 'task-a', status: 'running', completed_at: null }])
    await attachLastExecutionProjection(em, scope, items)
    expect(items[0].last_execution).toEqual({ status: 'running', completed_at: null })
  })

  it('scopes the grouped query by tenant and organization', async () => {
    const calls: unknown[][] = []
    const items: Array<Record<string, unknown>> = [{ id: 'task-a' }]
    await attachLastExecutionProjection(makeEm([], calls), scope, items)
    expect(calls).toHaveLength(1)
    const [sql, params] = calls[0] as [string, unknown[]]
    expect(sql).toContain('distinct on (process_definition_id)')
    expect(sql).toContain('tenant_id = ?')
    expect(sql).toContain('organization_id = ?')
    // Ids bind as FLAT scalars (`in (?, ?)`), never as one array param —
    // the ORM's raw-execute layer expands array bindings per element, which
    // made the previous `= any(?)` reach Postgres as a malformed array literal.
    expect(sql).toContain('process_definition_id in (?)')
    expect(params).toEqual(['task-a', scope.tenantId, scope.organizationId])
  })

  it('skips the query entirely for an empty page', async () => {
    const calls: unknown[][] = []
    await attachLastExecutionProjection(makeEm([], calls), scope, [])
    expect(calls).toHaveLength(0)
  })
})

describe('page subscriptions (source invariants)', () => {
  it('traces list subscribes run.completed + run.ingested through the coalesced reload', () => {
    const source = readSource('backend/traces/page.tsx')
    expect(source).toContain("useAppEvent('agent_orchestrator.run.completed'")
    expect(source).toContain("useAppEvent('agent_orchestrator.run.ingested'")
    expect(source).toContain('useCoalescedReload')
  })

  it('trace detail subscribes both events filtered by the page run id', () => {
    const source = readSource('backend/traces/[id]/page.tsx')
    expect(source).toContain("useAppEvent(")
    expect(source).toContain("'agent_orchestrator.run.completed'")
    expect(source).toContain("'agent_orchestrator.run.ingested'")
    expect(source).toContain('event.payload?.id === runId')
    expect(source).toContain('useCoalescedReload')
  })

  it('process list subscribes process.execution.* and renders the last-execution column', () => {
    const source = readSource('backend/processes/definitions/page.tsx')
    expect(source).toContain("useAppEvent('agent_orchestrator.process.execution.*'")
    expect(source).toContain('useCoalescedReload')
    expect(source).toContain('agent_orchestrator.processDefinitions.list.col.lastExecution')
    expect(source).toContain('agent_orchestrator.processDefinitions.list.lastExecutionNever')
  })

  it('caseload listens to guardrail.tripped (the flag has a consumer)', () => {
    const source = readSource('backend/caseload/page.tsx')
    expect(source).toContain("useAppEvent('agent_orchestrator.guardrail.tripped'")
  })

  it('the last-execution i18n keys exist in every locale', () => {
    for (const locale of ['en', 'es', 'de', 'pl', 'ko']) {
      const catalog = JSON.parse(readSource(`i18n/${locale}.json`)) as Record<string, string>
      expect(catalog['agent_orchestrator.processDefinitions.list.col.lastExecution']).toBeTruthy()
      expect(catalog['agent_orchestrator.processDefinitions.list.lastExecutionNever']).toBeTruthy()
    }
  })
})
