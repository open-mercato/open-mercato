# Workflows Module — Standalone App Guide

Use the workflows module for business process automation: defining step-based workflows, executing instances, handling user tasks, and triggering workflows from domain events.

## Using Workflows in Your App

The workflow engine is provided by `@open-mercato/core`. Your standalone app can:

1. **Create workflow definitions** via the visual editor at `/backend/workflows`
2. **Trigger workflows** from domain events emitted by your modules
3. **Subscribe to workflow events** for side effects in your modules
4. **Inject UI widgets** into workflow pages or inject workflow widgets into your pages
5. **Define user tasks** that require human approval or data entry

## Starting Workflows Programmatically

Resolve the workflow executor via DI — never import lib functions directly:

```typescript
// In your module's DI-aware context (API route, subscriber, worker)
const executor = container.resolve('workflowExecutor')

await executor.startWorkflow({
  workflowId: 'order-approval',  // matches a WorkflowDefinition.workflowId
  context: {
    orderId: order.id,
    orderTotal: order.totalGross,
    customerName: order.customerName,
  },
  organizationId,
  tenantId,
})
```

## Event Triggers

Configure automatic workflow starts from your module's domain events:

1. Create a workflow definition with a `triggers[]` entry in the visual editor or via API
2. The workflow engine's wildcard subscriber evaluates all non-internal events
3. Use `filterConditions` to narrow which events match (e.g., only orders above a threshold)
4. Use `contextMapping` to extract event payload fields into workflow context variables
5. Use `debounceMs` and `maxConcurrentInstances` to prevent trigger storms

Excluded event prefixes (never trigger workflows): `query_index`, `search`, `workflows`, `cache`, `queue`.

## Subscribing to Workflow Events

React to workflow lifecycle events in your module:

```typescript
// src/modules/<your_module>/subscribers/workflow-completed.ts
export const metadata = {
  event: 'workflows.instance.completed',
  persistent: true,
  id: 'your-module-workflow-completed',
}

export default async function handler(payload, ctx) {
  // payload.resourceId = instance ID
  // payload.workflowId = definition ID
  // payload.context = workflow context variables
}
```

Key workflow events your module can subscribe to:

| Event | When it fires |
|-------|--------------|
| `workflows.instance.created` | New workflow instance started |
| `workflows.instance.completed` | Workflow finished successfully |
| `workflows.instance.failed` | Workflow failed |
| `workflows.instance.cancelled` | Workflow was cancelled |
| `workflows.task.created` | User task assigned |
| `workflows.task.completed` | User task completed |
| `workflows.step.completed` | Individual step finished |

## Step Types

| Step type | Use case |
|-----------|----------|
| `START` | Entry point — every definition has exactly one |
| `END` | Terminal step — marks workflow as COMPLETED |
| `USER_TASK` | Human approval or data entry — pauses until task completion |
| `AUTOMATED` | Executes transition activities immediately and advances |
| `SUB_WORKFLOW` | Invokes a nested workflow definition |
| `WAIT_FOR_SIGNAL` | Pauses for an external signal (e.g., payment confirmed) |
| `WAIT_FOR_TIMER` | Pauses for a configured duration |
| `PARALLEL_FORK` / `PARALLEL_JOIN` | Splits/merges parallel execution paths |

## Activity Types

Activities execute on transitions between steps:

| Activity type | Use case |
|---------------|----------|
| `SEND_EMAIL` | Send templated email |
| `CALL_API` | Call an internal API endpoint |
| `CALL_WEBHOOK` | Call an external HTTP endpoint |
| `UPDATE_ENTITY` | Mutate an entity via the command bus |
| `EMIT_EVENT` | Emit a domain event |
| `EXECUTE_FUNCTION` | Run a registered custom function |
| `WAIT` | Delay execution for a configured duration |

Use `{{context.*}}`, `{{workflow.*}}`, `{{env.*}}`, `{{now}}` for variable interpolation in activity config — never hardcode values.

## Sending Signals

Resume a workflow waiting for an external signal:

```typescript
const executor = container.resolve('workflowExecutor')

await executor.sendSignal({
  instanceId: workflowInstanceId,
  signalName: 'payment_confirmed',
  payload: { transactionId: '...' },
  organizationId,
  tenantId,
})
```

## Widget Injection

Inject workflow-related UI into your module's pages, or inject your module's widgets into workflow pages:

```typescript
// src/modules/<your_module>/widgets/injection-table.ts
export const widgetInjections = {
  // Inject into workflow task detail page
  'workflows.task.detail:after': {
    widgetId: 'your-module-task-context',
    priority: 50,
  },
}
```

## Compensation (Saga Pattern)

When a workflow step fails, compensation activities execute in reverse order to undo previous steps. This follows the saga pattern:

- **Sync activities** execute inline and advance immediately
- **Async activities** enqueue to the `workflow-activities` queue; workflow pauses until completion
- On failure, compensation runs in reverse — keep activity handlers **idempotent** (check state before mutating)

## Key Rules

- MUST resolve services via DI (`container.resolve('workflowExecutor')`) — never import lib functions directly
- MUST use `workflowExecutor.startWorkflow()` to create instances — never insert rows directly
- MUST keep activity handlers idempotent — they may be retried on failure
- MUST scope all queries by `organization_id` — workflow data is tenant-scoped
- MUST NOT couple your module to workflow internals — use event triggers and signals for integration
