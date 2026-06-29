import { describe, test, expect, beforeEach, jest } from '@jest/globals'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
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
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const bad = invalidWorkflow('bad-workflow')
      const good = makeWorkflow('good-workflow')

      registerCodeWorkflows([bad, good])

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('"bad-workflow"')
      expect(getCodeWorkflow('bad-workflow')).toBeUndefined()
      expect(getCodeWorkflow('good-workflow')).toEqual(good)
    })

    test('warns on duplicate workflowId but overwrites with the later entry', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const first = makeWorkflow('my-workflow', 'module-a')
      const second = makeWorkflow('my-workflow', 'module-b')

      registerCodeWorkflows([first])
      registerCodeWorkflows([second])

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('"my-workflow"')
      expect(getCodeWorkflow('my-workflow')).toEqual(second)
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
