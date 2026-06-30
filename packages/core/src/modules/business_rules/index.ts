import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'business_rules',
  title: 'Business Rules',
  version: '0.1.0',
  description: 'Business Rules Engine for defining, managing, and executing business logic and automation rules.',
  author: 'Patryk Lewczuk',
  license: 'MIT',
}

// Export rule engine types and functions for programmatic usage
export {
  executeRules,
  executeRuleById,
  executeRuleByRuleId,
  executeSingleRule,
  findApplicableRules,
  logRuleExecution,
  type RuleEngineContext,
  type RuleEngineResult,
  type RuleExecutionResult,
  type RuleDiscoveryOptions,
  type DirectRuleExecutionContext,
  type DirectRuleExecutionResult,
  type RuleIdExecutionContext,
} from './lib/rule-engine'

// Export validator schemas
export {
  directRuleExecutionContextSchema,
  ruleIdExecutionContextSchema,
  type DirectRuleExecutionContextInput,
  type RuleIdExecutionContextInput,
} from './data/validators'

// Public facade for condition builder and expression types
// Used by data_quality and other modules for visual condition authoring
export { ConditionBuilder } from './components/ConditionBuilder'
export type {
  ConditionExpression,
  GroupCondition,
  SimpleCondition,
} from './components/utils/conditionValidation'

// Server-side expression validation
export {
  validateConditionExpressionForApi,
  isSafeExpression,
} from './lib/payload-validation'

// Expression evaluator types for programmatic evaluation
export type {
  RuleEvaluationContext,
} from './lib/rule-evaluator'

// Expression evaluator function for condition evaluation
export {
  evaluateExpression,
  type EvaluationContext,
} from './lib/expression-evaluator'
