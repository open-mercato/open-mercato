import type { AwilixContainer } from 'awilix'
import { asFunction } from 'awilix'
import * as ruleEvaluator from './lib/rule-evaluator'
import * as actionExecutor from './lib/action-executor'
import * as ruleEngine from './lib/rule-engine'

/**
 * Register Business Rules module services in the DI container
 */
export function register(container: AwilixContainer): void {
  container.register({
    ruleEvaluator: asFunction(() => ruleEvaluator).scoped(),
    actionExecutor: asFunction(() => actionExecutor).scoped(),
    ruleEngine: asFunction(() => ruleEngine).scoped(),
  })
}
