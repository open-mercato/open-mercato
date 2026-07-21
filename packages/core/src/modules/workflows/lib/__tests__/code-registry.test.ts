import { describe, test, expect, beforeEach, jest } from '@jest/globals'
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

import {
  registerCodeWorkflows,
  getCodeWorkflow,
  getAllCodeWorkflows,
  isCodeWorkflow,
  clearCodeWorkflowRegistry,
} from '../code-registry'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeWorkflow = (
  workflowId: string,
  moduleId = 'test-module',
): CodeWorkflowDefinition => ({
  workflowId,
  workflowName: `Workflow ${workflowId}`,
  description: null,
  version: 1,
  enabled: true,
  metadata: null,
  moduleId,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      {
        transitionId: 'start-to-end',
        fromStepId: 'start',
        toStepId: 'end',
        trigger: 'auto',
        priority: 0,
      },
    ],
  },
})

const invalidWorkflow = (workflowId: string): CodeWorkflowDefinition => ({
  workflowId,
  workflowName: 'Invalid',
  description: null,
  version: 1,
  enabled: true,
  metadata: null,
  moduleId: 'test-module',
  definition: {
    // Fails min(2) steps and min(1) transitions
    steps: [],
    transitions: [],
  },
})

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Code Workflow Registry', () => {
  beforeEach(() => {
    clearCodeWorkflowRegistry()
    jest.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // registerCodeWorkflows
  // -------------------------------------------------------------------------

  describe('registerCodeWorkflows', () => {
    test('registers valid workflows and makes them retrievable', () => {
      const wf1 = makeWorkflow('order-approval')
      const wf2 = makeWorkflow('customer-onboarding')

      registerCodeWorkflows([wf1, wf2])

      expect(getCodeWorkflow('order-approval')).toEqual(wf1)
      expect(getCodeWorkflow('customer-onboarding')).toEqual(wf2)
    })

    test('warns and skips workflows that fail Zod validation', () => {
      mockLoggerInstance.warn.mockClear()
      const bad = invalidWorkflow('bad-workflow')
      const good = makeWorkflow('good-workflow')

      registerCodeWorkflows([bad, good])

      expect(mockLoggerInstance.warn).toHaveBeenCalledTimes(1)
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        'Code workflow failed validation',
        expect.objectContaining({ workflowId: 'bad-workflow' }),
      )
      expect(getCodeWorkflow('bad-workflow')).toBeUndefined()
      expect(getCodeWorkflow('good-workflow')).toEqual(good)
    })

    test('warns on duplicate workflowId but overwrites with the later entry', () => {
      mockLoggerInstance.warn.mockClear()
      const first = makeWorkflow('my-workflow', 'module-a')
      const second = makeWorkflow('my-workflow', 'module-b')

      registerCodeWorkflows([first])
      registerCodeWorkflows([second])

      expect(mockLoggerInstance.warn).toHaveBeenCalledTimes(1)
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        'Duplicate code workflow ID — overwriting',
        expect.objectContaining({ workflowId: 'my-workflow', moduleId: 'module-b' }),
      )
      expect(getCodeWorkflow('my-workflow')).toEqual(second)
    })

    test('rejects workflows with invalid inline transition conditions', () => {
      const invalidCondition = makeWorkflow('invalid-condition')
      Object.assign(invalidCondition.definition.transitions[0], { condition: {
        field: 'invoice.action',
        operator: 'equals',
        value: 'approve',
      } })

      registerCodeWorkflows([invalidCondition])

      expect(getCodeWorkflow('invalid-condition')).toBeUndefined()
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        'Code workflow failed validation',
        expect.objectContaining({ workflowId: 'invalid-condition' }),
      )
    })

    test('handles empty array without errors', () => {
      expect(() => registerCodeWorkflows([])).not.toThrow()
      expect(getAllCodeWorkflows()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getCodeWorkflow
  // -------------------------------------------------------------------------

  describe('getCodeWorkflow', () => {
    test('returns registered workflow by workflowId', () => {
      const wf = makeWorkflow('fetch-me')
      registerCodeWorkflows([wf])

      expect(getCodeWorkflow('fetch-me')).toBe(wf)
    })

    test('returns undefined for unknown workflowId', () => {
      expect(getCodeWorkflow('does-not-exist')).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // getAllCodeWorkflows
  // -------------------------------------------------------------------------

  describe('getAllCodeWorkflows', () => {
    test('returns all registered workflows', () => {
      const wf1 = makeWorkflow('wf-one')
      const wf2 = makeWorkflow('wf-two')
      registerCodeWorkflows([wf1, wf2])

      const all = getAllCodeWorkflows()
      expect(all).toHaveLength(2)
      expect(all).toEqual(expect.arrayContaining([wf1, wf2]))
    })

    test('returns empty array when registry is empty', () => {
      expect(getAllCodeWorkflows()).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // isCodeWorkflow
  // -------------------------------------------------------------------------

  describe('isCodeWorkflow', () => {
    test('returns true for registered workflowId', () => {
      registerCodeWorkflows([makeWorkflow('exists')])

      expect(isCodeWorkflow('exists')).toBe(true)
    })

    test('returns false for unknown workflowId', () => {
      expect(isCodeWorkflow('not-registered')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // clearCodeWorkflowRegistry
  // -------------------------------------------------------------------------

  describe('clearCodeWorkflowRegistry', () => {
    test('clears all entries from the registry', () => {
      registerCodeWorkflows([makeWorkflow('wf-a'), makeWorkflow('wf-b')])
      expect(getAllCodeWorkflows()).toHaveLength(2)

      clearCodeWorkflowRegistry()

      expect(getAllCodeWorkflows()).toHaveLength(0)
      expect(getCodeWorkflow('wf-a')).toBeUndefined()
      expect(isCodeWorkflow('wf-b')).toBe(false)
    })
  })
})
