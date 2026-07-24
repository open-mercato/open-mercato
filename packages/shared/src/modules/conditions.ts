import { z } from 'zod'

export const CONDITION_COMPARISON_OPERATORS = [
  '=',
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'MATCHES',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
] as const

export const CONDITION_LOGICAL_OPERATORS = ['AND', 'OR', 'NOT'] as const

export const conditionComparisonOperatorSchema = z.enum(CONDITION_COMPARISON_OPERATORS)
export const conditionLogicalOperatorSchema = z.enum(CONDITION_LOGICAL_OPERATORS)

export const simpleConditionSchema = z.object({
  field: z.string(),
  operator: conditionComparisonOperatorSchema,
  value: z.json(),
  valueField: z.string().optional(),
})

export const groupConditionSchema = z.object({
  operator: conditionLogicalOperatorSchema,
  get rules() {
    return z.array(conditionExpressionSchema)
  },
})

export const conditionExpressionSchema = z.union([simpleConditionSchema, groupConditionSchema])

export type ConditionComparisonOperator = z.infer<typeof conditionComparisonOperatorSchema>
export type ConditionLogicalOperator = z.infer<typeof conditionLogicalOperatorSchema>
export type SimpleCondition = z.infer<typeof simpleConditionSchema>
export type GroupCondition = z.infer<typeof groupConditionSchema>
export type ConditionExpression = z.infer<typeof conditionExpressionSchema>
