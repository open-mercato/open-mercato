/**
 * Unit tests for the unified workflow definition lookup helper.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'
import { EntityManager } from '@mikro-orm/core'
import { WorkflowDefinition } from '../../data/entities'
import { codeWorkflowUuid, findWorkflowDefinition } from '../find-definition'
import { registerCodeWorkflows, clearCodeWorkflowRegistry } from '../code-registry'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCodeDef(overrides: Partial<CodeWorkflowDefinition> = {}): CodeWorkflowDefinition {
  return {
    workflowId: 'test.workflow',
    workflowName: 'Test Workflow',
    description: 'A test workflow',
    version: 1,
    enabled: true,
    metadata: null,
    moduleId: 'test_module',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' },
      ],
    },
    ...overrides,
  }
}

function makeDbDef(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  const def = new WorkflowDefinition()
  def.id = 'db-uuid-1111-2222-3333-444444444444'
  def.workflowId = 'test.workflow'
  def.workflowName = 'DB Workflow'
  def.description = null
  def.version = 1
  def.enabled = true
  def.codeWorkflowId = null
  def.tenantId = 'tenant-1'
  def.organizationId = 'org-1'
  def.definition = { steps: [], transitions: [] } as any
  def.metadata = null
  def.createdAt = new Date('2024-01-01')
  def.updatedAt = new Date('2024-01-01')
  Object.assign(def, overrides)
  return def
}

// ---------------------------------------------------------------------------
// codeWorkflowUuid
// ---------------------------------------------------------------------------

describe('codeWorkflowUuid()', () => {
  test('returns a valid UUID v4 format string', () => {
    const uuid = codeWorkflowUuid('my.workflow')
    // RFC 4122 UUID pattern: 8-4-4-4-12 hex chars
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('is deterministic — same input produces same output', () => {
    const first = codeWorkflowUuid('sales.order-approval')
    const second = codeWorkflowUuid('sales.order-approval')
    expect(first).toBe(second)
  })

  test('different workflowIds produce different UUIDs', () => {
    const a = codeWorkflowUuid('workflow.alpha')
    const b = codeWorkflowUuid('workflow.beta')
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// findWorkflowDefinition
// ---------------------------------------------------------------------------

describe('findWorkflowDefinition()', () => {
  let mockEm: jest.Mocked<Pick<EntityManager, 'findOne'>>

  const baseOptions = {
    workflowId: 'test.workflow',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  beforeEach(() => {
    clearCodeWorkflowRegistry()
    mockEm = { findOne: jest.fn() } as any
  })

  test('returns DB definition when found', async () => {
    const dbDef = makeDbDef()
    mockEm.findOne.mockResolvedValue(dbDef as any)

    const result = await findWorkflowDefinition(mockEm as any, baseOptions)

    expect(result).toBe(dbDef)
    expect(mockEm.findOne).toHaveBeenCalledTimes(1)
  })

  test('falls back to code registry when DB returns null', async () => {
    mockEm.findOne.mockResolvedValue(null)
    registerCodeWorkflows([makeCodeDef()])

    const result = await findWorkflowDefinition(mockEm as any, baseOptions)

    expect(result).not.toBeNull()
    expect(result?.workflowId).toBe('test.workflow')
    expect(result?.workflowName).toBe('Test Workflow')
    expect(result?.codeWorkflowId).toBe('test.workflow')
  })

  test('returns null when neither DB nor code registry has the workflow', async () => {
    mockEm.findOne.mockResolvedValue(null)

    const result = await findWorkflowDefinition(mockEm as any, baseOptions)

    expect(result).toBeNull()
  })

  test('DB result takes priority over code registry', async () => {
    registerCodeWorkflows([makeCodeDef({ workflowName: 'Code Version' })])
    const dbDef = makeDbDef({ workflowName: 'DB Version' })
    mockEm.findOne.mockResolvedValue(dbDef as any)

    const result = await findWorkflowDefinition(mockEm as any, baseOptions)

    expect(result?.workflowName).toBe('DB Version')
  })

  test('virtual definition from code registry has correct fields', async () => {
    mockEm.findOne.mockResolvedValue(null)
    const codeDef = makeCodeDef({
      workflowId: 'test.workflow',
      workflowName: 'Code Workflow',
      description: 'A code-based workflow',
      version: 3,
      enabled: true,
      metadata: { tags: ['sales'], category: 'approval' },
    })
    registerCodeWorkflows([codeDef])

    const result = await findWorkflowDefinition(mockEm as any, baseOptions)

    expect(result).not.toBeNull()
    expect(result?.id).toBe(codeWorkflowUuid('test.workflow'))
    expect(result?.workflowId).toBe('test.workflow')
    expect(result?.workflowName).toBe('Code Workflow')
    expect(result?.description).toBe('A code-based workflow')
    expect(result?.version).toBe(3)
    expect(result?.enabled).toBe(true)
    expect(result?.codeWorkflowId).toBe('test.workflow')
    expect(result?.tenantId).toBe('tenant-1')
    expect(result?.organizationId).toBe('org-1')
    expect(result?.metadata).toEqual({ tags: ['sales'], category: 'approval' })
    expect(result?.createdAt).toEqual(new Date(0))
    expect(result?.updatedAt).toEqual(new Date(0))
  })

  test('queries DB with enabled:true and DESC version order when no version specified', async () => {
    mockEm.findOne.mockResolvedValue(null)

    await findWorkflowDefinition(mockEm as any, baseOptions)

    expect(mockEm.findOne).toHaveBeenCalledWith(
      WorkflowDefinition,
      expect.objectContaining({ enabled: true }),
      expect.objectContaining({ orderBy: { version: 'DESC' } }),
    )
  })

  test('queries DB with exact version when version is specified', async () => {
    mockEm.findOne.mockResolvedValue(null)

    await findWorkflowDefinition(mockEm as any, { ...baseOptions, version: 2 })

    expect(mockEm.findOne).toHaveBeenCalledWith(
      WorkflowDefinition,
      expect.objectContaining({ version: 2 }),
    )
  })
})
