import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import {
  registerTaskEntityAclRequirements,
  registerTaskEntityLinkBuilders,
} from '@open-mercato/core/modules/workflows/lib/task-entity-registry'

/**
 * Test-only fixture for TC-WF-068 (task entity registration seam, #7180).
 *
 * Registers nothing unless the integration runner exported
 * `OM_INTEGRATION_TEST=true`, so development and production behave exactly as
 * if this module were absent. Under the runner it registers, for entities the
 * `example` module already ships:
 *
 * - `example:todo` — view requirement plus a same-origin deep link;
 * - `example:example_item` — view requirement plus a link builder that answers
 *   an off-origin URL, which the server MUST drop.
 *
 * `example:example_customer_priority` is deliberately left unregistered so the
 * spec can assert that an unregistered app-owned type still fails closed.
 */
if (parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)) {
  registerTaskEntityAclRequirements([
    { entityId: 'example:todo', view: ['example.todos.view'] },
    { entityId: 'example:example_item', view: ['example.todos.view'] },
  ])
  registerTaskEntityLinkBuilders([
    { entityId: 'example:todo', buildHref: (recordId) => `/backend/todos/${encodeURIComponent(recordId)}/edit` },
    { entityId: 'example:example_item', buildHref: (recordId) => `https://evil.example/items/${encodeURIComponent(recordId)}` },
  ])
}

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'workflows_entity_probe',
  workflows: [],
})

export default workflowsConfig
