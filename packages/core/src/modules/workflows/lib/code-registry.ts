/**
 * In-Memory Code Workflow Registry
 *
 * Stores code-based workflow definitions populated at bootstrap from
 * the generated workflows.generated.ts. Definitions live purely in memory —
 * no DB row is created until a user customizes the definition.
 */

import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { workflowDefinitionDataSchema } from '../data/validators'

const codeWorkflowRegistry = new Map<string, CodeWorkflowDefinition>()

/**
 * Register code-based workflow definitions at bootstrap time.
 * Validates each definition against the Zod schema and warns on failures.
 */
export function registerCodeWorkflows(workflows: CodeWorkflowDefinition[]): void {
  for (const wf of workflows) {
    const validation = workflowDefinitionDataSchema.safeParse(wf.definition)
    if (!validation.success) {
      console.warn(
        `[workflows] Code workflow "${wf.workflowId}" failed validation:`,
        validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
      continue
    }

    if (codeWorkflowRegistry.has(wf.workflowId)) {
      console.warn(
        `[workflows] Duplicate code workflow ID "${wf.workflowId}" from module "${wf.moduleId}" — overwriting`,
      )
    }

    codeWorkflowRegistry.set(wf.workflowId, wf)
  }
}

/**
 * Get a single code workflow definition by workflowId.
 */
export function getCodeWorkflow(workflowId: string): CodeWorkflowDefinition | undefined {
  return codeWorkflowRegistry.get(workflowId)
}

/**
 * Get all registered code workflow definitions.
 */
export function getAllCodeWorkflows(): CodeWorkflowDefinition[] {
  return Array.from(codeWorkflowRegistry.values())
}

/**
 * Check if a workflowId is a code-based definition.
 */
export function isCodeWorkflow(workflowId: string): boolean {
  return codeWorkflowRegistry.has(workflowId)
}

/**
 * Clear the registry (for testing).
 */
export function clearCodeWorkflowRegistry(): void {
  codeWorkflowRegistry.clear()
}
