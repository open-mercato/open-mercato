/** @jest-environment node */

/**
 * Workflow Template Asset Tests (Step 7.1)
 *
 * Every shipped template must be a complete, valid WorkflowDefinitionData:
 * it passes workflowDefinitionDataSchema AND produces a graph with no
 * blocking errors through the same definition->graph path the editor uses
 * (definitionToGraph + validateWorkflowGraph).
 */

import { workflowDefinitionDataSchema } from '../../data/validators'
import { definitionToGraph, validateWorkflowGraph } from '../graph-utils'
import { collectTaskOwnerWarnings } from '../flow-logic-warnings'
import {
  WORKFLOW_TEMPLATE_FILES,
  clearWorkflowTemplateCacheForTests,
  getRawWorkflowTemplate,
  loadWorkflowTemplate,
  loadWorkflowTemplates,
} from '../workflow-templates'

type RawTemplateShape = {
  id: string
  nameKey: string
  descriptionKey: string
  category: string
  icon: string
  definition: unknown
}

describe('workflow template assets', () => {
  afterEach(() => {
    clearWorkflowTemplateCacheForTests()
  })

  it('ships exactly the four Phase 1 templates', () => {
    expect([...WORKFLOW_TEMPLATE_FILES]).toEqual([
      'order-approval.json',
      'lead-to-install.json',
      'task-escalation.json',
      'webhook-integration.json',
    ])
  })

  describe.each([...WORKFLOW_TEMPLATE_FILES])('%s', (fileName) => {
    const raw = getRawWorkflowTemplate(fileName) as RawTemplateShape

    it('declares complete gallery metadata with i18n keys derived from its id', () => {
      expect(raw.id).toMatch(/^[a-z0-9-]+$/)
      expect(raw.nameKey).toBe(`workflows.templates.${raw.id}.name`)
      expect(raw.descriptionKey).toBe(`workflows.templates.${raw.id}.description`)
      expect(typeof raw.category).toBe('string')
      expect(raw.category.length).toBeGreaterThan(0)
      expect(typeof raw.icon).toBe('string')
      expect(raw.icon.length).toBeGreaterThan(0)
    })

    it('passes workflowDefinitionDataSchema', () => {
      const result = workflowDefinitionDataSchema.safeParse(raw.definition)
      if (!result.success) {
        throw new Error(`Template ${fileName} failed schema validation: ${result.error.message}`)
      }
    })

    it('produces a graph without blocking validation errors', () => {
      const template = loadWorkflowTemplate(fileName)
      const { nodes, edges } = definitionToGraph(template.definition)
      const issues = validateWorkflowGraph(nodes, edges)
      const blocking = issues.filter((issue) => issue.type === 'error')
      expect(blocking).toEqual([])
    })

    it('every USER_TASK it ships names somebody who can complete it', () => {
      // §6.4 moved "who can complete this?" from a feature grant into the
      // definition, which turned an omission that used to be harmless into a
      // task the engine parks on forever. `order-approval.json` shipped exactly
      // that omission until the author-time check caught it; this is the guard
      // that keeps a gallery template from starting a workflow nobody can
      // finish.
      const warnings = collectTaskOwnerWarnings(raw.definition as never)
      expect(warnings.map((warning) => warning.params.stepId)).toEqual([])
    })
  })

  it('loads all templates with unique ids and caches the parsed list', () => {
    const templates = loadWorkflowTemplates()
    expect(templates).toHaveLength(4)
    const ids = templates.map((template) => template.id)
    expect(new Set(ids).size).toBe(4)
    expect(loadWorkflowTemplates()).toBe(templates)
  })

  it('fails loudly on an unknown template file', () => {
    expect(() => loadWorkflowTemplate('does-not-exist.json')).toThrow('Missing workflow template file')
  })
})
