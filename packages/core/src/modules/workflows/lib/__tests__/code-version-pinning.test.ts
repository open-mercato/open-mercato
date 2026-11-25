/**
 * Version pinning for code-defined workflows (#7184).
 *
 * The code registry retains every exported version of a workflow; new starts
 * use the highest version and an in-flight instance keeps resolving the
 * version it persisted at start (`instance.version`). Only trusted definition
 * pins (`allowRetainedCodeVersion`) may start a retained older version.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'

const mockLoggerInstance = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
mockLoggerInstance.child.mockImplementation(() => mockLoggerInstance)

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
}))

jest.mock('../../../business_rules/lib/rule-evaluator')
jest.mock('../../../business_rules/lib/rule-engine')

import {
  registerCodeWorkflows,
  clearCodeWorkflowRegistry,
  getCodeWorkflow,
  getCodeWorkflowVersion,
  getCodeWorkflowVersions,
  getAllCodeWorkflows,
  isCodeWorkflow,
} from '../code-registry'
import {
  codeWorkflowUuid,
  findWorkflowDefinition,
  findDefinitionForInstance,
  resolveCodeDefinitionForInstance,
} from '../find-definition'
import * as workflowExecutor from '../workflow-executor'

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'

function codeWorkflow(
  workflowId: string,
  version: number,
  pathStepId: string,
  overrides: Partial<CodeWorkflowDefinition> = {},
): CodeWorkflowDefinition {
  return {
    workflowId,
    workflowName: `${workflowId} v${version}`,
    description: null,
    version,
    enabled: true,
    metadata: null,
    moduleId: 'test_module',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: pathStepId, stepName: pathStepId, stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: `start_to_${pathStepId}`, fromStepId: 'start', toStepId: pathStepId, trigger: 'auto', priority: 0 },
        { transitionId: `${pathStepId}_to_end`, fromStepId: pathStepId, toStepId: 'end', trigger: 'auto', priority: 0 },
      ],
    },
    ...overrides,
  }
}

function warnCallsFor(workflowId: string) {
  return mockLoggerInstance.warn.mock.calls.filter(
    ([message, fields]) =>
      typeof message === 'string' &&
      message.startsWith('Pinned code workflow version is not registered') &&
      (fields as { workflowId?: string } | undefined)?.workflowId === workflowId,
  )
}

beforeEach(() => {
  clearCodeWorkflowRegistry()
  mockLoggerInstance.warn.mockClear()
})

describe('multi-version code registry', () => {
  test('a single-version workflow behaves exactly as before', () => {
    const v1 = codeWorkflow('reg.single', 1, 'only')
    registerCodeWorkflows([v1])

    expect(getCodeWorkflow('reg.single')).toBe(v1)
    expect(getCodeWorkflowVersion('reg.single', 1)).toBe(v1)
    expect(getCodeWorkflowVersions('reg.single')).toEqual([v1])
    expect(getAllCodeWorkflows()).toEqual([v1])
    expect(isCodeWorkflow('reg.single')).toBe(true)
  })

  test('two versions: latest wins for every unversioned read, both stay resolvable', () => {
    const v1 = codeWorkflow('reg.two', 1, 'path_v1')
    const v2 = codeWorkflow('reg.two', 2, 'path_v2')
    registerCodeWorkflows([v2, v1])

    expect(getCodeWorkflow('reg.two')).toBe(v2)
    expect(getAllCodeWorkflows()).toEqual([v2])
    expect(getCodeWorkflowVersion('reg.two', 1)).toBe(v1)
    expect(getCodeWorkflowVersion('reg.two', 2)).toBe(v2)
    expect(getCodeWorkflowVersion('reg.two', 3)).toBeUndefined()
    expect(getCodeWorkflowVersions('reg.two')).toEqual([v1, v2])
  })

  test('latest is the highest version regardless of its enabled flag', () => {
    const v1 = codeWorkflow('reg.disabled', 1, 'path_v1')
    const v2 = codeWorkflow('reg.disabled', 2, 'path_v2', { enabled: false })
    registerCodeWorkflows([v1, v2])

    expect(getCodeWorkflow('reg.disabled')).toBe(v2)
  })

  test('a duplicate (workflowId, version) within one module is last-wins without a warning', () => {
    const first = codeWorkflow('reg.dup', 1, 'first')
    const second = codeWorkflow('reg.dup', 1, 'second')
    registerCodeWorkflows([first])
    registerCodeWorkflows([second])

    expect(getCodeWorkflowVersion('reg.dup', 1)).toBe(second)
    expect(mockLoggerInstance.warn).not.toHaveBeenCalled()
  })

  test('another module contributing a version of an existing workflowId warns', () => {
    registerCodeWorkflows([codeWorkflow('reg.cross', 1, 'path_v1', { moduleId: 'module_a' })])
    registerCodeWorkflows([codeWorkflow('reg.cross', 2, 'path_v2', { moduleId: 'module_b' })])

    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      'Duplicate code workflow ID — overwriting',
      expect.objectContaining({ workflowId: 'reg.cross', version: 2, moduleId: 'module_b' }),
    )
    expect(getCodeWorkflowVersions('reg.cross').map((wf) => wf.version)).toEqual([1, 2])
  })

  test('a retained version that fails validation is dropped on its own', () => {
    const v1 = codeWorkflow('reg.invalid', 1, 'path_v1', { definition: { steps: [], transitions: [] } })
    const v2 = codeWorkflow('reg.invalid', 2, 'path_v2')
    registerCodeWorkflows([v1, v2])

    expect(getCodeWorkflowVersion('reg.invalid', 1)).toBeUndefined()
    expect(getCodeWorkflowVersions('reg.invalid')).toEqual([v2])
  })
})

describe('version-pinned definition resolution', () => {
  const instanceOf = (workflowId: string, version?: number) => ({
    definitionId: codeWorkflowUuid(workflowId),
    workflowId,
    tenantId,
    organizationId,
    ...(version === undefined ? {} : { version }),
  })

  const stepIds = (definition: { definition: { steps: Array<{ stepId: string }> } } | null) =>
    definition?.definition.steps.map((step) => step.stepId)

  test('an instance on v1 resolves v1 steps while v2 is latest', () => {
    registerCodeWorkflows([codeWorkflow('res.pin', 1, 'path_v1'), codeWorkflow('res.pin', 2, 'path_v2')])

    const resolved = resolveCodeDefinitionForInstance(instanceOf('res.pin', 1))

    expect(resolved?.version).toBe(1)
    expect(stepIds(resolved)).toContain('path_v1')
    expect(stepIds(resolved)).not.toContain('path_v2')
    expect(resolved?.id).toBe(codeWorkflowUuid('res.pin'))
    expect(warnCallsFor('res.pin')).toHaveLength(0)
  })

  test('findDefinitionForInstance passes the instance version through', async () => {
    registerCodeWorkflows([codeWorkflow('res.find', 1, 'path_v1'), codeWorkflow('res.find', 2, 'path_v2')])
    const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager

    const v1 = await findDefinitionForInstance(em, instanceOf('res.find', 1))
    const v2 = await findDefinitionForInstance(em, instanceOf('res.find', 2))

    expect(v1?.version).toBe(1)
    expect(v2?.version).toBe(2)
  })

  test('a new start resolves the latest version', async () => {
    registerCodeWorkflows([codeWorkflow('res.start', 1, 'path_v1'), codeWorkflow('res.start', 2, 'path_v2')])
    const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager

    const latest = await findWorkflowDefinition(em, { workflowId: 'res.start', tenantId, organizationId })

    expect(latest?.version).toBe(2)
    expect(stepIds(latest)).toContain('path_v2')
  })

  test('caller-supplied version input cannot select a retained older code version', async () => {
    registerCodeWorkflows([codeWorkflow('res.untrusted', 1, 'path_v1'), codeWorkflow('res.untrusted', 2, 'path_v2')])
    const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager

    const requested = await findWorkflowDefinition(em, { workflowId: 'res.untrusted', version: 1, tenantId, organizationId })

    expect(requested?.version).toBe(2)
    expect(stepIds(requested)).toContain('path_v2')
    expect(stepIds(requested)).not.toContain('path_v1')
  })

  test('a trusted definition pin still resolves the retained version', async () => {
    registerCodeWorkflows([codeWorkflow('res.trusted', 1, 'path_v1'), codeWorkflow('res.trusted', 2, 'path_v2')])
    const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager

    const pinned = await findWorkflowDefinition(em, {
      workflowId: 'res.trusted',
      version: 1,
      tenantId,
      organizationId,
      allowRetainedCodeVersion: true,
    })

    expect(pinned?.version).toBe(1)
    expect(stepIds(pinned)).toContain('path_v1')
  })

  test('an explicit version still selects a DB-defined row for untrusted callers', async () => {
    const dbRow = { id: 'db-row', workflowId: 'res.db', version: 1 }
    const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
      where.version === 1 ? dbRow : null)
    const em = { findOne } as unknown as EntityManager

    const resolved = await findWorkflowDefinition(em, { workflowId: 'res.db', version: 1, tenantId, organizationId })

    expect(resolved).toBe(dbRow)
    expect(findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workflowId: 'res.db', version: 1 }))
  })

  test('a missing pinned version falls back to the latest with a single warning per process', async () => {
    registerCodeWorkflows([codeWorkflow('res.missing', 2, 'path_v2')])
    const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager

    const fromInstance = resolveCodeDefinitionForInstance(instanceOf('res.missing', 1))
    const again = resolveCodeDefinitionForInstance(instanceOf('res.missing', 1))
    const fromTrustedPin = await findWorkflowDefinition(em, {
      workflowId: 'res.missing',
      version: 1,
      tenantId,
      organizationId,
      allowRetainedCodeVersion: true,
    })

    expect(fromInstance?.version).toBe(2)
    expect(again?.version).toBe(2)
    expect(fromTrustedPin?.version).toBe(2)
    const warnings = warnCallsFor('res.missing')
    expect(warnings).toHaveLength(1)
    expect(warnings[0][1]).toEqual({ workflowId: 'res.missing', requestedVersion: 1, resolvedVersion: 2 })
  })

  test('the missing-version warning state stays bounded by workflow, not by requested version', () => {
    registerCodeWorkflows([codeWorkflow('res.bounded', 2, 'path_v2')])

    for (let requested = 1000; requested < 1500; requested += 1) {
      expect(resolveCodeDefinitionForInstance(instanceOf('res.bounded', requested))?.version).toBe(2)
    }

    expect(warnCallsFor('res.bounded')).toHaveLength(1)
  })

  test('untrusted start input never reaches the missing-version warning', async () => {
    registerCodeWorkflows([codeWorkflow('res.quiet', 2, 'path_v2')])
    const em = { findOne: jest.fn(async () => null) } as unknown as EntityManager

    for (let requested = 1; requested <= 20; requested += 1) {
      const resolved = await findWorkflowDefinition(em, { workflowId: 'res.quiet', version: requested, tenantId, organizationId })
      expect(resolved?.version).toBe(2)
    }

    expect(warnCallsFor('res.quiet')).toHaveLength(0)
    resolveCodeDefinitionForInstance(instanceOf('res.quiet', 1))
    expect(warnCallsFor('res.quiet')).toHaveLength(1)
  })

  test('an instance without a version resolves the latest (narrow external callers)', () => {
    registerCodeWorkflows([codeWorkflow('res.noversion', 1, 'path_v1'), codeWorkflow('res.noversion', 2, 'path_v2')])

    const resolved = resolveCodeDefinitionForInstance(instanceOf('res.noversion'))

    expect(resolved?.version).toBe(2)
    expect(warnCallsFor('res.noversion')).toHaveLength(0)
  })

  test('the UUID gate still rejects foreign definition ids', () => {
    registerCodeWorkflows([codeWorkflow('res.gate', 1, 'path_v1')])

    const resolved = resolveCodeDefinitionForInstance({
      ...instanceOf('res.gate', 1),
      definitionId: '00000000-0000-4000-8000-0000000000ff',
    })

    expect(resolved).toBeNull()
  })

  test('a retained version resolves for in-flight instances even when disabled', () => {
    registerCodeWorkflows([
      codeWorkflow('res.oldisabled', 1, 'path_v1', { enabled: false }),
      codeWorkflow('res.oldisabled', 2, 'path_v2'),
    ])

    const resolved = resolveCodeDefinitionForInstance(instanceOf('res.oldisabled', 1))

    expect(resolved?.version).toBe(1)
    expect(resolved?.enabled).toBe(false)
  })
})

type Row = Record<string, unknown> & { id: string }

function createInMemoryEm() {
  const tables = new Map<string, Row[]>()
  const entityOf = new WeakMap<object, string>()
  const nameOf = (entity: unknown): string =>
    typeof entity === 'function' ? (entity as { name: string }).name : String(entity)
  const tableOf = (name: string): Row[] => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true
    return Object.entries(where).every(([key, expected]) => {
      if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
        const operators = expected as Record<string, unknown>
        if (Array.isArray(operators.$in)) return operators.$in.includes(row[key])
        if ('$ne' in operators) return row[key] !== operators.$ne
        return true
      }
      if (expected === null) return row[key] === null || row[key] === undefined
      return row[key] === expected
    })
  }
  const em: Record<string, unknown> = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      tableOf(nameOf(entity)).find((row) => matches(row, where)) ?? null),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      tableOf(nameOf(entity)).filter((row) => matches(row, where))),
    count: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      tableOf(nameOf(entity)).filter((row) => matches(row, where)).length),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { id: randomUUID(), ...data } as Row
      entityOf.set(row, nameOf(entity))
      return row
    }),
    persist: jest.fn((row: Row | Row[]) => {
      for (const item of Array.isArray(row) ? row : [row]) {
        const name = entityOf.get(item)
        if (!name) continue
        const table = tableOf(name)
        if (!table.includes(item)) table.push(item)
      }
      return em
    }),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      const rows = tableOf(nameOf(entity)).filter((row) => matches(row, where))
      for (const row of rows) Object.assign(row, data)
      return rows.length
    }),
    fork: jest.fn(() => em),
    transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(em)),
  }
  return { em: em as unknown as EntityManager, rows: (name: string) => tableOf(name) }
}

describe('executor regression: an in-flight instance follows its pinned version', () => {
  const container = { resolve: jest.fn(() => { throw new Error('not registered') }) } as unknown as AwilixContainer

  test('an instance started on v1 keeps following v1 after v2 is registered', async () => {
    registerCodeWorkflows([codeWorkflow('exec.pin', 1, 'path_v1')])
    const { em, rows } = createInMemoryEm()

    const pinned = await workflowExecutor.startWorkflow(em, { workflowId: 'exec.pin', tenantId, organizationId })
    expect(pinned.version).toBe(1)
    expect(pinned.definitionId).toBe(codeWorkflowUuid('exec.pin'))

    clearCodeWorkflowRegistry()
    registerCodeWorkflows([codeWorkflow('exec.pin', 1, 'path_v1'), codeWorkflow('exec.pin', 2, 'path_v2')])

    const result = await workflowExecutor.executeWorkflow(em, container, pinned.id)

    expect(result.status).toBe('COMPLETED')
    const enteredSteps = rows('StepInstance')
      .filter((row) => row.workflowInstanceId === pinned.id)
      .map((row) => row.stepId)
    expect(enteredSteps).toContain('path_v1')
    expect(enteredSteps).not.toContain('path_v2')
    expect(warnCallsFor('exec.pin')).toHaveLength(0)

    const fresh = await workflowExecutor.startWorkflow(em, { workflowId: 'exec.pin', tenantId, organizationId })
    expect(fresh.version).toBe(2)
    const freshResult = await workflowExecutor.executeWorkflow(em, container, fresh.id)
    expect(freshResult.status).toBe('COMPLETED')
    const freshSteps = rows('StepInstance')
      .filter((row) => row.workflowInstanceId === fresh.id)
      .map((row) => row.stepId)
    expect(freshSteps).toContain('path_v2')
    expect(freshSteps).not.toContain('path_v1')
  })

  test('a start with an explicit version runs the latest code version unless the pin is trusted', async () => {
    registerCodeWorkflows([codeWorkflow('exec.boundary', 1, 'path_v1'), codeWorkflow('exec.boundary', 2, 'path_v2')])
    const { em, rows } = createInMemoryEm()

    const requested = await workflowExecutor.startWorkflow(em, { workflowId: 'exec.boundary', version: 1, tenantId, organizationId })
    expect(requested.version).toBe(2)
    const requestedResult = await workflowExecutor.executeWorkflow(em, container, requested.id)
    expect(requestedResult.status).toBe('COMPLETED')
    const requestedSteps = rows('StepInstance')
      .filter((row) => row.workflowInstanceId === requested.id)
      .map((row) => row.stepId)
    expect(requestedSteps).toContain('path_v2')
    expect(requestedSteps).not.toContain('path_v1')

    const trusted = await workflowExecutor.startWorkflow(em, {
      workflowId: 'exec.boundary',
      version: 1,
      allowRetainedCodeVersion: true,
      tenantId,
      organizationId,
    })
    expect(trusted.version).toBe(1)
  })

  test('a single-version workflow runs unchanged', async () => {
    registerCodeWorkflows([codeWorkflow('exec.single', 1, 'only_step')])
    const { em, rows } = createInMemoryEm()

    const instance = await workflowExecutor.startWorkflow(em, { workflowId: 'exec.single', tenantId, organizationId })
    const result = await workflowExecutor.executeWorkflow(em, container, instance.id)

    expect(instance.version).toBe(1)
    expect(result.status).toBe('COMPLETED')
    expect(rows('StepInstance').map((row) => row.stepId)).toContain('only_step')
  })
})
