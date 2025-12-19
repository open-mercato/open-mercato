/**
 * Workflows Module - Dependency Injection
 *
 * Register workflow engine services in the DI container.
 */

import type { AwilixContainer } from 'awilix'
import { asFunction } from 'awilix'
import * as workflowExecutor from './lib/workflow-executor'
import * as stepHandler from './lib/step-handler'
import * as transitionHandler from './lib/transition-handler'
import * as activityExecutor from './lib/activity-executor'
import * as eventLogger from './lib/event-logger'

export function register(container: AwilixContainer): void {
  container.register({
    workflowExecutor: asFunction(() => workflowExecutor).scoped(),
    stepHandler: asFunction(() => stepHandler).scoped(),
    transitionHandler: asFunction(() => transitionHandler).scoped(),
    activityExecutor: asFunction(() => activityExecutor).scoped(),
    eventLogger: asFunction(() => eventLogger).scoped(),
  })
}
