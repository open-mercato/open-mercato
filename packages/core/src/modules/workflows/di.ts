/**
 * Workflows Module - Dependency Injection
 *
 * Register workflow engine services in the DI container.
 */

import type { AwilixContainer } from 'awilix'
import { asFunction } from 'awilix'
import { createGenericOptimisticLockReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { WorkflowDefinition } from './data/entities'
import * as workflowExecutor from './lib/workflow-executor'
import * as stepHandler from './lib/step-handler'
import * as transitionHandler from './lib/transition-handler'
import * as activityExecutor from './lib/activity-executor'
import * as eventLogger from './lib/event-logger'
import * as signalHandler from './lib/signal-handler'
import * as timerHandler from './lib/timer-handler'

// Register the `workflows.definition` optimistic-lock reader at module-DI load
// time (top-level, like sales/customers) so it is present in the global reader
// store before any request-scoped `crudMutationGuardService` snapshots
// `getAllOptimisticLockReaders()`. Registering it only as a side-effect of
// importing the definition route module left it absent from that snapshot, so
// the guard short-circuited and the visual editor's stale saves overwrote with
// no 409 and no conflict bar.
registerOptimisticLockReaders({
  'workflows.definition': createGenericOptimisticLockReader({
    entity: WorkflowDefinition,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  }),
})

export function register(container: AwilixContainer): void {
  container.register({
    workflowExecutor: asFunction(() => workflowExecutor).scoped(),
    stepHandler: asFunction(() => stepHandler).scoped(),
    transitionHandler: asFunction(() => transitionHandler).scoped(),
    activityExecutor: asFunction(() => activityExecutor).scoped(),
    eventLogger: asFunction(() => eventLogger).scoped(),
    signalHandler: asFunction(() => signalHandler).scoped(),
    timerHandler: asFunction(() => timerHandler).scoped(),
  })
}
