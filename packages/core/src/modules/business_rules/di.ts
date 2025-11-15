import type { AwilixContainer } from 'awilix'
import { asFunction } from 'awilix'
import * as ruleEvaluator from './lib/rule-evaluator'

/**
 * Register Business Rules module services in the DI container
 */
export function register(container: AwilixContainer): void {
  container.register({
    ruleEvaluator: asFunction(() => ruleEvaluator).scoped(),
  })
}
