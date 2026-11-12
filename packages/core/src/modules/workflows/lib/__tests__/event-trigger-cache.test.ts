import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { EntityManager } from '@mikro-orm/core'

jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
  startWorkflow: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition, WorkflowEventTrigger } from '../../data/entities'
import { clearCodeWorkflowRegistry, registerCodeWorkflowEntries } from '@open-mercato/shared/modules/workflows/code-registry'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'

type TriggerService = typeof import('../event-trigger-service')
type DefinitionRow = {
  id: string
  workflowId: string
  version: number
  tenantId: string
  organizationId: string
  enabled: boolean
  deletedAt: Date | null
  lifecycle: 'published'
  definition: { triggers: Array<{ triggerId: string; name: string; eventPattern: string; enabled: boolean; priority: number }> }
}

const servicePath = require.resolve('../event-trigger-service')
const compiledService = ts.transpileModule(readFileSync(servicePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function independentRuntime(): TriggerService {
  const module = { exports: {} }
  const loadDependency = (id: string): unknown => require(id.startsWith('.') ? resolve(dirname(servicePath), id) : id)
  runInNewContext(compiledService, { module, exports: module.exports, require: loadDependency })
  return module.exports as TriggerService
}

function definition(id: string, tenantId = 'tenant-a', organizationId = 'org-a'): DefinitionRow {
  return {
    id,
    workflowId: id,
    version: 1,
    tenantId,
    organizationId,
    enabled: true,
    deletedAt: null,
    lifecycle: 'published',
    definition: {
      triggers: [{ triggerId: 'on-event', name: id, eventPattern: 'sales.order.created', enabled: true, priority: 0 }],
    },
  }
}

const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const em = {} as EntityManager
let rows: DefinitionRow[]

async function matched(service: TriggerService, tenantId = 'tenant-a', organizationId = 'org-a', eventName = 'sales.order.created') {
  const triggers = await service.findMatchingTriggers(em, { tenantId, organizationId, eventName, payload: {} })
  return triggers.map((trigger) => trigger.workflowId)
}

describe('trigger freshness across independent app and worker runtimes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearCodeWorkflowRegistry()
    rows = [definition('existing')]
    mockFind.mockImplementation((async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === WorkflowEventTrigger) return []
      if (entity !== WorkflowDefinition) throw new Error('[internal] Unexpected trigger source')
      return structuredClone(rows.filter((row) => row.tenantId === where.tenantId
        && row.organizationId === where.organizationId && row.deletedAt === null))
    }) as unknown as typeof findWithDecryption)
  })

  it('observes a trigger saved after the independent worker warmed its trigger list', async () => {
    const app = independentRuntime()
    const worker = independentRuntime()
    expect(app).not.toBe(worker)
    expect(await matched(worker)).toEqual(['existing'])
    expect(await matched(app)).toEqual(['existing'])

    rows.push(definition('saved-later'))
    app.invalidateTriggerCache('tenant-a', 'org-a')

    expect(await matched(worker)).toEqual(['existing', 'saved-later'])
  })

  it.each(['trigger disabled', 'definition disabled', 'deleted', 'pattern edited'] as const)(
    'stops matching in a warmed worker immediately after %s in the app', async (change) => {
      const app = independentRuntime()
      const worker = independentRuntime()
      expect(await matched(worker)).toEqual(['existing'])

      if (change === 'trigger disabled') rows[0].definition.triggers[0].enabled = false
      if (change === 'definition disabled') rows[0].enabled = false
      if (change === 'deleted') rows[0].deletedAt = new Date()
      if (change === 'pattern edited') rows[0].definition.triggers[0].eventPattern = 'sales.order.updated'
      app.invalidateTriggerCache('tenant-a', 'org-a')

      expect(await matched(worker)).toEqual([])
      if (change === 'pattern edited') {
        expect(await matched(worker, 'tenant-a', 'org-a', 'sales.order.updated')).toEqual(['existing'])
      }
    },
  )

  it('keeps fresh reads scoped to both tenant and organization', async () => {
    rows.push(definition('sibling-org', 'tenant-a', 'org-b'), definition('other-tenant', 'tenant-b', 'org-a'))
    const worker = independentRuntime()
    expect(await matched(worker)).toEqual(['existing'])
    expect(await matched(worker, 'tenant-a', 'org-b')).toEqual(['sibling-org'])
    expect(await matched(worker, 'tenant-b', 'org-a')).toEqual(['other-tenant'])

    rows.push(definition('saved-later'))
    independentRuntime().invalidateTriggerCache('tenant-a')

    expect(await matched(worker)).toEqual(['existing', 'saved-later'])
    expect(await matched(worker, 'tenant-a', 'org-b')).toEqual(['sibling-org'])
    expect(await matched(worker, 'tenant-b', 'org-a')).toEqual(['other-tenant'])
    for (const call of mockFind.mock.calls) {
      const where = call[2] as Record<string, unknown>
      expect(where).toEqual(expect.objectContaining({ tenantId: expect.any(String), organizationId: expect.any(String), deletedAt: null }))
      expect(call[3]).toEqual(expect.objectContaining({ refresh: true }))
      expect(call[4]).toEqual({ tenantId: where.tenantId, organizationId: where.organizationId })
    }
  })

  it('refreshes a managed definition instead of retaining the EntityManager snapshot', async () => {
    const managedSnapshot = structuredClone(rows)
    mockFind.mockImplementation((async (_em: unknown, entity: unknown, _where: unknown, options: { refresh?: boolean }) => {
      if (entity === WorkflowEventTrigger) return []
      return structuredClone(options.refresh ? rows : managedSnapshot)
    }) as unknown as typeof findWithDecryption)
    const worker = independentRuntime()
    expect(await matched(worker)).toEqual(['existing'])

    rows[0].definition.triggers[0].eventPattern = 'sales.order.updated'

    expect(await matched(worker)).toEqual([])
    expect(await matched(worker, 'tenant-a', 'org-a', 'sales.order.updated')).toEqual(['existing'])
  })

  it('retains legacy, embedded and code ordering and DB-over-code precedence on fresh loads', async () => {
    const legacy = {
      id: 'legacy-trigger',
      workflowDefinitionId: 'existing',
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      enabled: true,
      name: 'Legacy trigger',
      eventPattern: 'sales.order.created',
      priority: 20,
      config: null,
    }
    rows[0].definition.triggers[0].priority = 10
    mockFind.mockImplementation((async (_em: unknown, entity: unknown) =>
      structuredClone(entity === WorkflowEventTrigger ? [legacy] : rows)
    ) as unknown as typeof findWithDecryption)
    const codeDefinition = (workflowId: string): CodeWorkflowDefinition => ({
      workflowId,
      workflowName: workflowId,
      version: 1,
      moduleId: 'example',
      enabled: true,
      description: null,
      metadata: null,
      definition: { steps: [], transitions: [], triggers: [{ ...rows[0].definition.triggers[0], priority: 5 }] },
    })
    registerCodeWorkflowEntries([codeDefinition('existing'), codeDefinition('code-only')])
    const worker = independentRuntime()

    const triggers = await worker.loadTriggersForTenant(em, 'tenant-a', 'org-a')

    expect(triggers.map((trigger) => [trigger.source, trigger.workflowId, trigger.priority])).toEqual([
      ['legacy', 'existing', 20],
      ['embedded', 'existing', 10],
      ['code', 'code-only', 5],
    ])
  })

  it('refreshes separate module copies within a single process', async () => {
    const first = await import('../event-trigger-service')
    expect(await matched(first)).toEqual(['existing'])
    jest.resetModules()
    const second = await import('../event-trigger-service')
    rows.push(definition('saved-later'))
    second.invalidateTriggerCache('tenant-a', 'org-a')
    expect(await matched(first)).toEqual(['existing', 'saved-later'])
  })
})
