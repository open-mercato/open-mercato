/**
 * Code-Based Workflow Definitions — Module Config Factory
 *
 * Analogous to createModuleEvents() for events.
 * Creates a WorkflowsModuleConfig that the generator aggregates.
 */

import type { CodeWorkflowDefinition, WorkflowsModuleConfig } from './types'

export function createWorkflowsModuleConfig(options: {
  moduleId: string
  workflows: CodeWorkflowDefinition[]
}): WorkflowsModuleConfig {
  const workflows = options.workflows.map((wf) => ({
    ...wf,
    moduleId: options.moduleId,
  }))

  return {
    moduleId: options.moduleId,
    workflows,
  }
}
