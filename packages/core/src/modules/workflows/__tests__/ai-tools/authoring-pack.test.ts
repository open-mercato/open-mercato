/**
 * Unit tests for the `workflows.*` agent-authoring tool pack.
 *
 * The pack's whole value is that it does NOT reimplement the engine, so these
 * tests assert agreement with the surfaces it wraps — most importantly that
 * `validate_definition` returns exactly what the Studio's Problems-panel path
 * returns — plus the two safety invariants: writes never publish, and a foreign
 * definition is invisible rather than merely forbidden.
 */
import workflowsAiTools from '../../ai-tools'
import features from '../../acl'
import {
  WorkflowDefinition,
  WorkflowDefinitionDraft,
  type WorkflowDefinitionData,
} from '../../data/entities'
import { collectValidationIssues } from '../../lib/collect-validation-issues'
import { definitionToGraph, validateWorkflowGraph } from '../../lib/graph-utils'
import { workflowDefinitionDataSchema } from '../../data/validators'
import { collectActivityConfigWarnings } from '../../data/activity-config-warnings'

const knownFeatureIds = new Set(features.map((entry) => entry.id))

const ALL_FEATURES = [
  'workflows.definitions.view',
  'workflows.definitions.create',
  'workflows.definitions.edit',
  'workflows.definitions.test_run',
  'workflows.instances.view',
  'workflows.instances.create',
]

function findTool(name: string) {
  const tool = workflowsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool as unknown as {
    name: string
    requiredFeatures?: string[]
    isMutation?: boolean
    handler: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  }
}

const validDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'end', stepName: 'Done', stepType: 'END' },
  ],
  transitions: [
    {
      transitionId: 'start_to_end',
      transitionName: 'Go',
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'auto',
      priority: 100,
    },
  ],
} as unknown as WorkflowDefinitionData

/** No START step: a graph error the zod schema alone does NOT catch. */
const graphInvalidDefinition = {
  steps: [
    { stepId: 'middle', stepName: 'Middle', stepType: 'AUTOMATED' },
    { stepId: 'end', stepName: 'Done', stepType: 'END' },
  ],
  transitions: [
    {
      transitionId: 'middle_to_end',
      transitionName: 'Go',
      fromStepId: 'middle',
      toStepId: 'end',
      trigger: 'auto',
      priority: 100,
    },
  ],
} as unknown as WorkflowDefinitionData

type Row = Record<string, unknown>

/**
 * An EntityManager fake that actually FILTERS by the supplied where clause, so
 * "tenant scoping" is proven by the row being unreachable rather than by
 * asserting a call argument.
 */
function makeEm(seed: { definitions?: Row[]; drafts?: Row[] } = {}) {
  const tables = new Map<unknown, Row[]>([
    [WorkflowDefinition, [...(seed.definitions ?? [])]],
    [WorkflowDefinitionDraft, [...(seed.drafts ?? [])]],
  ])
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (expected === null) return row[key] === null || row[key] === undefined
      if (expected && typeof expected === 'object' && '$in' in (expected as Row)) {
        return ((expected as { $in: unknown[] }).$in ?? []).includes(row[key])
      }
      return row[key] === expected
    })

  const persisted: Row[] = []
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      return (tables.get(entity) ?? []).find((row) => matches(row, where)) ?? null
    }),
    find: jest.fn(async (entity: unknown, where: Row) =>
      (tables.get(entity) ?? []).filter((row) => matches(row, where)),
    ),
    create: jest.fn((entity: unknown, data: Row) => {
      const row = { id: `generated-${persisted.length + 1}`, ...data, __entity: entity }
      return row
    }),
    persist: jest.fn((row: Row) => {
      persisted.push(row)
      const entity = row.__entity
      tables.get(entity)?.push(row)
      return em
    }),
    flush: jest.fn(async () => undefined),
    persisted,
    tables,
  }
  return em
}

function makeCtx(
  overrides: Partial<{
    tenantId: string | null
    organizationId: string | null
    userId: string | null
    userFeatures: string[]
    isSuperAdmin: boolean
    em: ReturnType<typeof makeEm>
    workflowExecutor: Record<string, unknown>
  }> = {},
) {
  const em = overrides.em ?? makeEm()
  const workflowExecutor = overrides.workflowExecutor ?? {
    startWorkflow: jest.fn(async () => ({ id: 'instance-1', status: 'RUNNING' })),
    executeWorkflow: jest.fn(async () => undefined),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'workflowExecutor') return workflowExecutor
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    userFeatures: [...ALL_FEATURES],
    isSuperAdmin: false,
    container,
    em,
    workflowExecutor,
    ...overrides,
  }
}

describe('workflows AI tool pack — declaration', () => {
  it('ships exactly the tools the spec names', () => {
    expect(workflowsAiTools.map((tool) => tool.name).sort()).toEqual([
      'workflows.create_definition',
      'workflows.get_context_schema',
      'workflows.list_activity_types',
      'workflows.start_test_run',
      'workflows.update_definition',
      'workflows.validate_definition',
      'workflows.validate_workflow_definition',
    ])
  })

  it('gates every tool on EXISTING workflows.* acl features', () => {
    for (const tool of workflowsAiTools) {
      const required = (tool as { requiredFeatures?: string[] }).requiredFeatures ?? []
      expect(required.length).toBeGreaterThan(0)
      for (const feature of required) expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('marks the three writing tools as mutations and the three reads as not', () => {
    const mutations = workflowsAiTools
      .filter((tool) => (tool as { isMutation?: boolean }).isMutation)
      .map((tool) => tool.name)
      .sort()
    expect(mutations).toEqual([
      'workflows.create_definition',
      'workflows.start_test_run',
      'workflows.update_definition',
    ])
  })

  it('requires definitions.test_run ON TOP of instances.create to start a dry run', () => {
    expect(findTool('workflows.start_test_run').requiredFeatures).toEqual(
      expect.arrayContaining(['workflows.instances.create', 'workflows.definitions.test_run']),
    )
  })
})

describe('workflows.list_activity_types', () => {
  const tool = findTool('workflows.list_activity_types')

  it('returns the registry with JSON-Schema config contracts', async () => {
    const result = await tool.handler({}, makeCtx())
    expect(result.ok).toBe(true)
    const types = result.activityTypes as Array<Record<string, unknown>>
    expect(types.length).toBeGreaterThan(0)
    const updateEntity = types.find((entry) => entry.id === 'UPDATE_ENTITY')
    expect(updateEntity).toBeDefined()
    expect(updateEntity!.configSchema).toBeTruthy()
    expect(updateEntity).toHaveProperty('dryRunMock')
  })

  it('refuses without workflows.definitions.view', async () => {
    const result = await tool.handler({}, makeCtx({ userFeatures: [] }))
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('insufficient_permissions')
  })

  it('answers a structured issue for an unknown activity type', async () => {
    const result = await tool.handler({ activityType: 'NOPE' }, makeCtx())
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('unknown_activity_type')
  })
})

describe('workflows.get_context_schema', () => {
  const tool = findTool('workflows.get_context_schema')

  const definitionRow = {
    id: 'def-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    deletedAt: null,
    definition: validDefinition,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }

  it('serves the per-step ledger for a definition in the caller tenant', async () => {
    const ctx = makeCtx({ em: makeEm({ definitions: [definitionRow] }) })
    const result = await tool.handler({ definitionId: 'def-1' }, ctx)
    expect(result.ok).toBe(true)
    expect(Object.keys(result.steps as Record<string, unknown>).sort()).toEqual(['end', 'start'])
  })

  it('narrows to one step and 404s an unknown step', async () => {
    const ctx = makeCtx({ em: makeEm({ definitions: [definitionRow] }) })
    const ok = await tool.handler({ definitionId: 'def-1', stepId: 'end' }, ctx)
    expect(Object.keys(ok.steps as Record<string, unknown>)).toEqual(['end'])
    const miss = await tool.handler({ definitionId: 'def-1', stepId: 'ghost' }, ctx)
    expect(miss.ok).toBe(false)
    expect((miss.issues as Array<{ code: string }>)[0].code).toBe('not_found')
  })

  it('makes a foreign-tenant definition INVISIBLE, not merely unauthorized', async () => {
    const foreign = { ...definitionRow, id: 'def-foreign', tenantId: 'tenant-2' }
    const ctx = makeCtx({ em: makeEm({ definitions: [foreign] }) })
    const result = await tool.handler({ definitionId: 'def-foreign' }, ctx)
    expect(result.ok).toBe(false)
    const issues = result.issues as Array<{ code: string }>
    expect(issues[0].code).toBe('not_found')
    expect(issues[0].code).not.toBe('insufficient_permissions')
  })

  it('refuses without workflows.definitions.view', async () => {
    const ctx = makeCtx({ em: makeEm({ definitions: [definitionRow] }), userFeatures: [] })
    const result = await tool.handler({ definitionId: 'def-1' }, ctx)
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('insufficient_permissions')
  })
})

describe('workflows.validate_definition', () => {
  const tool = findTool('workflows.validate_definition')

  it('passes a well-formed definition', async () => {
    const result = await tool.handler({ definition: validDefinition }, makeCtx())
    expect(result.ok).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.errorCount).toBe(0)
  })

  it('AGREES with the Problems-panel path on a deliberately invalid definition', async () => {
    const result = await tool.handler({ definition: graphInvalidDefinition }, makeCtx())
    expect(result.ok).toBe(false)
    expect(result.errorCount).toBeGreaterThan(0)

    // Recompute the panel's own recipe independently and demand identity.
    const { nodes, edges } = definitionToGraph(graphInvalidDefinition, { autoLayout: false })
    const parsed = workflowDefinitionDataSchema.safeParse(graphInvalidDefinition)
    const expected = collectValidationIssues({
      graphErrors: validateWorkflowGraph(nodes, edges),
      zodIssues: parsed.success ? [] : parsed.error.issues,
      configWarnings: [...collectActivityConfigWarnings(graphInvalidDefinition)],
      nodes,
      edges,
      definition: graphInvalidDefinition,
    })
    expect(result.problems).toEqual(expected)
    expect(expected.some((entry) => /START/i.test(entry.message))).toBe(true)
  })

  it('returns structured issues (never prose) for malformed JSON', async () => {
    const result = await tool.handler({ definition: { steps: 'nope' } }, makeCtx())
    expect(result.ok).toBe(false)
    const issues = result.issues as Array<Record<string, unknown>>
    expect(issues.length).toBeGreaterThan(0)
    for (const entry of issues) {
      expect(Array.isArray(entry.path)).toBe(true)
      expect(typeof entry.code).toBe('string')
      expect(typeof entry.message).toBe('string')
    }
  })

  it('rejects supplying both or neither input', async () => {
    const both = await tool.handler(
      { definition: validDefinition, definitionId: 'def-1' },
      makeCtx(),
    )
    expect(both.ok).toBe(false)
    const neither = await tool.handler({}, makeCtx())
    expect(neither.ok).toBe(false)
  })

  it('refuses without workflows.definitions.view', async () => {
    const result = await tool.handler({ definition: validDefinition }, makeCtx({ userFeatures: [] }))
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('insufficient_permissions')
  })
})

describe('workflows.create_definition', () => {
  const tool = findTool('workflows.create_definition')

  const input = {
    workflowId: 'agent.authored',
    workflowName: 'Agent authored',
    definition: validDefinition,
  }

  it('creates the definition DISABLED — an agent write never publishes', async () => {
    const ctx = makeCtx()
    const result = await tool.handler(input, ctx)
    expect(result.ok).toBe(true)
    expect(result.enabled).toBe(false)
    expect(result.published).toBe(false)

    const created = ctx.em.persisted.find((row) => row.__entity === WorkflowDefinition)
    expect(created).toBeDefined()
    // The engine refuses to resolve a disabled definition for execution.
    expect(created!.enabled).toBe(false)
    expect(created!.tenantId).toBe('tenant-1')
    // Nothing may set the row to the published lifecycle from this path.
    expect(created!.lifecycle).toBeUndefined()
  })

  it('returns the route-identical structured body for an invalid definition', async () => {
    const result = await tool.handler({ ...input, definition: { steps: [] } }, makeCtx())
    expect(result.ok).toBe(false)
    const issues = result.issues as Array<Record<string, unknown>>
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toHaveProperty('path')
    expect(issues[0]).toHaveProperty('code')
  })

  it('refuses a duplicate workflowId in the same tenant', async () => {
    const ctx = makeCtx({
      em: makeEm({
        definitions: [{ id: 'def-1', workflowId: 'agent.authored', tenantId: 'tenant-1', version: 1 }],
      }),
    })
    const result = await tool.handler(input, ctx)
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('already_exists')
  })

  it('refuses without workflows.definitions.create', async () => {
    const ctx = makeCtx({ userFeatures: ['workflows.definitions.view'] })
    const result = await tool.handler(input, ctx)
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('insufficient_permissions')
    expect(ctx.em.persisted).toHaveLength(0)
  })
})

describe('workflows.update_definition', () => {
  const tool = findTool('workflows.update_definition')

  const definitionUpdatedAt = new Date('2026-01-01T00:00:00.000Z')
  const definitionRow = {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    deletedAt: null,
    definition: validDefinition,
    updatedAt: definitionUpdatedAt,
    enabled: true,
  }
  const input = {
    definitionId: definitionRow.id,
    definition: validDefinition,
  }

  it('writes a per-user DRAFT and never touches the definition or its lock', async () => {
    const ctx = makeCtx({ em: makeEm({ definitions: [definitionRow] }) })
    const result = await tool.handler(input, ctx)

    expect(result.ok).toBe(true)
    expect(result.published).toBe(false)

    const draft = ctx.em.persisted.find((row) => row.__entity === WorkflowDefinitionDraft)
    expect(draft).toBeDefined()
    expect(draft!.userId).toBe('user-1')
    expect(draft!.tenantId).toBe('tenant-1')
    expect(draft!.definitionId).toBe(definitionRow.id)

    // The definition row is untouched: same object, same optimistic-lock token.
    expect(ctx.em.persisted.some((row) => row.__entity === WorkflowDefinition)).toBe(false)
    expect(definitionRow.updatedAt).toBe(definitionUpdatedAt)
    expect(definitionRow.enabled).toBe(true)
    expect(definitionRow.definition).toBe(validDefinition)
  })

  it('updates an existing draft in place rather than creating a second one', async () => {
    const existing = {
      id: 'draft-1',
      definitionId: definitionRow.id,
      userId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      definition: { steps: [], transitions: [] },
      deletedAt: new Date(),
    }
    const ctx = makeCtx({ em: makeEm({ definitions: [definitionRow], drafts: [existing] }) })
    const result = await tool.handler(input, ctx)
    expect(result.draftId).toBe('draft-1')
    expect(existing.deletedAt).toBeNull()
    expect(ctx.em.persisted).toHaveLength(0)
  })

  it('makes a foreign-tenant definition INVISIBLE', async () => {
    const foreign = { ...definitionRow, tenantId: 'tenant-2' }
    const ctx = makeCtx({ em: makeEm({ definitions: [foreign] }) })
    const result = await tool.handler(input, ctx)
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('not_found')
    expect(ctx.em.persisted).toHaveLength(0)
  })

  it('refuses without a user context — a draft is a per-user review copy', async () => {
    const ctx = makeCtx({ em: makeEm({ definitions: [definitionRow] }), userId: null })
    const result = await tool.handler(input, ctx)
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('missing_user_context')
  })

  it('refuses without workflows.definitions.edit', async () => {
    const ctx = makeCtx({
      em: makeEm({ definitions: [definitionRow] }),
      userFeatures: ['workflows.definitions.view'],
    })
    const result = await tool.handler(input, ctx)
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('insufficient_permissions')
    expect(ctx.em.persisted).toHaveLength(0)
  })
})

describe('workflows.start_test_run', () => {
  const tool = findTool('workflows.start_test_run')

  const definitionRow = {
    id: 'def-1',
    workflowId: 'agent.authored',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    deletedAt: null,
    enabled: true,
    lifecycle: 'published',
    version: 1,
    definition: validDefinition,
  }

  it('ALWAYS forces isDryRun — there is no way to make the run real', async () => {
    const ctx = makeCtx({ em: makeEm({ definitions: [definitionRow] }) })
    const result = await tool.handler(
      { workflowId: 'agent.authored', initialContext: { orderId: 'o-1' } },
      ctx,
    )

    expect(result.ok).toBe(true)
    expect(result.isDryRun).toBe(true)
    const startWorkflow = ctx.workflowExecutor.startWorkflow as jest.Mock
    expect(startWorkflow).toHaveBeenCalledTimes(1)
    const options = startWorkflow.mock.calls[0][1] as Record<string, unknown>
    expect(options.isDryRun).toBe(true)
    expect(options.tenantId).toBe('tenant-1')
    expect(options.organizationId).toBe('org-1')
  })

  it('makes a foreign-tenant workflow INVISIBLE and starts nothing', async () => {
    const ctx = makeCtx({
      em: makeEm({ definitions: [{ ...definitionRow, tenantId: 'tenant-2' }] }),
    })
    const result = await tool.handler({ workflowId: 'agent.authored' }, ctx)
    expect(result.ok).toBe(false)
    expect((result.issues as Array<{ code: string }>)[0].code).toBe('not_found')
    expect(ctx.workflowExecutor.startWorkflow as jest.Mock).not.toHaveBeenCalled()
  })

  it('refuses without workflows.definitions.test_run even with instances.create', async () => {
    const ctx = makeCtx({
      em: makeEm({ definitions: [definitionRow] }),
      userFeatures: ['workflows.instances.view', 'workflows.instances.create'],
    })
    const result = await tool.handler({ workflowId: 'agent.authored' }, ctx)
    expect(result.ok).toBe(false)
    const issues = result.issues as Array<{ code: string; message: string }>
    expect(issues[0].code).toBe('insufficient_permissions')
    expect(issues[0].message).toContain('workflows.definitions.test_run')
    expect(ctx.workflowExecutor.startWorkflow as jest.Mock).not.toHaveBeenCalled()
  })
})
