/**
 * Code Workflow Registry (validating bridge)
 *
 * The registry store itself lives in `@open-mercato/shared` so all bootstrap
 * contexts (Next.js app, CLI, `mercato workers`) share one process-wide map —
 * see `@open-mercato/shared/modules/workflows/code-registry`. This module
 * keeps the workflows engine's import path stable and adds Zod validation on
 * top of the raw registration used by the shared bootstrap factory.
 */

import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { registerCodeWorkflowEntries } from '@open-mercato/shared/modules/workflows/code-registry'
import { workflowDefinitionDataSchema } from '../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export {
  getCodeWorkflow,
  getAllCodeWorkflows,
  isCodeWorkflow,
  clearCodeWorkflowRegistry,
} from '@open-mercato/shared/modules/workflows/code-registry'

/**
 * Register code-based workflow definitions at bootstrap time.
 * Validates each definition against the Zod schema and warns on failures.
 */
export function registerCodeWorkflows(workflows: CodeWorkflowDefinition[]): void {
  const valid: CodeWorkflowDefinition[] = []
  for (const wf of workflows) {
    const validation = workflowDefinitionDataSchema.safeParse(wf.definition)
    if (!validation.success) {
      logger.warn('Code workflow failed validation', {
        workflowId: wf.workflowId,
        issues: validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
      continue
    }
    valid.push(wf)
  }
  registerCodeWorkflowEntries(valid)
}
