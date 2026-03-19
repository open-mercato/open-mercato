# Workflows Module — Agent Guidelines

Use the workflows module for business process automation: defining step-based workflows, executing instances, handling user tasks, processing async activities, and triggering workflows from domain events.

## MUST Rules

1. **MUST resolve services via DI** — use `container.resolve('workflowExecutor')`, never import and call lib functions directly
2. **MUST NOT skip the execution loop** — always use `workflowExecutor.startWorkflow()` to create and run instances; never insert `WorkflowInstance` rows directly
3. **MUST follow the step state machine** — steps transition `PENDING → ACTIVE → COMPLETED|FAILED|SKIPPED|CANCELLED`; never set status out of order
4. **MUST follow the instance state machine** — instances transition `RUNNING → COMPLETED|FAILED|CANCELLED`; intermediate states include `PAUSED`, `WAITING_FOR_ACTIVITIES`, `COMPENSATING`
5. **MUST keep activity handlers idempotent** — check state before mutating; activities may be retried on failure
6. **MUST use event sourcing** — log all workflow events via `eventLogger.logWorkflowEvent()`; never mutate instance state without a corresponding event
7. **MUST use variable interpolation** for dynamic activity config — use `{{context.*}}`, `{{workflow.*}}`, `{{env.*}}`, `{{now}}`; never hardcode values
8. **MUST NOT couple other modules to workflow internals** — use event triggers and signals for cross-module integration; widget injection for UI
9. **MUST declare new events in `events.ts`** with `as const` — undeclared events trigger TypeScript errors and runtime warnings
10. **MUST scope all queries by `organization_id`** — workflow data is tenant-scoped; never expose cross-tenant instances or tasks

## Execution Architecture

```
Definition → startWorkflow() → Instance → executeWorkflow() loop
                                              ↓
                                    stepHandler.enterStep()
                                              ↓
                              ┌─────────┬─────────┬──────────┐
                           USER_TASK  AUTOMATED  WAIT_FOR_*  END
                              ↓         ↓          ↓          ↓
                           (pause)   transition  (pause)   complete
                                        ↓
                              transitionHandler.executeTransition()
                                        ↓
                              activityExecutor (sync or async)
                                        ↓
                                   next step...
```

- **Sync activities** execute inline and advance the workflow immediately
- **Async activities** enqueue to the `workflow-activities` queue; workflow pauses until the worker completes them and calls `resumeWorkflowAfterActivities()`
- **Compensation** follows the saga pattern — on failure, compensation activities execute in reverse order

## Data Model Constraints

- **WorkflowDefinition** — templates with steps, transitions, triggers, activities. MUST have a unique `workflowId` + `version` pair
- **WorkflowInstance** — running executions. MUST reference a valid definition; MUST track `currentStepId` and `context`
- **StepInstance** — individual step executions. MUST reference parent instance; MUST record `inputData`/`outputData`
- **UserTask** — human-in-the-loop tasks. MUST have `assignedTo` or `assignedToRoles`; MUST respect `dueDate` for SLA tracking
- **WorkflowEvent** — immutable audit log. MUST NOT be updated or deleted after creation
- **WorkflowEventTrigger** — maps domain events to workflow starts. MUST specify `filterConditions` and `contextMapping`

## Step Types

| Step type | When to use |
|-----------|-------------|
| `START` | Entry point — every definition MUST have exactly one |
| `END` | Terminal step — marks workflow as COMPLETED |
| `USER_TASK` | When human approval or data entry is required — pauses until task completion |
| `AUTOMATED` | When the step should execute transition activities immediately and advance |
| `SUB_WORKFLOW` | When invoking a nested workflow definition |
| `WAIT_FOR_SIGNAL` | When the workflow must pause for an external signal (e.g., payment confirmed) |
| `WAIT_FOR_TIMER` | When the workflow must pause for a duration |
| `PARALLEL_FORK` / `PARALLEL_JOIN` | When splitting/merging parallel execution paths |

## Activity Types

| Activity type | When to use |
|---------------|-------------|
| `SEND_EMAIL` | Send templated email via mail service |
| `CALL_API` | Call an internal API endpoint |
| `CALL_WEBHOOK` | Call an external HTTP endpoint |
| `UPDATE_ENTITY` | Mutate an entity via the command bus |
| `EMIT_EVENT` | Emit a domain event to the event bus |
| `EXECUTE_FUNCTION` | Run a registered custom function |
| `WAIT` | Delay execution for a configured duration |

## DI Services

| Token | When to use |
|-------|-------------|
| `workflowExecutor` | Start, advance, cancel, retry, and resume workflows |
| `stepHandler` | Enter/exit/execute individual steps (called by executor) |
| `transitionHandler` | Find valid transitions and execute them (called by executor) |
| `activityExecutor` | Execute or enqueue activities (called by transition handler) |
| `eventLogger` | Log workflow events for audit trail |

## Adding a New Activity Type

1. Add the type to the `ActivityType` enum in `data/entities.ts`
2. Add a handler case in `lib/activity-executor.ts` → `executeActivityByType()`
3. Add variable interpolation support for any new config fields
4. Add i18n labels in `i18n/en.json` under `workflows.activityTypes`
5. Add form fields in `components/ActivityEditor.tsx` for the visual editor
6. Run `yarn db:generate` if the entity schema changed
7. Test with both sync and async execution modes

## Adding a New Step Type

1. Add the type to the `StepType` enum in `data/entities.ts`
2. Add a handler case in `lib/step-handler.ts` → `executeStep()`
3. Create a React Flow node component in `components/nodes/`
4. Register the node in the visual editor's node type map
5. Add i18n labels in `i18n/en.json` under `workflows.stepTypes`
6. Add icon mapping in `lib/node-type-icons.ts`
7. Run `npm run modules:prepare`

## Event Triggers

Configure automatic workflow starts from domain events:

1. Add trigger configuration to a workflow definition's `triggers[]` array
2. The wildcard subscriber (`subscribers/event-trigger.ts`) evaluates all non-internal events
3. Excluded event prefixes: `query_index`, `search`, `workflows`, `cache`, `queue`
4. Configure `filterConditions` to narrow which events match
5. Configure `contextMapping` to extract event payload into workflow context
6. Use `debounceMs` and `maxConcurrentInstances` to prevent trigger storms

## Widget Injection

The module injects an order-approval widget into the sales module:

- Widget: `widgets/injection/order-approval/`
- Spot ID: `sales.document.detail.order:details`
- Mapping: `widgets/injection-table.ts`

When adding new injected widgets, follow this pattern — keep the widget self-contained with a server component (`widget.ts`) and client component (`widget.client.tsx`).

## Key Directories

| Directory | When to modify |
|-----------|---------------|
| `api/` | When adding/modifying REST endpoints for definitions, instances, tasks, events, signals |
| `backend/` | When changing admin pages (definition list, visual editor, instance viewer, task inbox) |
| `components/` | When modifying the visual workflow editor (React Flow nodes, edges, dialogs) |
| `data/` | When changing ORM entities, validators, or extensions |
| `examples/` | When adding/updating seed workflow definitions (JSON) |
| `frontend/` | When modifying public-facing workflow pages |
| `i18n/` | When adding/updating translations (en, es, de, pl) |
| `lib/` | When changing core engine logic (executor, handlers, compensation, signals) |
| `subscribers/` | When adding event-driven side effects (trigger evaluation, notifications) |
| `widgets/` | When adding cross-module UI injection (e.g., approval widgets) |
| `workers/` | When modifying the async activity worker |

## Structure

```
src/modules/workflows/
├── acl.ts                    # 22 RBAC features
├── ce.ts                     # Custom entities (empty)
├── cli.ts                    # CLI: seed-demo, start-worker, process-activities
├── di.ts                     # DI: workflowExecutor, stepHandler, transitionHandler, activityExecutor, eventLogger
├── events.ts                 # 22 typed events (CRUD + lifecycle)
├── index.ts                  # Module metadata
├── notifications.ts          # Task assignment notification
├── setup.ts                  # Tenant init: seed examples, default role features
├── api/                      # REST endpoints (definitions, instances, tasks, events, signals)
├── backend/                  # Admin pages (visual editor, instance viewer, task inbox)
├── components/               # React Flow visual editor components
├── data/                     # ORM entities, validators, extensions
├── examples/                 # Seed workflow definitions (JSON)
├── frontend/                 # Public pages (checkout-demo)
├── i18n/                     # Translations (en, es, de, pl)
├── lib/                      # Core engine (executor, step/transition/activity handlers, compensation, signals)
├── migrations/               # Database migrations
├── subscribers/              # Event trigger evaluator, task notification
├── widgets/                  # Injected widgets (order-approval)
└── workers/                  # Async activity worker (workflow-activities queue)
```

## Cross-References

- **Event bus architecture**: `packages/events/AGENTS.md`
- **Queue worker contract**: `packages/queue/AGENTS.md`
- **Business rules engine**: `packages/core/src/modules/business_rules/`
- **Widget injection pattern**: `packages/core/AGENTS.md` → Widget Injection
- **Module setup convention**: `packages/core/AGENTS.md` → Module Setup Convention
