/**
 * Unit tests for workflow definition serializers.
 */

import { describe, test, expect, afterEach } from '@jest/globals'
import { WorkflowDefinition } from '../../data/entities'
import {
  serializeWorkflowDefinition,
  serializeCodeWorkflowDefinition,
} from '../definitions/serialize'
import {
  clearCodeWorkflowRegistry,
  registerCodeWorkflows,
} from '../../lib/code-registry'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflowDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  const def = new WorkflowDefinition()
  def.id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  def.workflowId = 'sales.order-approval'
  def.workflowName = 'Order Approval'
  def.description = 'Approves sales orders'
  def.version = 1
  def.enabled = true
  def.codeWorkflowId = null
  def.tenantId = 'tenant-1'
  def.organizationId = 'org-1'
  def.definition = { steps: [], transitions: [] } as any
  def.metadata = null
  def.effectiveFrom = null
  def.effectiveTo = null
  def.createdBy = null
  def.updatedBy = null
  def.createdAt = new Date('2024-06-01T00:00:00Z')
  def.updatedAt = new Date('2024-06-01T00:00:00Z')
  def.deletedAt = null
  Object.assign(def, overrides)
  return def
}

function makeCodeWorkflowDefinition(
  overrides: Partial<CodeWorkflowDefinition> = {},
): CodeWorkflowDefinition {
  return {
    workflowId: 'sales.order-approval',
    workflowName: 'Order Approval',
    description: null,
    version: 1,
    enabled: true,
    metadata: null,
    moduleId: 'sales_module',
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

// ---------------------------------------------------------------------------
// serializeWorkflowDefinition
// ---------------------------------------------------------------------------

describe('serializeWorkflowDefinition()', () => {
  test('returns source: "user" for a definition without codeWorkflowId', () => {
    const def = makeWorkflowDefinition({ codeWorkflowId: null })
    const result = serializeWorkflowDefinition(def)
    expect(result.source).toBe('user')
  })

  test('returns source: "code_override" for a definition with codeWorkflowId set', () => {
    const def = makeWorkflowDefinition({ codeWorkflowId: 'sales.order-approval' })
    const result = serializeWorkflowDefinition(def)
    expect(result.source).toBe('code_override')
  })

  test('returns isCodeBased: false for a user definition', () => {
    const def = makeWorkflowDefinition({ codeWorkflowId: null })
    const result = serializeWorkflowDefinition(def)
    expect(result.isCodeBased).toBe(false)
  })

  test('returns isCodeBased: true for a code_override definition', () => {
    const def = makeWorkflowDefinition({ codeWorkflowId: 'sales.order-approval' })
    const result = serializeWorkflowDefinition(def)
    expect(result.isCodeBased).toBe(true)
  })

  describe('codeModuleId resolution', () => {
    afterEach(() => {
      clearCodeWorkflowRegistry()
    })

    test('returns codeModuleId: null for a user-only definition', () => {
      const def = makeWorkflowDefinition({ codeWorkflowId: null })
      const result = serializeWorkflowDefinition(def)
      expect(result.codeModuleId).toBeNull()
    })

    test('looks up codeModuleId from the registry for a code_override', () => {
      registerCodeWorkflows([
        {
          workflowId: 'sales.order-approval',
          workflowName: 'Order Approval',
          description: null,
          version: 1,
          enabled: true,
          metadata: null,
          moduleId: 'my_sales_module',
          definition: {
            steps: [
              { stepId: 'start', stepName: 'Start', stepType: 'START' },
              { stepId: 'end', stepName: 'End', stepType: 'END' },
            ],
            transitions: [
              { transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' },
            ],
          },
        },
      ])

      const def = makeWorkflowDefinition({ codeWorkflowId: 'sales.order-approval' })
      const result = serializeWorkflowDefinition(def)
      expect(result.codeModuleId).toBe('my_sales_module')
    })

    test('returns codeModuleId: null when registry has no matching code workflow', () => {
      const def = makeWorkflowDefinition({ codeWorkflowId: 'sales.order-approval' })
      const result = serializeWorkflowDefinition(def)
      expect(result.codeModuleId).toBeNull()
    })
  })

  test('passes through entity fields correctly', () => {
    const now = new Date('2024-06-01T00:00:00Z')
    const def = makeWorkflowDefinition({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      workflowId: 'sales.order-approval',
      workflowName: 'Order Approval',
      description: 'Approves sales orders',
      version: 2,
      enabled: true,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      createdAt: now,
      updatedAt: now,
    })

    const result = serializeWorkflowDefinition(def)

    expect(result.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result.workflowId).toBe('sales.order-approval')
    expect(result.workflowName).toBe('Order Approval')
    expect(result.description).toBe('Approves sales orders')
    expect(result.version).toBe(2)
    expect(result.enabled).toBe(true)
    expect(result.tenantId).toBe('tenant-1')
    expect(result.organizationId).toBe('org-1')
    expect(result.createdAt).toBe(now)
    expect(result.updatedAt).toBe(now)
  })
})

// ---------------------------------------------------------------------------
// serializeCodeWorkflowDefinition
// ---------------------------------------------------------------------------

describe('serializeCodeWorkflowDefinition()', () => {
  const syntheticId = 'cccccccc-dddd-4eee-8fff-000000000000'

  test('returns source: "code"', () => {
    const codeDef = makeCodeWorkflowDefinition()
    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)
    expect(result.source).toBe('code')
  })

  test('returns isCodeBased: true', () => {
    const codeDef = makeCodeWorkflowDefinition()
    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)
    expect(result.isCodeBased).toBe(true)
  })

  test('passes through codeModuleId from the code definition', () => {
    const codeDef = makeCodeWorkflowDefinition({ moduleId: 'my_sales_module' })
    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)
    expect(result.codeModuleId).toBe('my_sales_module')
  })

  test('sets tenantId to null', () => {
    const codeDef = makeCodeWorkflowDefinition()
    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)
    expect(result.tenantId).toBeNull()
  })

  test('sets organizationId to null', () => {
    const codeDef = makeCodeWorkflowDefinition()
    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)
    expect(result.organizationId).toBeNull()
  })

  test('uses the provided syntheticId as the id field', () => {
    const codeDef = makeCodeWorkflowDefinition()
    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)
    expect(result.id).toBe(syntheticId)
  })

  test('passes through workflow fields from the code definition', () => {
    const codeDef = makeCodeWorkflowDefinition({
      workflowId: 'catalog.product-review',
      workflowName: 'Product Review',
      description: 'Review new products',
      version: 5,
      enabled: false,
      metadata: { tags: ['catalog'], category: 'review' },
    })

    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)

    expect(result.workflowId).toBe('catalog.product-review')
    expect(result.workflowName).toBe('Product Review')
    expect(result.description).toBe('Review new products')
    expect(result.version).toBe(5)
    expect(result.enabled).toBe(false)
    expect(result.metadata).toEqual({ tags: ['catalog'], category: 'review' })
  })

  test('sets all timestamp fields to null', () => {
    const codeDef = makeCodeWorkflowDefinition()
    const result = serializeCodeWorkflowDefinition(codeDef, syntheticId)

    expect(result.createdAt).toBeNull()
    expect(result.updatedAt).toBeNull()
    expect(result.deletedAt).toBeNull()
    expect(result.effectiveFrom).toBeNull()
    expect(result.effectiveTo).toBeNull()
  })
})
